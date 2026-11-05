import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import {
  type CompanyContext,
  companyOf,
  type DbClient,
  isUniqueViolation,
  TenantContextService,
  TenantDatabase,
  type TenantTransaction,
} from '../../prisma/index.js';
import {
  addDays,
  businessToday,
  fromDbDate,
  isCalendarDate,
  toDbDate,
} from '../../shared/dates.js';
import { isDecimalString } from '../../shared/decimal.js';
import { DomainException, FieldErrors, optionalText } from '../../shared/errors/index.js';
import { AMOUNT, Money } from '../../shared/money.js';
import { skipAndTake } from '../../shared/pagination.js';
import { uuidv7 } from '../../shared/uuid.js';
import { isPaymentMethod } from '../registry/index.js';
import { invoiceReference } from './invoice-rules.js';
import { InvoicingEvents } from './invoicing-events.js';
import { InvoicingRepository } from './invoicing.repository.js';
import type {
  CreatePaymentDto,
  DueDatesQuery,
  InvoicingSummaryDto,
  PaymentDto,
  PaymentPageDto,
  PaymentsQuery,
  SchedulePageDto,
} from './payments.dto.js';
import { type PaymentRow, PaymentsRepository } from './payments.repository.js';

const money = (value: Prisma.Decimal) => value.toFixed(AMOUNT.scale);

