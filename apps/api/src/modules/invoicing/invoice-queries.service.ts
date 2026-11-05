import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import {
  companyOf,
  type DbClient,
  TenantContextService,
  TenantDatabase,
} from '../../prisma/index.js';
import { businessToday, fromDbDate } from '../../shared/dates.js';
import { fromDecimal, PRICE, QUANTITY } from '../../shared/decimal.js';
import { DomainException } from '../../shared/errors/index.js';
import { AMOUNT, Money } from '../../shared/money.js';
import { type PageQuery, skipAndTake } from '../../shared/pagination.js';
import { isPaymentTerms, isVatCode, vatSummary } from '../registry/index.js';
import { creditableOf } from './invoice-content.js';
import { deferredDeadline, dueDates, invoiceReference, needsStampDuty } from './invoice-rules.js';
import type {
  CustomerOptionDto,
  DocumentLineDto,
  InvoiceItemOptionDto,
  DocumentRefDto,
  InvoiceDraftDto,
  InvoiceDraftPageDto,
  InvoiceDto,
  InvoicePageDto,
  InvoicesQuery,
  PaymentStatus,
  ShipmentRefDto,
  ToInvoicePageDto,
  ToInvoiceQuery,
} from './invoicing.dto.js';
import {
  type DraftRow,
  type InvoiceableFulfilmentRow,
  InvoicingRepository,
} from './invoicing.repository.js';

const DISCOUNT = { integerDigits: 3, scale: 2 };
const RATE = { integerDigits: 2, scale: 2 };
const money = (value: Prisma.Decimal) => value.toFixed(AMOUNT.scale);

/** A line of a draft or of an issued document, as the API shows it. */
interface StoredLine {
  id: string;
  lineNo: number;
  itemId: string | null;
  description: string;
  unit: string | null;
  quantity: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  discountPercent: Prisma.Decimal;
  vatCode: string | null;
  vatRate: Prisma.Decimal | null;
  vatNature: string | null;
  lineAmount: Prisma.Decimal | null;
  fulfilmentId: string | null;
  orderLineId: string | null;
  creditedLineId: string | null;
  stampDutyCharge: boolean;
}

function lineDto(line: StoredLine, codes: Map<string, string>): DocumentLineDto {
  return {
    id: line.id,
    lineNo: line.lineNo,
    itemId: line.itemId,
    itemCode: line.itemId ? (codes.get(line.itemId) ?? null) : null,
    description: line.description,
    unit: line.unit,
    quantity: fromDecimal(line.quantity, QUANTITY),
    unitPrice: fromDecimal(line.unitPrice, PRICE),
    discountPercent: fromDecimal(line.discountPercent, DISCOUNT),
    vatCode: line.vatCode,
    vatRate: fromDecimal(line.vatRate, RATE),
    vatNature: line.vatNature,
    lineAmount: line.lineAmount ? money(line.lineAmount) : null,
    fulfilmentId: line.fulfilmentId,
    orderLineId: line.orderLineId,
    creditedLineId: line.creditedLineId,
    stampDutyCharge: line.stampDutyCharge,
  };
}

/** A plain object with the fields of the DTO class (spreading a class instance loses it). */
type ShipmentRef = { [K in keyof ShipmentRefDto]: ShipmentRefDto[K] };

export function shipmentRef(row: InvoiceableFulfilmentRow): ShipmentRef {
  return {
    fulfilmentId: row.fulfilmentId,
    orderId: row.orderId,
    orderReference: row.orderReference,
    partyReference: row.partyReference,
    documentReference: row.documentReference,
    documentDate: fromDbDate(row.documentDate),
  };
}

function documentRef(doc: {
  id: string;
  kind: DocumentRefDto['kind'];
  series: string;
  year: number;
  number: number;
  issueDate: Date;
  total: Prisma.Decimal;
}): DocumentRefDto {
  return {
    id: doc.id,
    kind: doc.kind,
    reference: invoiceReference(doc),
    issueDate: fromDbDate(doc.issueDate),
    total: money(doc.total),
  };
}

