import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import {
  type CompanyContext,
  companyOf,
  TenantContextService,
  TenantDatabase,
  type TenantTransaction,
} from '../../prisma/index.js';
import { businessToday, fromDbDate, isCalendarDate, toDbDate } from '../../shared/dates.js';
import { DomainException, type FieldError } from '../../shared/errors/index.js';
import { Money } from '../../shared/money.js';
import { editConflict } from '../../shared/versioning.js';
import { type BillingParty, type PaymentTerms, RegistryService } from '../registry/index.js';
import { missingForInvoices, TenancyService } from '../tenancy/index.js';
import { InvoiceContentChecker } from './invoice-content.js';
import { InvoiceDraftsService } from './invoice-drafts.service.js';
import { InvoiceQueriesService } from './invoice-queries.service.js';
import {
  assertIssueDate,
  dueDates,
  INVOICE_KINDS,
  invoiceReference,
  needsStampDuty,
  STAMP_DUTY,
} from './invoice-rules.js';
import type { InvoiceDto, IssueDto } from './invoicing.dto.js';
import { InvoicingEvents } from './invoicing-events.js';
import { InvoicingRepository } from './invoicing.repository.js';

/**
 * Issuing a draft (docs/adr/0028, 0029): one transaction that locks, in this order (B34), the
 * draft, the due dates of the invoice a credit note corrects, the counter of the series, the
 * shipments; checks everything again; copies seller and customer; computes the VAT summary, the
 * stamp duty and the due dates; inserts the document with the draft's id (B33); deletes the
 * draft. Any error undoes it all, number included.
 */
@Injectable()
export class InvoiceIssueService {
  constructor(
    private readonly repository: InvoicingRepository,
    private readonly checker: InvoiceContentChecker,
    private readonly drafts: InvoiceDraftsService,
    private readonly queries: InvoiceQueriesService,
    private readonly registry: RegistryService,
    private readonly tenancy: TenancyService,
    private readonly events: InvoicingEvents,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
  ) {}

  /** `created` is false when the draft was already issued with this id (a second click). */
  issue(id: string, dto: IssueDto): Promise<{ invoice: InvoiceDto; created: boolean }> {
    const company = companyOf(this.contexts.require());
    return this.db.run((tx) => this.issueIn(tx, company, id, dto));
  }