/**
 * Payments from customers and refunds to them (docs/adr/0030). A payment settles one or more due
 * dates of its customer: each due date is locked (B34, in the order of documents and instalments),
 * never settled beyond its amount (also a CHECK), and its settled amount moves in the same
 * transaction. Payments are append-only (B32): one is undone by another that reverses it.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly repository: PaymentsRepository,
    private readonly invoices: InvoicingRepository,
    private readonly events: InvoicingEvents,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
  ) {}

  async record(dto: CreatePaymentDto): Promise<{ payment: PaymentDto; created: boolean }> {
    const company = companyOf(this.contexts.require());
    try {
      return await this.db.run((tx) => this.recordIn(tx, company, dto));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainException('DOCUMENT_ID_REUSED', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async recordIn(
    tx: TenantTransaction,
    company: CompanyContext,
    dto: CreatePaymentDto,
    today = businessToday(),
  ): Promise<{ payment: PaymentDto; created: boolean }> {
    const kind = dto.kind ?? 'RECEIPT';
    const errors = new FieldErrors();
    const paymentDate = dto.paymentDate ?? today;
    if (!isCalendarDate(paymentDate)) errors.add('paymentDate', 'DATE_INVALID');
    else if (paymentDate > today) errors.add('paymentDate', 'DATE_IN_FUTURE');
    const amountOk =
      isDecimalString(dto.amount, AMOUNT) && !new Prisma.Decimal(dto.amount).isZero();
    if (!amountOk) errors.add('amount', 'AMOUNT_INVALID');
    if (!isPaymentMethod(dto.method)) errors.add('method', 'PAYMENT_METHOD_UNKNOWN');
    const seen = new Set<string>();
    dto.allocations.forEach((allocation, index) => {
      const at = (field: string) => `allocations[${index}].${field}`;
      const ok = isDecimalString(allocation.amount, AMOUNT);
      if (!ok || new Prisma.Decimal(allocation.amount).isZero())
        errors.add(at('amount'), 'AMOUNT_INVALID');
      if (seen.has(allocation.dueDateId)) errors.add(at('dueDateId'), 'DUPLICATE_LINE');
      seen.add(allocation.dueDateId);
    });
    errors.throwIfAny();
    const amount = Money.of(dto.amount);
    const allocated = Money.sum(dto.allocations.map((a) => Money.of(a.amount)));
    if (!allocated.equals(amount)) {
      throw new DomainException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, {
        errors: [{ field: 'allocations', code: 'ALLOCATION_MISMATCH' }],
      });
    }

    // Due dates locked before anything is read of them: a payment at the same time waits.
    const dueDateIds = dto.allocations.map((a) => a.dueDateId);
    const rows = await this.repository.dueDatesByIds(tx, company.companyId, dueDateIds);
    const locked = await this.invoices.lockDueDates(
      tx,
      rows.map((row) => row.invoiceId),
    );
    // A request with the same id that was waiting finds the first one done (B33).
    const existing = await this.repository.findAnyPayment(tx, dto.id);
    if (existing) {
      const same =
        existing.companyId === company.companyId &&
        existing.amount.equals(dto.amount) &&
        existing.partyId === dto.partyId;
      if (!same) throw new DomainException('DOCUMENT_ID_REUSED', HttpStatus.CONFLICT);
      return { payment: await this.payment(tx, company.companyId, dto.id), created: false };
    }

    const byId = new Map(rows.map((row) => [row.id, row]));
    const settledNow = new Map(locked.map((d) => [d.id, d.settledAmount]));
    const wantedKind = kind === 'RECEIPT' ? 'INVOICE' : 'CREDIT_NOTE';
    dto.allocations.forEach((allocation, index) => {
      const at = `allocations[${index}].dueDateId`;
      const row = byId.get(allocation.dueDateId);
      if (!row || row.partyId !== dto.partyId) return errors.add(at, 'DUE_DATE_NOT_FOUND');
      if (row.kind !== wantedKind) return errors.add(at, 'DUE_DATE_WRONG_KIND');
      if (paymentDate < fromDbDate(row.issueDate)) {
        errors.add('paymentDate', 'BEFORE_DOCUMENT');
      }
      const open = Money.of(row.amount).minus(Money.of(settledNow.get(row.id)!));
      if (Money.of(allocation.amount).greaterThan(open)) {
        errors.add(`allocations[${index}].amount`, 'ALLOCATION_OVER_DUE');
      }
    });
    errors.throwIfAny();

    await this.repository.createPayment(
      tx,
      {
        id: dto.id,
        tenantId: company.tenantId,
        companyId: company.companyId,
        kind,
        partyId: dto.partyId,
        paymentDate: toDbDate(paymentDate),
        amount: amount.toDecimal(),
        method: dto.method,
        reference: optionalText(dto.reference),
        notes: optionalText(dto.notes),
        createdById: company.userId,
      },
      dto.allocations.map((a) => ({
        dueDateId: a.dueDateId,
        amount: new Prisma.Decimal(a.amount),
      })),
    );
    for (const allocation of dto.allocations) {
      await this.invoices.setSettled(
        tx,
        allocation.dueDateId,
        settledNow.get(allocation.dueDateId)!.plus(allocation.amount),
      );
    }
    await this.events.record(
      tx,
      company,
      'PAYMENT_RECORDED',
      { type: 'payment', id: dto.id },
      {
        kind,
        amount: amount.toString(),
        documents: [...new Set(rows.map((row) => invoiceReference(row)))],
      },
    );
    return { payment: await this.payment(tx, company.companyId, dto.id), created: true };
  }

  reverse(id: string): Promise<PaymentDto> {
    const company = companyOf(this.contexts.require());
    return this.db.run((tx) => this.reverseIn(tx, company, id));
  }

  /**
   * Undoes a payment: another payment with the same amount and its allocations negated, the due
   * dates settled less. Twice at the same time: the due dates are locked first, and the unique
   * reversal turns the second into 409.
   */
  async reverseIn(
    tx: TenantTransaction,
    company: CompanyContext,
    id: string,
    today = businessToday(),
  ): Promise<PaymentDto> {
    const payment = await this.repository.findPayment(tx, company.companyId, id);
    if (!payment) throw new DomainException('PAYMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (payment.reversesId) throw new DomainException('PAYMENT_IS_REVERSAL', HttpStatus.CONFLICT);
    const rows = await this.repository.dueDatesByIds(
      tx,
      company.companyId,
      payment.allocations.map((a) => a.dueDateId),
    );
    const locked = await this.invoices.lockDueDates(
      tx,
      rows.map((row) => row.invoiceId),
    );
    if (await this.repository.reversalOf(tx, company.companyId, id)) {
      throw new DomainException('PAYMENT_ALREADY_REVERSED', HttpStatus.CONFLICT);
    }
    const reversalId = uuidv7();
    try {
      await this.repository.createPayment(
        tx,
        {
          id: reversalId,
          tenantId: company.tenantId,
          companyId: company.companyId,
          kind: payment.kind,
          partyId: payment.partyId,
          paymentDate: toDbDate(
            today < fromDbDate(payment.paymentDate) ? fromDbDate(payment.paymentDate) : today,
          ),
          amount: payment.amount,
          method: payment.method,
          reference: payment.reference,
          reversesId: payment.id,
          createdById: company.userId,
        },
        payment.allocations.map((a) => ({ dueDateId: a.dueDateId, amount: a.amount.negated() })),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainException('PAYMENT_ALREADY_REVERSED', HttpStatus.CONFLICT);
      }
      throw error;
    }
    for (const allocation of payment.allocations) {
      const due = locked.find((d) => d.id === allocation.dueDateId)!;
      await this.invoices.setSettled(tx, due.id, due.settledAmount.minus(allocation.amount));
    }
    await this.events.record(
      tx,
      company,
      'PAYMENT_REVERSED',
      { type: 'payment', id: payment.id },
      { amount: money(payment.amount), reversal: reversalId },
    );
    return this.payment(tx, company.companyId, payment.id);
  }

  async payment(db: DbClient, companyId: string, id: string): Promise<PaymentDto> {
    const payment = await this.repository.findPayment(db, companyId, id);
    if (!payment) throw new DomainException('PAYMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    const reversal = await this.repository.reversalOf(db, companyId, id);
    return (await this.toDtos(db, companyId, [{ ...payment, reversedBy: reversal }]))[0]!;
  }

  get(id: string): Promise<PaymentDto> {
    const { companyId } = companyOf(this.contexts.require());
    return this.db.run((tx) => this.payment(tx, companyId, id));
  }

  list(query: PaymentsQuery): Promise<PaymentPageDto> {
    const { companyId } = companyOf(this.contexts.require());
    const { skip, take } = skipAndTake(query);
    return this.db.run(async (tx) => {
      const { rows, total } = await this.repository.listPayments(
        tx,
        { companyId, partyId: query.partyId, from: query.from, to: query.to },
        skip,
        take,
      );
      return {
        items: await this.toDtos(tx, companyId, rows),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  schedule(query: DueDatesQuery, today = businessToday()): Promise<SchedulePageDto> {
    const { companyId } = companyOf(this.contexts.require());
    const { skip, take } = skipAndTake(query);
    return this.db.run(async (tx) => {
      const { rows, totals } = await this.repository.listDueDates(tx, {
        companyId,
        status: query.status,
        partyId: query.partyId,
        from: query.from,
        to: query.to,
        today,
        skip,
        take,
      });
      return {
        items: rows.map((row) => {
          const open = row.amount.minus(row.settledAmount);
          return {
            dueDateId: row.id,
            invoiceId: row.invoiceId,
            kind: row.kind,
            reference: invoiceReference(row),
            issueDate: fromDbDate(row.issueDate),
            partyId: row.partyId,
            partyName: row.partyName,
            seq: row.seq,
            dueDate: fromDbDate(row.dueDate),
            amount: money(row.amount),
            settledAmount: money(row.settledAmount),
            openAmount: money(open),
            overdue: !open.isZero() && fromDbDate(row.dueDate) < today,
          };
        }),
        total: Number(totals.count),
        page: query.page,
        pageSize: query.pageSize,
        openTotal: money(totals.open ?? new Prisma.Decimal(0)),
        overdueTotal: money(totals.overdue ?? new Prisma.Decimal(0)),
      };
    });
  }

  summary(today = businessToday()): Promise<InvoicingSummaryDto> {
    const { companyId } = companyOf(this.contexts.require());
    return this.db.run(async (tx) => {
      const row = await this.repository.summary(
        tx,
        companyId,
        today,
        addDays(today, 30),
        `${today.slice(0, 7)}-01`,
      );
      return {
        toInvoice: await this.invoices.countToInvoice(tx, companyId),
        drafts: Number(row.drafts),
        overdue: money(row.overdue ?? new Prisma.Decimal(0)),
        dueSoon: money(row.dueSoon ?? new Prisma.Decimal(0)),
        invoicedThisMonth: money(row.invoicedThisMonth ?? new Prisma.Decimal(0)),
      };
    });
  }

  private async toDtos(
    db: DbClient,
    companyId: string,
    payments: (PaymentRow & { reversedBy: { id: string } | null })[],
  ): Promise<PaymentDto[]> {
    const dueDates = new Map(
      (
        await this.repository.dueDatesByIds(
          db,
          companyId,
          payments.flatMap((p) => p.allocations.map((a) => a.dueDateId)),
        )
      ).map((row) => [row.id, row]),
    );
    const names = await this.invoices.partyNames(
      db,
      payments.map((p) => p.partyId),
    );
    return payments.map((payment) => ({
      id: payment.id,
      kind: payment.kind,
      partyId: payment.partyId,
      partyName: names.get(payment.partyId) ?? '',
      paymentDate: fromDbDate(payment.paymentDate),
      amount: money(payment.amount),
      method: payment.method,
      reference: payment.reference,
      notes: payment.notes,
      reversesId: payment.reversesId,
      reversedById: payment.reversedBy?.id ?? null,
      allocations: payment.allocations.map((allocation) => {
        const due = dueDates.get(allocation.dueDateId)!;
        return {
          dueDateId: allocation.dueDateId,
          invoiceId: due.invoiceId,
          reference: invoiceReference(due),
          dueDate: fromDbDate(due.dueDate),
          amount: money(allocation.amount),
        };
      }),
      createdAt: payment.createdAt.toISOString(),
    }));
  }

  /** For the operator: due dates whose settled amount is not what settles them. */
  verify(db: DbClient) {
    return this.repository.verify(db);
  }
}