/**
 * Paid in full or not, from the due dates (docs/adr/0030). An invoice a credit note cancels in
 * full is CREDITED; a credit note owes something back only when it has a due date of its own.
 */
export function paymentStatusOf(input: {
  kind: 'INVOICE' | 'CREDIT_NOTE';
  total: Money;
  credited: Money;
  dueAmount: Money;
  settledAmount: Money;
}): PaymentStatus {
  if (input.kind === 'CREDIT_NOTE') {
    if (input.dueAmount.isZero()) return 'SETTLED';
    return input.settledAmount.equals(input.dueAmount) ? 'REFUNDED' : 'REFUND_DUE';
  }
  if (!input.credited.minus(input.total).isNegative()) return 'CREDITED';
  if (input.settledAmount.equals(input.dueAmount)) return 'PAID';
  return input.settledAmount.isZero() ? 'UNPAID' : 'PARTIAL';
}

/** Reads of invoicing: documents, drafts, shipments to invoice. Every read is by company. */
@Injectable()
export class InvoiceQueriesService {
  constructor(
    private readonly repository: InvoicingRepository,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
  ) {}

  /** Runs a read on the company of the request. */
  private read<T>(work: (db: DbClient, companyId: string) => Promise<T>): Promise<T> {
    const { companyId } = companyOf(this.contexts.require());
    return this.db.run((tx) => work(tx, companyId));
  }

  getDraft(id: string) {
    return this.read((db, companyId) => this.draft(db, companyId, id));
  }

  getInvoice(id: string) {
    return this.read((db, companyId) => this.invoice(db, companyId, id));
  }

  listInvoices(query: InvoicesQuery) {
    return this.read((db, companyId) => this.list(db, companyId, query));
  }

  listDraftsOf(query: PageQuery) {
    return this.read((db, companyId) => this.listDrafts(db, companyId, query.page, query.pageSize));
  }

  listToInvoice(query: ToInvoiceQuery) {
    return this.read((db, companyId) => this.toInvoice(db, companyId, query));
  }

  searchCustomers(q: string | undefined): Promise<CustomerOptionDto[]> {
    return this.read((db) => this.repository.searchCustomers(db, q));
  }

  async searchItems(q: string | undefined): Promise<InvoiceItemOptionDto[]> {
    const rows = await this.read((db) => this.repository.searchItems(db, q));
    return rows.map((row) => ({ ...row, salePrice: fromDecimal(row.salePrice, PRICE) }));
  }

  async draft(db: DbClient, companyId: string, id: string, today = businessToday()) {
    const draft = await this.repository.findDraft(db, companyId, id);
    if (!draft) throw new DomainException('DRAFT_NOT_FOUND', HttpStatus.NOT_FOUND);
    return this.draftDto(db, draft, today);
  }

