import { Injectable } from '@nestjs/common';
import {
  type InvoiceKind,
  Prisma,
  type Payment,
  type PaymentAllocation,
} from '../../generated/prisma/client.js';
import type { DbClient } from '../../prisma/index.js';

export type PaymentRow = Payment & { allocations: PaymentAllocation[] };

const optional = (value: unknown, sql: Prisma.Sql) => (value ? sql : Prisma.empty);

/** A due date with its document, as payments and the payment schedule see it. */
export interface DueDateRow {
  id: string;
  invoiceId: string;
  kind: InvoiceKind;
  series: string;
  year: number;
  number: number;
  issueDate: Date;
  partyId: string;
  partyName: string;
  seq: number;
  dueDate: Date;
  amount: Prisma.Decimal;
  settledAmount: Prisma.Decimal;
}

export interface DueDateFilter {
  companyId: string;
  status?: 'open' | 'overdue' | 'paid';
  partyId?: string;
  from?: string;
  to?: string;
  today: string;
  skip: number;
  take: number;
}

/**
 * Payments, their allocations and the due dates they settle. Parties come from the registry's
 * view, as for documents.
 */
@Injectable()
export class PaymentsRepository {
  findPayment(db: DbClient, companyId: string, id: string): Promise<PaymentRow | null> {
    return db.payment.findFirst({ where: { id, companyId }, include: { allocations: true } });
  }

  findAnyPayment(db: DbClient, id: string) {
    return db.payment.findUnique({ where: { id }, include: { allocations: true } });
  }

  reversalOf(db: DbClient, companyId: string, id: string) {
    return db.payment.findFirst({ where: { companyId, reversesId: id } });
  }

  async createPayment(
    db: DbClient,
    data: Prisma.PaymentUncheckedCreateInput,
    allocations: readonly { dueDateId: string; amount: Prisma.Decimal }[],
  ): Promise<void> {
    await db.payment.create({ data });
    await db.paymentAllocation.createMany({
      data: allocations.map((allocation) => ({
        ...allocation,
        tenantId: data.tenantId,
        companyId: data.companyId,
        paymentId: data.id,
      })),
    });
  }

  /** The due dates with their documents, among these ids, in the company. */
  dueDatesByIds(db: DbClient, companyId: string, ids: readonly string[]) {
    if (ids.length === 0) return Promise.resolve([] as DueDateRow[]);
    return db.$queryRaw<DueDateRow[]>`
      SELECT d.id, d.invoice_id AS "invoiceId", i.kind, i.series, i.year, i.number,
             i.issue_date AS "issueDate", i.party_id AS "partyId", p.name AS "partyName",
             d.seq, d.due_date AS "dueDate", d.amount, d.settled_amount AS "settledAmount"
      FROM invoice_due_dates d
      JOIN invoices i ON i.id = d.invoice_id
      JOIN registry_party_refs p ON p.id = i.party_id
      WHERE d.company_id = ${companyId}::uuid AND d.id = ANY(${[...new Set(ids)]}::uuid[])
      ORDER BY d.invoice_id, d.seq`;
  }

  /** The payment schedule: due dates of the company, by date, with their totals. */
  async listDueDates(db: DbClient, filter: DueDateFilter) {
    const status =
      filter.status === 'paid'
        ? Prisma.sql`AND d.settled_amount = d.amount`
        : filter.status === 'overdue'
          ? Prisma.sql`AND d.settled_amount < d.amount AND d.due_date < ${filter.today}::date`
          : filter.status === 'open'
            ? Prisma.sql`AND d.settled_amount < d.amount`
            : Prisma.empty;
    const conditions = Prisma.sql`
      d.company_id = ${filter.companyId}::uuid ${status}
      ${optional(filter.partyId, Prisma.sql`AND i.party_id = ${filter.partyId}::uuid`)}
      ${optional(filter.from, Prisma.sql`AND d.due_date >= ${filter.from}::date`)}
      ${optional(filter.to, Prisma.sql`AND d.due_date <= ${filter.to}::date`)}`;
    const rows = await db.$queryRaw<DueDateRow[]>`
      SELECT d.id, d.invoice_id AS "invoiceId", i.kind, i.series, i.year, i.number,
             i.issue_date AS "issueDate", i.party_id AS "partyId", p.name AS "partyName",
             d.seq, d.due_date AS "dueDate", d.amount, d.settled_amount AS "settledAmount"
      FROM invoice_due_dates d
      JOIN invoices i ON i.id = d.invoice_id
      JOIN registry_party_refs p ON p.id = i.party_id
      WHERE ${conditions}
      ORDER BY d.due_date, i.series, i.number, d.seq
      OFFSET ${filter.skip} LIMIT ${filter.take}`;
    // Credit notes owe the customer: their open amount counts against what customers owe.
    const [totals] = await db.$queryRaw<
      { count: bigint; open: Prisma.Decimal | null; overdue: Prisma.Decimal | null }[]
    >`
      SELECT count(*) AS count,
             sum(CASE WHEN i.kind = 'CREDIT_NOTE' THEN -1 ELSE 1 END
                 * (d.amount - d.settled_amount)) AS open,
             sum(CASE WHEN i.kind = 'CREDIT_NOTE' THEN -1 ELSE 1 END
                 * (d.amount - d.settled_amount))
               FILTER (WHERE d.due_date < ${filter.today}::date) AS overdue
      FROM invoice_due_dates d
      JOIN invoices i ON i.id = d.invoice_id
      JOIN registry_party_refs p ON p.id = i.party_id
      WHERE ${conditions}`;
    return { rows, totals: totals! };
  }

