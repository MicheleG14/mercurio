import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { DbClient } from '../../prisma/index.js';
import type { AgingBucket } from './invoicing-stats.dto.js';

type Amount = Prisma.Decimal | null;

/**
 * Aggregates for the overview, computed when asked (docs/adr/0032): sums in SQL on `numeric`,
 * never in JavaScript numbers. A credit note counts against the invoices, a refund or a reversal
 * against the payments.
 */
@Injectable()
export class InvoicingStatsRepository {
  invoicedByMonth(db: DbClient, companyId: string, from: string, to: string) {
    return db.$queryRaw<{ month: number; taxable: Amount; vat: Amount; total: Amount }[]>`
      SELECT extract(month FROM issue_date)::int AS month,
             sum(CASE WHEN kind = 'CREDIT_NOTE' THEN -taxable_total ELSE taxable_total END) AS taxable,
             sum(CASE WHEN kind = 'CREDIT_NOTE' THEN -vat_total ELSE vat_total END) AS vat,
             sum(CASE WHEN kind = 'CREDIT_NOTE' THEN -total ELSE total END) AS total
      FROM invoices
      WHERE company_id = ${companyId}::uuid
        AND issue_date BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1`;
  }

  collectedByMonth(db: DbClient, companyId: string, from: string, to: string) {
    return db.$queryRaw<{ month: number; amount: Amount }[]>`
      SELECT extract(month FROM payment_date)::int AS month,
             sum(amount
                 * CASE WHEN kind = 'REFUND' THEN -1 ELSE 1 END
                 * CASE WHEN reverses_id IS NULL THEN 1 ELSE -1 END) AS amount
      FROM payments
      WHERE company_id = ${companyId}::uuid
        AND payment_date BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1`;
  }

  async years(db: DbClient, companyId: string): Promise<number[]> {
    const rows = await db.$queryRaw<{ year: number }[]>`
      SELECT extract(year FROM issue_date)::int AS year FROM invoices
        WHERE company_id = ${companyId}::uuid
      UNION
      SELECT extract(year FROM payment_date)::int FROM payments
        WHERE company_id = ${companyId}::uuid
      ORDER BY 1 DESC`;
    return rows.map((row) => row.year);
  }

  /** The five customers with the most taxable invoiced in the period, with what they owe today. */
  topCustomers(db: DbClient, companyId: string, from: string, to: string) {
    return db.$queryRaw<{ partyId: string; name: string; taxable: Amount; open: Amount }[]>`
      WITH invoiced AS (
        SELECT party_id,
               sum(CASE WHEN kind = 'CREDIT_NOTE' THEN -taxable_total ELSE taxable_total END)
                 AS taxable
        FROM invoices
        WHERE company_id = ${companyId}::uuid
          AND issue_date BETWEEN ${from}::date AND ${to}::date
        GROUP BY party_id
      ), owed AS (
        SELECT i.party_id, sum(d.amount - d.settled_amount) AS open
        FROM invoice_due_dates d
        JOIN invoices i ON i.id = d.invoice_id
        WHERE d.company_id = ${companyId}::uuid AND i.kind = 'INVOICE'
          AND d.settled_amount < d.amount
        GROUP BY i.party_id
      )
      SELECT p.id AS "partyId", p.name, v.taxable, o.open
      FROM invoiced v
      JOIN registry_party_refs p ON p.id = v.party_id
      LEFT JOIN owed o ON o.party_id = v.party_id
      WHERE v.taxable > 0
      ORDER BY v.taxable DESC, p.name, p.id
      LIMIT 5`;
  }

  /** What customers still owe on invoices, by how many days the due date has passed. */
  aging(db: DbClient, companyId: string, today: string) {
    return db.$queryRaw<{ bucket: AgingBucket; amount: Amount; count: bigint }[]>`
      SELECT CASE
               WHEN d.due_date >= ${today}::date THEN 'NOT_DUE'
               WHEN ${today}::date - d.due_date <= 30 THEN 'DAYS_1_30'
               WHEN ${today}::date - d.due_date <= 60 THEN 'DAYS_31_60'
               WHEN ${today}::date - d.due_date <= 90 THEN 'DAYS_61_90'
               ELSE 'OVER_90'
             END AS bucket,
             sum(d.amount - d.settled_amount) AS amount,
             count(*) AS count
      FROM invoice_due_dates d
      JOIN invoices i ON i.id = d.invoice_id
      WHERE d.company_id = ${companyId}::uuid AND i.kind = 'INVOICE'
        AND d.settled_amount < d.amount
      GROUP BY 1`;
  }
}
