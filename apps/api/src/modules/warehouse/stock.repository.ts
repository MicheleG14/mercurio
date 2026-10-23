import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { DbClient } from '../../prisma/index.js';
import { escapeLike } from '../../shared/text.js';

export interface StockFilter {
  companyId: string;
  warehouseId?: string;
  q?: string;
  belowReorder: boolean;
  includeZero: boolean;
  /** YYYY-MM-DD: stock at the end of that day, from the movements. */
  asOf?: string;
}

export interface StockRow {
  itemId: string;
  code: string;
  description: string;
  unit: string;
  archived: boolean;
  quantity: Prisma.Decimal;
  reorderPoint: Prisma.Decimal | null;
  reorderQuantity: Prisma.Decimal | null;
  below: boolean;
}

const SORTS = {
  code: Prisma.sql`i.code`,
  description: Prisma.sql`i.description`,
  quantity: Prisma.sql`r.quantity`,
};
export type StockSort = keyof typeof SORTS;
export const STOCK_SORTS = Object.keys(SORTS) as StockSort[];

/** `%text%` for ILIKE, with the text's own % and _ escaped. */
const contains = (text: string) => `%${escapeLike(text)}%`;

/**
 * Reads of stock, written in SQL: grouping, windows and joins across many rows. Items and parties
 * come from the views the registry publishes (registry_item_refs, registry_party_refs), never
 * from its tables (docs/adr/0022). Row-Level Security applies to the views too (security_invoker).
 */
@Injectable()
export class StockRepository {
  async list(
    db: DbClient,
    filter: StockFilter,
    sort: { field: StockSort; direction: 'asc' | 'desc' },
    page: { skip: number; take: number },
  ): Promise<{ rows: StockRow[]; total: number }> {
    const rows = this.rowsSql(filter);
    const where = Prisma.sql`
      WHERE (${filter.includeZero}::boolean OR r.quantity <> 0 OR r.below)
        AND (NOT ${filter.belowReorder}::boolean OR r.below)
        AND (${filter.q ?? null}::text IS NULL
             OR i.code ILIKE ${contains(filter.q ?? '')} OR i.description ILIKE ${contains(filter.q ?? '')})`;
    const direction = sort.direction === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    // One after the other: inside a transaction the queries share one connection anyway.
    const items = await db.$queryRaw<StockRow[]>`
        WITH r AS (${rows})
        SELECT i.id AS "itemId", i.code, i.description, i.unit, i.archived_at IS NOT NULL AS archived,
               r.quantity, r.reorder_point AS "reorderPoint", r.reorder_quantity AS "reorderQuantity",
               r.below
        FROM r JOIN registry_item_refs i ON i.id = r.item_id
        ${where}
        ORDER BY ${SORTS[sort.field]} ${direction}, i.code ASC, i.id ASC
        LIMIT ${page.take} OFFSET ${page.skip}`;
    const [count] = await db.$queryRaw<{ total: bigint }[]>`
        WITH r AS (${rows})
        SELECT count(*) AS total FROM r JOIN registry_item_refs i ON i.id = r.item_id
        ${where}`;
    return { rows: items, total: Number(count!.total) };
  }

  /**
   * One row per item: its stock (in the warehouse, or summed over the company's active
   * warehouses), its reorder point and whether some warehouse is at or below it. An item with a
   * reorder level and no movement yet has stock zero and shows up too. With asOf the stock is
   * the sum of the movements up to that day, and reorder levels (a setting of today) are left out.
   */
  private rowsSql(filter: StockFilter): Prisma.Sql {
    const inWarehouse = (column: Prisma.Sql) =>
      filter.warehouseId ? Prisma.sql`AND ${column} = ${filter.warehouseId}::uuid` : Prisma.empty;
    if (filter.asOf) {
      return Prisma.sql`
        SELECT m.item_id, sum(m.quantity) AS quantity, NULL::numeric AS reorder_point,
               NULL::numeric AS reorder_quantity, false AS below
        FROM stock_movements m
        WHERE m.company_id = ${filter.companyId}::uuid AND m.movement_date <= ${filter.asOf}::date
          ${inWarehouse(Prisma.sql`m.warehouse_id`)}
        GROUP BY m.item_id`;
    }
    return Prisma.sql`
      SELECT k.item_id, coalesce(sum(b.quantity), 0) AS quantity,
             sum(l.reorder_point) AS reorder_point, sum(l.reorder_quantity) AS reorder_quantity,
             coalesce(bool_or(l.reorder_point IS NOT NULL
                              AND coalesce(b.quantity, 0) <= l.reorder_point), false) AS below
      FROM (
        SELECT warehouse_id, item_id FROM stock_balances
        WHERE company_id = ${filter.companyId}::uuid ${inWarehouse(Prisma.sql`warehouse_id`)}
        UNION
        SELECT warehouse_id, item_id FROM reorder_levels
        WHERE company_id = ${filter.companyId}::uuid ${inWarehouse(Prisma.sql`warehouse_id`)}
      ) k
      JOIN warehouses w ON w.id = k.warehouse_id AND w.archived_at IS NULL
      LEFT JOIN stock_balances b ON b.warehouse_id = k.warehouse_id AND b.item_id = k.item_id
      LEFT JOIN reorder_levels l ON l.warehouse_id = k.warehouse_id AND l.item_id = k.item_id
      GROUP BY k.item_id`;
  }

