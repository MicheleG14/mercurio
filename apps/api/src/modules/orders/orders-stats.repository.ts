import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { DbClient } from '../../prisma/index.js';

type Amount = Prisma.Decimal | null;

/** Statuses of a sales order that was confirmed: its lines are a promise to the customer. */
const CONFIRMED = Prisma.sql`('CONFIRMED', 'PARTIAL', 'COMPLETED')`;
const OPEN = Prisma.sql`('CONFIRMED', 'PARTIAL')`;

/**
 * The amount of `quantity` of an order line, rounded once to the cent as `Money.lineAmount` does
 * (B36): PostgreSQL rounds `numeric` half away from zero, like `Money`.
 */
const amountOf = (quantity: Prisma.Sql) =>
  Prisma.sql`round(${quantity} * l.unit_price * (100 - l.discount_percent) / 100, 2)`;

/** Aggregates of the sales orders for the overview (docs/adr/0032). */
@Injectable()
export class OrdersStatsRepository {
  orderedByMonth(db: DbClient, companyId: string, from: string, to: string) {
    return db.$queryRaw<{ month: number; amount: Amount }[]>`
      SELECT extract(month FROM order_date)::int AS month, sum(taxable_total) AS amount
      FROM orders
      WHERE company_id = ${companyId}::uuid AND kind = 'SALES' AND status IN ${CONFIRMED}
        AND order_date BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1`;
  }

  /** Shipments not undone, valued at the price of their order line. */
  shippedByMonth(db: DbClient, companyId: string, from: string, to: string) {
    return db.$queryRaw<{ month: number; amount: Amount }[]>`
      SELECT extract(month FROM f.fulfilment_date)::int AS month,
             sum(${amountOf(Prisma.sql`fl.quantity`)}) AS amount
      FROM order_fulfilments f
      JOIN orders o ON o.id = f.order_id
      JOIN order_fulfilment_lines fl ON fl.fulfilment_id = f.id
      JOIN order_lines l ON l.id = fl.order_line_id
      WHERE f.company_id = ${companyId}::uuid AND o.kind = 'SALES' AND f.reversed_at IS NULL
        AND l.unit_price IS NOT NULL
        AND f.fulfilment_date BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1`;
  }

  async years(db: DbClient, companyId: string): Promise<number[]> {
    const rows = await db.$queryRaw<{ year: number }[]>`
      SELECT extract(year FROM order_date)::int AS year FROM orders
        WHERE company_id = ${companyId}::uuid AND kind = 'SALES' AND status IN ${CONFIRMED}
      UNION
      SELECT extract(year FROM f.fulfilment_date)::int FROM order_fulfilments f
        JOIN orders o ON o.id = f.order_id
        WHERE f.company_id = ${companyId}::uuid AND o.kind = 'SALES'
      ORDER BY 1 DESC`;
    return rows.map((row) => row.year);
  }

  /** What is left to ship on the open sales orders, per customer, largest first. */
  backlogByCustomer(db: DbClient, companyId: string) {
    return db.$queryRaw<{ partyId: string; name: string; amount: Amount }[]>`
      SELECT p.id AS "partyId", p.name,
             sum(${amountOf(Prisma.sql`(l.quantity - l.done_quantity - l.closed_quantity)`)})
               AS amount
      FROM orders o
      JOIN order_lines l ON l.order_id = o.id
      JOIN registry_party_refs p ON p.id = o.party_id
      WHERE o.company_id = ${companyId}::uuid AND o.kind = 'SALES' AND o.status IN ${OPEN}
        AND l.unit_price IS NOT NULL
        AND l.quantity - l.done_quantity - l.closed_quantity > 0
      GROUP BY p.id, p.name
      ORDER BY amount DESC, p.name, p.id`;
  }
}
