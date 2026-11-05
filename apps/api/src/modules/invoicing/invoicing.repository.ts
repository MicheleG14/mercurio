import { Injectable } from '@nestjs/common';
import {
  type InvoiceKind,
  Prisma,
  type Invoice,
  type InvoiceDraft,
  type InvoiceDraftLine,
  type InvoiceDueDate,
  type InvoiceLine,
  type InvoiceVatRow,
  type InvoiceableFulfilment,
  type InvoiceableLine,
} from '../../generated/prisma/client.js';
import type { DbClient } from '../../prisma/index.js';
import { escapeLike } from '../../shared/text.js';

export type InvoiceableFulfilmentRow = InvoiceableFulfilment;
export type InvoiceableRow = InvoiceableFulfilment & { lines: InvoiceableLine[] };
export type DraftRow = InvoiceDraft & { lines: InvoiceDraftLine[] };
export type InvoiceRow = Invoice & {
  lines: InvoiceLine[];
  vatRows: InvoiceVatRow[];
  dueDates: InvoiceDueDate[];
};

/** A line as the use cases write it, for drafts and issued documents alike. */
export type LineData = Omit<
  Prisma.InvoiceDraftLineUncheckedCreateInput,
  'id' | 'tenantId' | 'companyId' | 'draftId'
>;

export interface InvoiceFilter {
  companyId: string;
  kind?: InvoiceKind;
  partyId?: string;
  from?: string;
  to?: string;
  q?: string;
  skip: number;
  take: number;
}

const contains = (text: string) => `%${escapeLike(text)}%`;
const optional = (value: unknown, sql: Prisma.Sql) => (value ? sql : Prisma.empty);

/**
 * The only code that touches the invoicing tables. Parties come from the view the registry
 * publishes (registry_party_refs), never from its table (docs/adr/0022; checked by a test).
 * Queries run one after the other: inside a transaction they share one connection.
 */
@Injectable()
export class InvoicingRepository {
  // ---- Shipments to invoice -------------------------------------------------------------