  /** Stock and reorder level of one item in each warehouse of the company (empty archived ones left out). */
  itemByWarehouse(db: DbClient, companyId: string, itemId: string) {
    return db.$queryRaw<
      {
        warehouseId: string;
        code: string;
        name: string;
        archived: boolean;
        quantity: Prisma.Decimal;
        reorderPoint: Prisma.Decimal | null;
        reorderQuantity: Prisma.Decimal | null;
        reorderVersion: number | null;
      }[]
    >`
      SELECT w.id AS "warehouseId", w.code, w.name, w.archived_at IS NOT NULL AS archived,
             coalesce(b.quantity, 0) AS quantity, l.reorder_point AS "reorderPoint",
             l.reorder_quantity AS "reorderQuantity", l.version AS "reorderVersion"
      FROM warehouses w
      LEFT JOIN stock_balances b ON b.warehouse_id = w.id AND b.item_id = ${itemId}::uuid
      LEFT JOIN reorder_levels l ON l.warehouse_id = w.id AND l.item_id = ${itemId}::uuid
      WHERE w.company_id = ${companyId}::uuid
        AND (w.archived_at IS NULL OR coalesce(b.quantity, 0) <> 0)
      ORDER BY w.code`;
  }

  /**
   * The movements of an item, newest first, each with the stock right after it. The running sum
   * is computed over every movement, then the period is cut, so the first row of a period starts
   * from the right stock.
   */
  async movements(
    db: DbClient,
    filter: { companyId: string; itemId: string; warehouseId?: string; from?: string; to?: string },
    page: { skip: number; take: number },
  ) {
    const history = Prisma.sql`
      SELECT m.id, m.movement_date, m.created_at, m.quantity, m.warehouse_id, m.document_id,
             sum(m.quantity) OVER (ORDER BY m.movement_date, m.created_at, m.id) AS balance
      FROM stock_movements m
      WHERE m.company_id = ${filter.companyId}::uuid AND m.item_id = ${filter.itemId}::uuid
        ${filter.warehouseId ? Prisma.sql`AND m.warehouse_id = ${filter.warehouseId}::uuid` : Prisma.empty}`;
    const period = Prisma.sql`
      WHERE (${filter.from ?? null}::date IS NULL OR h.movement_date >= ${filter.from ?? null}::date)
        AND (${filter.to ?? null}::date IS NULL OR h.movement_date <= ${filter.to ?? null}::date)`;
    const rows = await db.$queryRaw<
      {
        id: string;
        movementDate: Date;
        documentId: string;
        series: string;
        year: number;
        number: number;
        reason: string;
        warehouseCode: string;
        quantity: Prisma.Decimal;
        balance: Prisma.Decimal;
      }[]
    >`
        WITH h AS (${history})
        SELECT h.id, h.movement_date AS "movementDate", h.document_id AS "documentId", d.series,
               d.year, d.number, d.reason::text AS reason, w.code AS "warehouseCode", h.quantity,
               h.balance
        FROM h
        JOIN stock_documents d ON d.id = h.document_id
        JOIN warehouses w ON w.id = h.warehouse_id
        ${period}
        ORDER BY h.movement_date DESC, h.created_at DESC, h.id DESC
        LIMIT ${page.take} OFFSET ${page.skip}`;
    const [count] = await db.$queryRaw<{ total: bigint }[]>`
        WITH h AS (${history}) SELECT count(*) AS total FROM h ${period}`;
    return { rows, total: Number(count!.total) };
  }