  async issueIn(
    tx: TenantTransaction,
    company: CompanyContext,
    id: string,
    dto: IssueDto,
    today = businessToday(),
  ): Promise<{ invoice: InvoiceDto; created: boolean }> {
    const draft = await this.repository.lockDraft(tx, company.companyId, id);
    if (!draft) {
      // After the lock: a request that waited finds the document the first one issued.
      const issued = await this.repository.findInvoice(tx, company.companyId, id);
      if (issued) {
        return {
          invoice: await this.queries.invoice(tx, company.companyId, id, today),
          created: false,
        };
      }
      throw new DomainException('DRAFT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    if (draft.version !== dto.version) throw editConflict();
    const kind = INVOICE_KINDS[draft.kind];

    // A credit note waits for any other credit note or payment on the same invoice.
    const credit = await this.drafts.creditContext(tx, company, draft.creditedInvoiceId);
    const creditedDueDates = credit
      ? await this.repository.lockDueDates(tx, [credit.invoice.id])
      : [];

    const issueDate = dto.issueDate ?? today;
    if (!isCalendarDate(issueDate)) throw fieldError('issueDate', 'DATE_INVALID');
    const year = Number(issueDate.slice(0, 4));
    const last = await this.repository.lastDate(tx, company.companyId, kind.series, year);
    assertIssueDate(issueDate, today, last ? fromDbDate(last) : null);
    if (credit && issueDate < fromDbDate(credit.invoice.issueDate)) {
      throw fieldError('issueDate', 'BEFORE_CREDITED_INVOICE');
    }
    const number = await this.repository.nextNumber(tx, company, kind.series, year, issueDate);
    if (number === null) throw fieldError('issueDate', 'ISSUE_DATE_BEFORE_LAST');

    const held = (await this.repository.invoiceablesOfDraft(tx, id)).map((s) => s.fulfilmentId);
    const shipments = await this.repository.lockInvoiceables(tx, company.companyId, held);
    const content = await this.checker.check(
      tx,
      draft.kind,
      draft,
      draft.lines.map((line) => ({
        itemId: line.itemId,
        description: line.description,
        quantity: line.quantity?.toString() ?? null,
        unitPrice: line.unitPrice?.toString() ?? null,
        discountPercent: line.discountPercent.toString(),
        vatCode: line.vatCode,
        fulfilmentId: line.fulfilmentId,
        orderLineId: line.orderLineId,
        creditedLineId: line.creditedLineId,
        stampDutyCharge: line.stampDutyCharge,
      })),
      { shipments: new Map(shipments.map((s) => [s.fulfilmentId, s])), credit, forIssue: true },
    );
    const total = content.summary.total;
    if (!total.greaterThan(Money.ZERO)) throw fieldError('lines', 'TOTAL_NOT_POSITIVE');
    if (credit && total.greaterThan(credit.creditable.total)) {
      throw fieldError('lines', 'CREDIT_OVER_INVOICED');
    }

    const seller = await this.tenancy.getCompany(tx, company.companyId);
    const missing = missingForInvoices(seller);
    if (missing.length > 0) {
      throw new DomainException('COMPANY_DATA_INCOMPLETE', HttpStatus.CONFLICT, {
        errors: missing.map((field) => ({ field, code: 'REQUIRED' })),
      });
    }
    const customer = (await this.registry.findBillingParty(tx, content.header.partyId!))!;
    const customerMissing = missingOfCustomer(customer);
    if (customerMissing.length > 0) {
      throw new DomainException('CUSTOMER_DATA_INCOMPLETE', HttpStatus.CONFLICT, {
        errors: customerMissing.map((field) => ({ field, code: 'REQUIRED' })),
      });
    }
    const terms = (content.header.paymentTerms ?? customer.paymentTerms ?? 'RD') as PaymentTerms;
    const method = content.header.paymentMethod ?? customer.paymentMethod ?? 'MP05';
    if (method === 'MP05' && !seller.iban) throw fieldError('paymentMethod', 'IBAN_REQUIRED');
    const language = content.header.language ?? customer.documentLanguage;

    const stamped =
      draft.kind === 'INVOICE' &&
      needsStampDuty(
        content.lines.map((line) => ({
          vatNature: line.vatNature ?? null,
          lineAmount: line.lineAmount ? Money.of(line.lineAmount) : null,
          stampDutyCharge: line.stampDutyCharge ?? false,
        })),
      );

    // An invoice is due in instalments; a credit note settles what is open of the invoice it
    // corrects, from the last instalment back, and owes the customer the rest (docs/adr/0030).
    let due: { seq: number; dueDate: Date; amount: Prisma.Decimal }[] = [];
    const allocations: { dueDateId: string; amount: Prisma.Decimal }[] = [];
    if (draft.kind === 'INVOICE') {
      due = dueDates(issueDate, terms, total).map((d) => ({
        seq: d.seq,
        dueDate: toDbDate(d.dueDate),
        amount: d.amount.toDecimal(),
      }));
    } else {
      let left = total;
      for (const instalment of [...creditedDueDates].reverse()) {
        const open = Money.of(instalment.amount).minus(Money.of(instalment.settledAmount));
        const take = Money.min(open, left);
        if (!take.greaterThan(Money.ZERO)) continue;
        allocations.push({ dueDateId: instalment.id, amount: take.toDecimal() });
        left = left.minus(take);
      }
      if (left.greaterThan(Money.ZERO)) {
        due = [{ seq: 1, dueDate: toDbDate(issueDate), amount: left.toDecimal() }];
      }
    }

    await this.repository.createInvoice(
      tx,
      {
        id,
        tenantId: company.tenantId,
        companyId: company.companyId,
        kind: draft.kind,
        series: kind.series,
        year,
        number,
        issueDate: toDbDate(issueDate),
        partyId: customer.id,
        creditedInvoiceId: draft.creditedInvoiceId,
        seller: sellerSnapshot(seller),
        customer: customerSnapshot(customer),
        language,
        paymentTerms: terms,
        paymentMethod: method,
        iban: seller.iban,
        notes: content.header.notes,
        taxableTotal: content.summary.taxableTotal.toDecimal(),
        vatTotal: content.summary.vatTotal.toDecimal(),
        stampDuty: (stamped ? STAMP_DUTY : Money.ZERO).toDecimal(),
        total: total.toDecimal(),
        issuedById: company.userId,
      },
      content.lines,
      content.summary.rows.map((row) => ({
        vatCode: row.vatCode,
        vatRate: new Prisma.Decimal(row.rate),
        vatNature: row.nature,
        taxable: row.taxable.toDecimal(),
        vat: row.vat.toDecimal(),
      })),
      due,
    );
    await this.repository.markInvoiced(tx, content.fulfilmentIds, id);
    if (allocations.length > 0) {
      await this.repository.createCreditAllocations(
        tx,
        { tenantId: company.tenantId, companyId: company.companyId, creditNoteId: id },
        allocations,
      );
      for (const allocation of allocations) {
        const instalment = creditedDueDates.find((d) => d.id === allocation.dueDateId)!;
        await this.repository.setSettled(
          tx,
          allocation.dueDateId,
          instalment.settledAmount.plus(allocation.amount),
        );
      }
    }
    await this.repository.deleteDraft(tx, id);
    await this.events.record(
      tx,
      company,
      draft.kind === 'INVOICE' ? 'INVOICE_ISSUED' : 'CREDIT_NOTE_ISSUED',
      { type: 'invoice', id },
      {
        reference: invoiceReference({ series: kind.series, number, year }),
        total: total.toString(),
        ...(credit ? { credits: invoiceReference(credit.invoice) } : {}),
      },
    );
    return { invoice: await this.queries.invoice(tx, company.companyId, id, today), created: true };
  }
}

function fieldError(field: string, code: string): DomainException {
  const errors: FieldError[] = [{ field, code }];
  return new DomainException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, { errors });
}

/**
 * What an invoice needs of its customer (art. 21 DPR 633/72): the address, an identifier for an
 * Italian customer, and how the e-invoice reaches a business (SdI code or PEC).
 */
export function missingOfCustomer(customer: BillingParty): string[] {
  const missing: string[] = [];
  if (!customer.address) missing.push('address');
  if (!customer.city) missing.push('city');
  if (customer.country === 'IT') {
    if (!customer.postalCode) missing.push('postalCode');
    if (!customer.vatNumber && !customer.taxCode) missing.push('taxCode');
    if (customer.vatNumber && !customer.sdiCode && !customer.pecEmail) missing.push('sdiCode');
  }
  return missing;
}

function sellerSnapshot(company: Awaited<ReturnType<TenancyService['getCompany']>>) {
  return {
    legalName: company.legalName,
    vatNumber: company.vatNumber,
    taxCode: company.taxCode,
    country: company.country,
    address: company.address,
    postalCode: company.postalCode,
    city: company.city,
    province: company.province,
    reaOffice: company.reaOffice,
    reaNumber: company.reaNumber,
    shareCapital: company.shareCapital?.toFixed(2) ?? null,
    soleShareholder: company.soleShareholder,
    inLiquidation: company.inLiquidation,
    taxRegime: company.taxRegime,
    email: company.email,
    pecEmail: company.pecEmail,
    phone: company.phone,
  };
}

function customerSnapshot(customer: BillingParty) {
  return {
    kind: customer.kind,
    name: customer.name,
    firstName: customer.firstName,
    lastName: customer.lastName,
    vatNumber: customer.vatNumber,
    taxCode: customer.taxCode,
    country: customer.country,
    address: customer.address,
    postalCode: customer.postalCode,
    city: customer.city,
    province: customer.province,
    sdiCode: customer.sdiCode,
    pecEmail: customer.pecEmail,
  };
}