  async listPayments(
    db: DbClient,
    filter: { companyId: string; partyId?: string; from?: string; to?: string },
    skip: number,
    take: number,
  ) {
    const where: Prisma.PaymentWhereInput = {
      companyId: filter.companyId,
      ...(filter.partyId ? { partyId: filter.partyId } : {}),
      ...(filter.from || filter.to
        ? {
            paymentDate: {
              ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00.000Z`) } : {}),
              ...(filter.to ? { lte: new Date(`${filter.to}T00:00:00.000Z`) } : {}),
            },
          }
        : {}),
    };
    return {
      rows: await db.payment.findMany({
        where,
        include: { allocations: true, reversedBy: { select: { id: true } } },
        orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      total: await db.payment.count({ where }),
    };
  }

  /** For the overview: what customers owe, what is late, what falls due in the next 30 days. */
  async summary(db: DbClient, companyId: string, today: string, in30: string, monthStart: string) {
    const [row] = await db.$queryRaw<
      {
        overdue: Prisma.Decimal | null;
        dueSoon: Prisma.Decimal | null;
        invoicedThisMonth: Prisma.Decimal | null;
        drafts: bigint;
      }[]
    >`
      SELECT
        (SELECT sum(d.amount - d.settled_amount) FROM invoice_due_dates d
           JOIN invoices i ON i.id = d.invoice_id
           WHERE d.company_id = ${companyId}::uuid AND i.kind = 'INVOICE'
             AND d.settled_amount < d.amount AND d.due_date < ${today}::date) AS overdue,
        (SELECT sum(d.amount - d.settled_amount) FROM invoice_due_dates d
           JOIN invoices i ON i.id = d.invoice_id
           WHERE d.company_id = ${companyId}::uuid AND i.kind = 'INVOICE'
             AND d.settled_amount < d.amount
             AND d.due_date BETWEEN ${today}::date AND ${in30}::date) AS "dueSoon",
        (SELECT sum(CASE WHEN kind = 'CREDIT_NOTE' THEN -taxable_total ELSE taxable_total END)
           FROM invoices WHERE company_id = ${companyId}::uuid
             AND issue_date >= ${monthStart}::date) AS "invoicedThisMonth",
        (SELECT count(*) FROM invoice_drafts WHERE company_id = ${companyId}::uuid) AS drafts`;
    return row!;
  }

  /**
   * Due dates whose settled amount differs from what settles them: payments and credit notes.
   * Reports, never fixes (B11). Run by the operator, across tenants.
   */
  verify(db: DbClient) {
    return db.$queryRaw<
      {
        tenantId: string;
        dueDateId: string;
        settled: Prisma.Decimal;
        allocated: Prisma.Decimal;
      }[]
    >`
      SELECT d.tenant_id AS "tenantId", d.id AS "dueDateId", d.settled_amount AS settled,
             coalesce(pa.amount, 0) + coalesce(ca.amount, 0) AS allocated
      FROM invoice_due_dates d
      LEFT JOIN (SELECT due_date_id, sum(amount) AS amount FROM payment_allocations
                 GROUP BY due_date_id) pa ON pa.due_date_id = d.id
      LEFT JOIN (SELECT due_date_id, sum(amount) AS amount FROM credit_allocations
                 GROUP BY due_date_id) ca ON ca.due_date_id = d.id
      WHERE d.settled_amount <> coalesce(pa.amount, 0) + coalesce(ca.amount, 0)
      ORDER BY d.tenant_id, d.id`;
  }
}