  findInvoiceable(db: DbClient, fulfilmentId: string): Promise<InvoiceableRow | null> {
    return db.invoiceableFulfilment.findUnique({
      where: { fulfilmentId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
  }

  /** Writes a shipment once: publishing it again finds it there and adds nothing. */
  async createInvoiceable(
    db: DbClient,
    data: Prisma.InvoiceableFulfilmentUncheckedCreateInput,
    lines: Omit<Prisma.InvoiceableLineUncheckedCreateInput, 'tenantId' | 'fulfilmentId'>[],
  ): Promise<boolean> {
    const { count } = await db.invoiceableFulfilment.createMany({
      data: [data],
      skipDuplicates: true,
    });
    if (count === 0) return false;
    await db.invoiceableLine.createMany({
      data: lines.map((line) => ({
        ...line,
        tenantId: data.tenantId,
        fulfilmentId: data.fulfilmentId,
      })),
    });
    return true;
  }

  async deleteInvoiceable(db: DbClient, fulfilmentId: string): Promise<void> {
    await db.invoiceableLine.deleteMany({ where: { fulfilmentId } });
    await db.invoiceableFulfilment.deleteMany({ where: { fulfilmentId } });
  }

  /** Shipments of the company, locked in a fixed order (B34): drafts take them one at a time. */
  async lockInvoiceables(
    db: DbClient,
    companyId: string,
    fulfilmentIds: readonly string[],
  ): Promise<InvoiceableRow[]> {
    if (fulfilmentIds.length === 0) return [];
    const ids = [...new Set(fulfilmentIds)].sort();
    await db.$queryRaw`
      SELECT fulfilment_id FROM invoiceable_fulfilments
      WHERE company_id = ${companyId}::uuid AND fulfilment_id = ANY(${ids}::uuid[])
      ORDER BY fulfilment_id
      FOR UPDATE`;
    return db.invoiceableFulfilment.findMany({
      where: { companyId, fulfilmentId: { in: ids } },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
      orderBy: [{ documentDate: 'asc' }, { fulfilmentId: 'asc' }],
    });
  }

  async setDraftOf(db: DbClient, fulfilmentIds: readonly string[], draftId: string | null) {
    if (fulfilmentIds.length === 0) return;
    await db.invoiceableFulfilment.updateMany({
      where: { fulfilmentId: { in: [...fulfilmentIds] } },
      data: { draftId },
    });
  }

  async markInvoiced(db: DbClient, fulfilmentIds: readonly string[], invoiceId: string) {
    if (fulfilmentIds.length === 0) return;
    await db.invoiceableFulfilment.updateMany({
      where: { fulfilmentId: { in: [...fulfilmentIds] } },
      data: { draftId: null, invoiceId },
    });
  }

  invoiceablesOfDraft(db: DbClient, draftId: string): Promise<InvoiceableRow[]> {
    return db.invoiceableFulfilment.findMany({
      where: { draftId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
      orderBy: [{ documentDate: 'asc' }, { fulfilmentId: 'asc' }],
    });
  }

  invoiceablesOfInvoice(db: DbClient, invoiceId: string) {
    return db.invoiceableFulfilment.findMany({
      where: { invoiceId },
      orderBy: [{ documentDate: 'asc' }, { fulfilmentId: 'asc' }],
    });
  }

  /** Shipments not yet invoiced, oldest first, with the customer's name. */
  async listToInvoice(
    db: DbClient,
    filter: { companyId: string; partyId?: string; to?: string; skip: number; take: number },
  ) {
    const where: Prisma.InvoiceableFulfilmentWhereInput = {
      companyId: filter.companyId,
      invoiceId: null,
      ...(filter.partyId ? { partyId: filter.partyId } : {}),
      ...(filter.to ? { documentDate: { lte: new Date(`${filter.to}T00:00:00.000Z`) } } : {}),
    };
    const [rows, total] = [
      await db.invoiceableFulfilment.findMany({
        where,
        include: { lines: true },
        orderBy: [{ documentDate: 'asc' }, { fulfilmentId: 'asc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      await db.invoiceableFulfilment.count({ where }),
    ];
    return { rows, total };
  }

  countToInvoice(db: DbClient, companyId: string) {
    return db.invoiceableFulfilment.count({ where: { companyId, invoiceId: null } });
  }

  // ---- Drafts --------------------------------------------------------------------------------

  findDraft(db: DbClient, companyId: string, id: string): Promise<DraftRow | null> {
    return db.invoiceDraft.findFirst({
      where: { id, companyId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
  }

  /** Any draft with this id, in any company of the tenant: ids are unique in the table. */
  findAnyDraft(db: DbClient, id: string) {
    return db.invoiceDraft.findUnique({ where: { id } });
  }

  async lockDraft(db: DbClient, companyId: string, id: string): Promise<DraftRow | null> {
    const [row] = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM invoice_drafts WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE`;
    return row ? this.findDraft(db, companyId, id) : null;
  }

  async createDraft(
    db: DbClient,
    data: Prisma.InvoiceDraftUncheckedCreateInput,
    lines: readonly LineData[],
  ): Promise<void> {
    await db.invoiceDraft.create({ data });
    await this.insertDraftLines(db, data, lines);
  }

  /** Saves a draft at this version, its lines replaced; false when the version is old. */
  async replaceDraft(
    db: DbClient,
    draft: { id: string; tenantId: string; companyId: string },
    version: number,
    data: Prisma.InvoiceDraftUncheckedUpdateManyInput,
    lines: readonly LineData[],
  ): Promise<boolean> {
    const { count } = await db.invoiceDraft.updateMany({
      where: { id: draft.id, version },
      data: { ...data, version: { increment: 1 } },
    });
    if (count === 0) return false;
    await db.invoiceDraftLine.deleteMany({ where: { draftId: draft.id } });
    await this.insertDraftLines(db, draft, lines);
    return true;
  }

  private async insertDraftLines(
    db: DbClient,
    draft: { id: string; tenantId: string; companyId: string },
    lines: readonly LineData[],
  ) {
    if (lines.length === 0) return;
    await db.invoiceDraftLine.createMany({
      data: lines.map((line) => ({
        ...line,
        tenantId: draft.tenantId,
        companyId: draft.companyId,
        draftId: draft.id,
      })),
    });
  }

  /** Deletes a draft with its lines, releasing its shipments first (they point to it). */
  async deleteDraft(db: DbClient, id: string): Promise<void> {
    await db.invoiceableFulfilment.updateMany({ where: { draftId: id }, data: { draftId: null } });
    await db.invoiceDraftLine.deleteMany({ where: { draftId: id } });
    await db.invoiceDraft.deleteMany({ where: { id } });
  }

  async listDrafts(db: DbClient, companyId: string, skip: number, take: number) {
    const where = { companyId };
    return {
      rows: await db.invoiceDraft.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      total: await db.invoiceDraft.count({ where }),
    };
  }

  // ---- Issued documents ---------------------------------------------------------------------

  /**
   * The document with its lines, VAT rows and due dates, one relation at a time: an `include`
   * of several relations makes Prisma run their queries side by side on the transaction's
   * single connection (B39).
   */
  async findInvoice(db: DbClient, companyId: string, id: string): Promise<InvoiceRow | null> {
    const invoice = await db.invoice.findFirst({ where: { id, companyId } });
    if (!invoice) return null;
    const where = { invoiceId: invoice.id };
    const lines = await db.invoiceLine.findMany({ where, orderBy: { lineNo: 'asc' } });
    const vatRows = await db.invoiceVatRow.findMany({ where, orderBy: { vatCode: 'asc' } });
    const dueDates = await db.invoiceDueDate.findMany({ where, orderBy: { seq: 'asc' } });
    return { ...invoice, lines, vatRows, dueDates };
  }

  findAnyInvoice(db: DbClient, id: string) {
    return db.invoice.findUnique({ where: { id } });
  }

  /** Credit notes issued about an invoice, oldest first, with their lines. */
  creditNotesOf(db: DbClient, invoiceId: string) {
    return db.invoice.findMany({
      where: { creditedInvoiceId: invoiceId },
      include: { lines: true },
      orderBy: [{ issueDate: 'asc' }, { number: 'asc' }],
    });
  }

  /**
   * The next number of a series (B38): no gaps, the counter row locked till commit, and only if
   * the date is not before the last one of the series, checked in the same statement (two first
   * documents of a year cannot both pass). Null when the date comes before the last one.
   */
  async nextNumber(
    db: DbClient,
    owner: { tenantId: string; companyId: string },
    series: string,
    year: number,
    date: string,
  ): Promise<number | null> {
    const [row] = await db.$queryRaw<{ lastNumber: number }[]>`
      INSERT INTO invoice_counters (tenant_id, company_id, series, year, last_number, last_date)
      VALUES (${owner.tenantId}::uuid, ${owner.companyId}::uuid, ${series}, ${year}, 1,
              ${date}::date)
      ON CONFLICT (company_id, series, year)
        DO UPDATE SET last_number = invoice_counters.last_number + 1, last_date = EXCLUDED.last_date
        WHERE invoice_counters.last_date <= EXCLUDED.last_date
      RETURNING last_number AS "lastNumber"`;
    return row?.lastNumber ?? null;
  }

  async lastDate(db: DbClient, companyId: string, series: string, year: number) {
    const counter = await db.invoiceCounter.findUnique({
      where: { companyId_series_year: { companyId, series, year } },
    });
    return counter?.lastDate ?? null;
  }

  async createInvoice(
    db: DbClient,
    data: Prisma.InvoiceUncheckedCreateInput,
    lines: readonly LineData[],
    vatRows: readonly Omit<
      Prisma.InvoiceVatRowUncheckedCreateInput,
      'tenantId' | 'companyId' | 'invoiceId'
    >[],
    dueDates: readonly { seq: number; dueDate: Date; amount: Prisma.Decimal }[],
  ): Promise<void> {
    const owner = { tenantId: data.tenantId, companyId: data.companyId, invoiceId: data.id };
    await db.invoice.create({ data });
    await db.invoiceLine.createMany({
      data: lines.map(({ fulfilmentId, orderLineId, ...line }) => ({
        ...line,
        fulfilmentId: fulfilmentId ?? null,
        orderLineId: orderLineId ?? null,
        tenantId: owner.tenantId,
        companyId: owner.companyId,
        invoiceId: owner.invoiceId,
      })),
    });
    await db.invoiceVatRow.createMany({ data: vatRows.map((row) => ({ ...row, ...owner })) });
    if (dueDates.length > 0) {
      await db.invoiceDueDate.createMany({ data: dueDates.map((due) => ({ ...due, ...owner })) });
    }
  }

  /** The due dates of these documents, locked in a fixed order (B34). */
  async lockDueDates(db: DbClient, invoiceIds: readonly string[]): Promise<InvoiceDueDate[]> {
    if (invoiceIds.length === 0) return [];
    const ids = [...new Set(invoiceIds)];
    await db.$queryRaw`
      SELECT id FROM invoice_due_dates WHERE invoice_id = ANY(${ids}::uuid[])
      ORDER BY invoice_id, seq
      FOR UPDATE`;
    return db.invoiceDueDate.findMany({
      where: { invoiceId: { in: ids } },
      orderBy: [{ invoiceId: 'asc' }, { seq: 'asc' }],
    });
  }

  setSettled(db: DbClient, dueDateId: string, settledAmount: Prisma.Decimal) {
    return db.invoiceDueDate.update({ where: { id: dueDateId }, data: { settledAmount } });
  }

  createCreditAllocations(
    db: DbClient,
    owner: { tenantId: string; companyId: string; creditNoteId: string },
    allocations: readonly { dueDateId: string; amount: Prisma.Decimal }[],
  ) {
    return db.creditAllocation.createMany({
      data: allocations.map((allocation) => ({ ...allocation, ...owner })),
    });
  }

  /** Issued documents of the company, newest first, with what is still open. */
  async listInvoices(db: DbClient, filter: InvoiceFilter) {
    const conditions = Prisma.sql`
      i.company_id = ${filter.companyId}::uuid
      ${optional(filter.kind, Prisma.sql`AND i.kind = ${filter.kind}::invoice_kind`)}
      ${optional(filter.partyId, Prisma.sql`AND i.party_id = ${filter.partyId}::uuid`)}
      ${optional(filter.from, Prisma.sql`AND i.issue_date >= ${filter.from}::date`)}
      ${optional(filter.to, Prisma.sql`AND i.issue_date <= ${filter.to}::date`)}
      ${optional(
        filter.q,
        Prisma.sql`AND (p.name ILIKE ${contains(filter.q ?? '')}
                    OR (i.number::text || '/' || i.year::text) LIKE ${contains(filter.q ?? '')})`,
      )}`;
    const rows = await db.$queryRaw<
      {
        id: string;
        kind: InvoiceKind;
        series: string;
        year: number;
        number: number;
        issueDate: Date;
        partyId: string;
        partyName: string;
        total: Prisma.Decimal;
        dueAmount: Prisma.Decimal;
        settledAmount: Prisma.Decimal;
        credited: Prisma.Decimal;
        nextDueDate: Date | null;
        creditedInvoiceId: string | null;
      }[]
    >`
      SELECT i.id, i.kind, i.series, i.year, i.number, i.issue_date AS "issueDate",
             i.party_id AS "partyId", p.name AS "partyName", i.total,
             coalesce(d.amount, 0) AS "dueAmount", coalesce(d.settled, 0) AS "settledAmount",
             coalesce(c.credited, 0) AS credited, d.next_due AS "nextDueDate",
             i.credited_invoice_id AS "creditedInvoiceId"
      FROM invoices i
      JOIN registry_party_refs p ON p.id = i.party_id
      LEFT JOIN LATERAL (
        SELECT sum(amount) AS amount, sum(settled_amount) AS settled,
               min(due_date) FILTER (WHERE settled_amount < amount) AS next_due
        FROM invoice_due_dates WHERE invoice_id = i.id) d ON true
      LEFT JOIN LATERAL (
        SELECT sum(total) AS credited FROM invoices n WHERE n.credited_invoice_id = i.id) c ON true
      WHERE ${conditions}
      ORDER BY i.issue_date DESC, i.series, i.number DESC
      OFFSET ${filter.skip} LIMIT ${filter.take}`;
    const [{ total }] = (await db.$queryRaw<{ total: bigint }[]>`
      SELECT count(*) AS total FROM invoices i JOIN registry_party_refs p ON p.id = i.party_id
      WHERE ${conditions}`) as [{ total: bigint }];
    return { rows, total: Number(total) };
  }

  /** Active customers for the customer of an invoice. */
  searchCustomers(db: DbClient, q: string | undefined) {
    return db.$queryRaw<{ id: string; name: string; vatNumber: string | null }[]>`
      SELECT p.id, p.name, p.vat_number AS "vatNumber"
      FROM registry_party_refs p
      WHERE p.archived_at IS NULL AND p.is_customer
        AND (${q ?? null}::text IS NULL OR p.name ILIKE ${contains(q ?? '')}
             OR p.vat_number ILIKE ${contains(q ?? '')})
      ORDER BY p.name
      LIMIT 20`;
  }

  /** Active items, goods and services, for a line of an invoice. */
  searchItems(db: DbClient, q: string | undefined) {
    return db.$queryRaw<
      {
        id: string;
        code: string;
        description: string;
        unit: string;
        salePrice: Prisma.Decimal | null;
        vatCode: string;
      }[]
    >`
      SELECT i.id, i.code, i.description, i.unit, i.sale_price AS "salePrice",
             i.vat_code AS "vatCode"
      FROM registry_item_refs i
      WHERE i.archived_at IS NULL
        AND (${q ?? null}::text IS NULL OR i.code ILIKE ${contains(q ?? '')}
             OR i.description ILIKE ${contains(q ?? '')})
      ORDER BY i.code
      LIMIT 20`;
  }

  /** Names of parties, through the registry's view. */
  async partyNames(db: DbClient, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await db.$queryRaw<{ id: string; name: string }[]>`
      SELECT id, name FROM registry_party_refs WHERE id = ANY(${[...new Set(ids)]}::uuid[])`;
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /** Codes of items, through the registry's view. */
  async itemCodes(db: DbClient, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await db.$queryRaw<{ id: string; code: string }[]>`
      SELECT id, code FROM registry_item_refs WHERE id = ANY(${[...new Set(ids)]}::uuid[])`;
    return new Map(rows.map((row) => [row.id, row.code]));
  }
}