  async draftDto(db: DbClient, draft: DraftRow, today: string): Promise<InvoiceDraftDto> {
    const [names, codes, shipments] = [
      await this.repository.partyNames(db, draft.partyId ? [draft.partyId] : []),
      await this.repository.itemCodes(
        db,
        draft.lines.flatMap((l) => (l.itemId ? [l.itemId] : [])),
      ),
      await this.repository.invoiceablesOfDraft(db, draft.id),
    ];
    const credited = draft.creditedInvoiceId
      ? await this.repository.findAnyInvoice(db, draft.creditedInvoiceId)
      : null;
    const summary = vatSummary(
      draft.lines.flatMap((line) =>
        line.lineAmount && line.vatCode && isVatCode(line.vatCode)
          ? [{ vatCode: line.vatCode, amount: Money.of(line.lineAmount) }]
          : [],
      ),
    );
    const terms =
      draft.paymentTerms && isPaymentTerms(draft.paymentTerms) ? draft.paymentTerms : 'RD';
    const preview =
      draft.kind === 'INVOICE' && summary.total.greaterThan(Money.ZERO)
        ? dueDates(today, terms, summary.total)
        : [];
    return {
      id: draft.id,
      kind: draft.kind,
      partyId: draft.partyId,
      partyName: draft.partyId ? (names.get(draft.partyId) ?? null) : null,
      creditedInvoice: credited ? documentRef(credited) : null,
      language: draft.language,
      paymentTerms: draft.paymentTerms,
      paymentMethod: draft.paymentMethod,
      notes: draft.notes,
      lines: draft.lines.map((line) => lineDto(line, codes)),
      vatSummary: summary.rows.map((row) => ({
        vatCode: row.vatCode,
        rate: row.rate,
        nature: row.nature,
        taxable: row.taxable.toString(),
        vat: row.vat.toString(),
      })),
      taxableTotal: summary.taxableTotal.toString(),
      vatTotal: summary.vatTotal.toString(),
      total: summary.total.toString(),
      stampDutyRequired:
        draft.kind === 'INVOICE' &&
        needsStampDuty(
          draft.lines.map((line) => ({
            vatNature: line.vatNature,
            lineAmount: line.lineAmount ? Money.of(line.lineAmount) : null,
            stampDutyCharge: line.stampDutyCharge,
          })),
        ),
      dueDatesPreview: preview.map((due) => ({
        seq: due.seq,
        dueDate: due.dueDate,
        amount: due.amount.toString(),
      })),
      shipments: shipments.map(shipmentRef),
      deferredDeadline: deferredDeadline(shipments.map((s) => fromDbDate(s.documentDate))),
      version: draft.version,
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  async listDrafts(db: DbClient, companyId: string, page: number, pageSize: number) {
    const { skip, take } = skipAndTake({ page, pageSize });
    const { rows, total } = await this.repository.listDrafts(db, companyId, skip, take);
    const names = await this.repository.partyNames(
      db,
      rows.flatMap((row) => (row.partyId ? [row.partyId] : [])),
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        partyName: row.partyId ? (names.get(row.partyId) ?? null) : null,
        total: money(row.total),
        version: row.version,
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    } satisfies InvoiceDraftPageDto;
  }

  async invoice(db: DbClient, companyId: string, id: string, today = businessToday()) {
    const invoice = await this.repository.findInvoice(db, companyId, id);
    if (!invoice) throw new DomainException('INVOICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const [codes, creditNotes, shipments] = [
      await this.repository.itemCodes(
        db,
        invoice.lines.flatMap((l) => (l.itemId ? [l.itemId] : [])),
      ),
      invoice.kind === 'INVOICE' ? await this.repository.creditNotesOf(db, invoice.id) : [],
      await this.repository.invoiceablesOfInvoice(db, invoice.id),
    ];
    const credited = invoice.creditedInvoiceId
      ? await this.repository.findAnyInvoice(db, invoice.creditedInvoiceId)
      : null;
    const dueAmount = Money.sum(invoice.dueDates.map((d) => Money.of(d.amount)));
    const settledAmount = Money.sum(invoice.dueDates.map((d) => Money.of(d.settledAmount)));
    const creditable = invoice.kind === 'INVOICE' ? creditableOf(invoice, creditNotes) : null;
    return {
      id: invoice.id,
      kind: invoice.kind,
      reference: invoiceReference(invoice),
      series: invoice.series,
      year: invoice.year,
      number: invoice.number,
      issueDate: fromDbDate(invoice.issueDate),
      partyId: invoice.partyId,
      seller: invoice.seller as Record<string, unknown>,
      customer: invoice.customer as Record<string, unknown>,
      language: invoice.language,
      paymentTerms: invoice.paymentTerms,
      paymentMethod: invoice.paymentMethod,
      iban: invoice.iban,
      notes: invoice.notes,
      lines: invoice.lines.map((line) => lineDto(line, codes)),
      vatSummary: invoice.vatRows.map((row) => ({
        vatCode: row.vatCode,
        rate: row.vatRate.toFixed(2),
        nature: row.vatNature,
        taxable: money(row.taxable),
        vat: money(row.vat),
      })),
      taxableTotal: money(invoice.taxableTotal),
      vatTotal: money(invoice.vatTotal),
      stampDuty: money(invoice.stampDuty),
      total: money(invoice.total),
      dueDates: invoice.dueDates.map((due) => ({
        id: due.id,
        seq: due.seq,
        dueDate: fromDbDate(due.dueDate),
        amount: money(due.amount),
        settledAmount: money(due.settledAmount),
        openAmount: money(due.amount.minus(due.settledAmount)),
      })),
      settledAmount: settledAmount.toString(),
      openAmount: dueAmount.minus(settledAmount).toString(),
      paymentStatus: paymentStatusOf({
        kind: invoice.kind,
        total: Money.of(invoice.total),
        credited: Money.sum(creditNotes.map((n) => Money.of(n.total))),
        dueAmount,
        settledAmount,
      }),
      overdue: invoice.dueDates.some(
        (due) => due.settledAmount.lessThan(due.amount) && fromDbDate(due.dueDate) < today,
      ),
      creditedInvoice: credited ? documentRef(credited) : null,
      creditNotes: creditNotes.map(documentRef),
      creditable: creditable
        ? [...creditable.lines].map(([lineId, left]) => ({
            lineId,
            quantity: fromDecimal(left.quantity, QUANTITY),
            amount: left.amount.toString(),
          }))
        : [],
      creditableTotal: creditable ? creditable.total.toString() : '0.00',
      shipments: shipments.map(shipmentRef),
      issuedAt: invoice.issuedAt.toISOString(),
    } satisfies InvoiceDto;
  }

  async list(db: DbClient, companyId: string, query: InvoicesQuery, today = businessToday()) {
    const { skip, take } = skipAndTake(query);
    const { rows, total } = await this.repository.listInvoices(db, {
      companyId,
      kind: query.kind,
      partyId: query.partyId,
      from: query.from,
      to: query.to,
      q: query.q,
      skip,
      take,
    });
    return {
      items: rows.map((row) => {
        const dueAmount = Money.round(row.dueAmount);
        const settledAmount = Money.round(row.settledAmount);
        const nextDueDate = row.nextDueDate ? fromDbDate(row.nextDueDate) : null;
        return {
          id: row.id,
          kind: row.kind,
          reference: invoiceReference(row),
          issueDate: fromDbDate(row.issueDate),
          partyId: row.partyId,
          partyName: row.partyName,
          total: money(row.total),
          openAmount: dueAmount.minus(settledAmount).toString(),
          paymentStatus: paymentStatusOf({
            kind: row.kind,
            total: Money.of(row.total),
            credited: Money.round(row.credited),
            dueAmount,
            settledAmount,
          }),
          overdue: nextDueDate !== null && nextDueDate < today,
          nextDueDate,
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    } satisfies InvoicePageDto;
  }

  async toInvoice(db: DbClient, companyId: string, query: ToInvoiceQuery) {
    const { skip, take } = skipAndTake(query);
    const { rows, total } = await this.repository.listToInvoice(db, {
      companyId,
      partyId: query.partyId,
      to: query.to,
      skip,
      take,
    });
    const names = await this.repository.partyNames(
      db,
      rows.map((row) => row.partyId),
    );
    return {
      items: rows.map((row) => ({
        ...shipmentRef(row),
        partyId: row.partyId,
        partyName: names.get(row.partyId) ?? '',
        taxableAmount: Money.sum(
          row.lines.map((line) =>
            Money.lineAmount(line.quantity, line.unitPrice, line.discountPercent),
          ),
        ).toString(),
        draftId: row.draftId,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    } satisfies ToInvoicePageDto;
  }
}