  /** Items that can go on a document line, with their stock in a warehouse when one is given. */
  searchItems(db: DbClient, q: string | undefined, warehouseId: string | undefined) {
    return db.$queryRaw<
      {
        id: string;
        code: string;
        description: string;
        unit: string;
        archived: boolean;
        quantity: Prisma.Decimal | null;
      }[]
    >`
      SELECT i.id, i.code, i.description, i.unit, i.archived_at IS NOT NULL AS archived,
             CASE WHEN ${warehouseId ?? null}::uuid IS NULL THEN NULL
                  ELSE coalesce(b.quantity, 0) END AS quantity
      FROM registry_item_refs i
      LEFT JOIN stock_balances b ON b.item_id = i.id AND b.warehouse_id = ${warehouseId ?? null}::uuid
      WHERE i.stock_managed
        AND (i.archived_at IS NULL OR coalesce(b.quantity, 0) > 0)
        AND (${q ?? null}::text IS NULL OR i.code ILIKE ${contains(q ?? '')}
             OR i.description ILIKE ${contains(q ?? '')})
      ORDER BY i.code
      LIMIT 20`;
  }

  /** Active suppliers or customers, for the party of a document. */
  searchParties(db: DbClient, q: string | undefined, role: 'supplier' | 'customer') {
    return db.$queryRaw<{ id: string; name: string; vatNumber: string | null }[]>`
      SELECT p.id, p.name, p.vat_number AS "vatNumber"
      FROM registry_party_refs p
      WHERE p.archived_at IS NULL
        AND ${role === 'supplier' ? Prisma.sql`p.is_supplier` : Prisma.sql`p.is_customer`}
        AND (${q ?? null}::text IS NULL OR p.name ILIKE ${contains(q ?? '')}
             OR p.vat_number ILIKE ${contains(q ?? '')})
      ORDER BY p.name
      LIMIT 20`;
  }

  async hasMovements(db: DbClient, warehouseId: string): Promise<boolean> {
    return (await db.stockMovement.count({ where: { warehouseId } })) > 0;
  }

  findReorderLevel(db: DbClient, warehouseId: string, itemId: string) {
    return db.reorderLevel.findUnique({ where: { warehouseId_itemId: { warehouseId, itemId } } });
  }

  createReorderLevel(db: DbClient, data: Prisma.ReorderLevelUncheckedCreateInput) {
    return db.reorderLevel.create({ data });
  }

  /** null when the version is old (B29). */
  async updateReorderLevel(
    db: DbClient,
    key: { warehouseId: string; itemId: string },
    version: number,
    data: { reorderPoint: Prisma.Decimal; reorderQuantity: Prisma.Decimal | null },
  ) {
    const [updated] = await db.reorderLevel.updateManyAndReturn({
      where: { ...key, version },
      data: { ...data, version: { increment: 1 } },
    });
    return updated ?? null;
  }

  async deleteReorderLevel(
    db: DbClient,
    key: { warehouseId: string; itemId: string },
    version: number,
  ): Promise<boolean> {
    return (await db.reorderLevel.deleteMany({ where: { ...key, version } })).count > 0;
  }

  /** Differences between each balance and the sum of its movements: empty when consistent (B11). */
  differences(db: DbClient) {
    return db.$queryRaw<
      {
        tenantId: string;
        warehouseId: string;
        itemId: string;
        balance: Prisma.Decimal;
        movements: Prisma.Decimal;
      }[]
    >`
      SELECT coalesce(b.tenant_id, m.tenant_id) AS "tenantId",
             coalesce(b.warehouse_id, m.warehouse_id) AS "warehouseId",
             coalesce(b.item_id, m.item_id) AS "itemId",
             coalesce(b.quantity, 0) AS balance, coalesce(m.total, 0) AS movements
      FROM stock_balances b
      FULL JOIN (SELECT tenant_id, warehouse_id, item_id, sum(quantity) AS total
                 FROM stock_movements GROUP BY tenant_id, warehouse_id, item_id) m
        ON m.warehouse_id = b.warehouse_id AND m.item_id = b.item_id
      WHERE coalesce(b.quantity, 0) <> coalesce(m.total, 0)
      ORDER BY 1, 2, 3`;
  }
}
