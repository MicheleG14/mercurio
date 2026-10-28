import { Injectable } from '@nestjs/common';
import {
  type OrderKind,
  type OrderStatus,
  Prisma,
  type Order,
  type OrderFulfilment,
  type OrderFulfilmentLine,
  type OrderLine,
} from '../../generated/prisma/client.js';
import type { DbClient } from '../../prisma/index.js';
import { escapeLike } from '../../shared/text.js';
import { ORIGIN_TYPE } from './order-kinds.js';

/** An order with its lines and fulfilments, as the use cases see it. */
export type OrderRow = Order & {
  lines: OrderLine[];
  fulfilments: (OrderFulfilment & { lines: OrderFulfilmentLine[] })[];
};

export interface OrderFilter {
  companyId: string;
  kind: OrderKind;
  status?: OrderStatus | 'OPEN';
  partyId?: string;
  warehouseId?: string;
  from?: string;
  to?: string;
  q?: string;
  reference?: { series: string; year: number; number: number } | null;
  uncovered: boolean;
  late: boolean;
  /** Today, for "late". */
  today: string;
}

export interface OrderListRow {
  id: string;
  kind: OrderKind;
  status: OrderStatus;
  series: string | null;
  year: number | null;
  number: number | null;
  orderDate: Date;
  partyId: string;
  partyName: string;
  warehouseId: string | null;
  warehouseCode: string | null;
  partyReference: string | null;
  requestedDate: Date | null;
  taxableTotal: Prisma.Decimal;
  total: Prisma.Decimal;
  lineCount: bigint;
  late: boolean;
  uncovered: boolean;
  version: number;
}

const SORTS = {
  date: (d: Prisma.Sql) => Prisma.sql`r."orderDate" ${d}, r."createdAt" ${d}`,
  number: (d: Prisma.Sql) => Prisma.sql`r.year ${d} NULLS LAST, r.number ${d} NULLS LAST`,
  requestedDate: (d: Prisma.Sql) => Prisma.sql`r."requestedDate" ${d} NULLS LAST`,
  party: (d: Prisma.Sql) => Prisma.sql`r."partyName" ${d}`,
  total: (d: Prisma.Sql) => Prisma.sql`r.total ${d}`,
};
export type OrderSort = keyof typeof SORTS;
export const ORDER_SORTS = Object.keys(SORTS) as OrderSort[];

const contains = (text: string) => `%${escapeLike(text)}%`;
const OPEN = Prisma.sql`('CONFIRMED', 'PARTIAL')`;
/** What is still to move on a line. */
const REMAINING = Prisma.sql`(l.quantity - l.done_quantity - l.closed_quantity)`;

/**
 * The only code that touches orders, their lines, fulfilments and counters. Items, parties,
 * warehouses, stock and reservations come from the views other modules publish
 * (registry_item_refs, registry_party_refs, warehouse_refs, warehouse_stock_refs,
 * warehouse_reservation_refs), never from their tables (docs/adr/0022; checked by a test).
 * Queries run one after the other: inside a transaction they share one connection.
 */
@Injectable()
export class OrdersRepository {
  async findById(db: DbClient, companyId: string, id: string): Promise<OrderRow | null> {
    const order = await db.order.findFirst({ where: { id, companyId } });
    return order ? this.withChildren(db, order) : null;
  }

  /** Any order with this id, in any company of the tenant: ids are unique in the table. */
  findAnyById(db: DbClient, id: string) {
    return db.order.findUnique({ where: { id } });
  }

  /**
   * Locks the order until the transaction ends, then reads it: the first lock of every action on
   * an order (B34), so two actions on the same order queue up and the second sees the first.
   */
  async lock(db: DbClient, companyId: string, id: string): Promise<OrderRow | null> {
    const [row] = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM orders WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE`;
    return row ? this.findById(db, companyId, id) : null;
  }

  private async withChildren(db: DbClient, order: Order): Promise<OrderRow> {
    const lines = await db.orderLine.findMany({
      where: { orderId: order.id },
      orderBy: { lineNo: 'asc' },
    });
    const fulfilments = await db.orderFulfilment.findMany({
      where: { orderId: order.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const fulfilmentLines = await db.orderFulfilmentLine.findMany({
      where: { orderId: order.id },
    });
    return {
      ...order,
      lines,
      fulfilments: fulfilments.map((f) => ({
        ...f,
        lines: fulfilmentLines.filter((l) => l.fulfilmentId === f.id),
      })),
    };
  }

  async create(
    db: DbClient,
    order: Prisma.OrderUncheckedCreateInput,
    lines: Omit<Prisma.OrderLineCreateManyInput, 'orderId'>[],
  ) {
    const created = await db.order.create({ data: order });
    await this.insertLines(db, created.id, lines);
    return created;
  }

  /** The lines of a draft, all replaced: a draft has no reservations or fulfilments yet. */
  async replaceLines(
    db: DbClient,
    orderId: string,
    lines: Omit<Prisma.OrderLineCreateManyInput, 'orderId'>[],
  ) {
    await db.orderLine.deleteMany({ where: { orderId } });
    await this.insertLines(db, orderId, lines);
  }

  private async insertLines(
    db: DbClient,
    orderId: string,
    lines: Omit<Prisma.OrderLineCreateManyInput, 'orderId'>[],
  ) {
    if (lines.length === 0) return;
    await db.orderLine.createMany({ data: lines.map((line) => ({ ...line, orderId })) });
  }

  /** null when the version is old (B29). */
  async updateAtVersion(
    db: DbClient,
    id: string,
    version: number,
    data: Prisma.OrderUncheckedUpdateManyInput,
  ) {
    const [updated] = await db.order.updateManyAndReturn({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });
    return updated ?? null;
  }

  /** Deletes a draft at this version, with its lines; false when there is none. */
  async deleteDraft(db: DbClient, id: string, version: number): Promise<boolean> {
    // Lines first: the API role deletes them itself, the cascade is the safety net.
    const draft = await db.order.findFirst({ where: { id, version, status: 'DRAFT' } });
    if (!draft) return false;
    await db.orderLine.deleteMany({ where: { orderId: id } });
    return (await db.order.deleteMany({ where: { id, version, status: 'DRAFT' } })).count > 0;
  }

  /** As StockDocumentsRepository.nextNumber: no gaps (B32), the counter row locked till commit. */
  async nextNumber(
    db: DbClient,
    owner: { tenantId: string; companyId: string },
    series: string,
    year: number,
  ): Promise<number> {
    const [row] = await db.$queryRaw<{ lastNumber: number }[]>`
      INSERT INTO order_counters (tenant_id, company_id, series, year, last_number)
      VALUES (${owner.tenantId}::uuid, ${owner.companyId}::uuid, ${series}, ${year}, 1)
      ON CONFLICT (company_id, series, year)
        DO UPDATE SET last_number = order_counters.last_number + 1
      RETURNING last_number AS "lastNumber"`;
    return row!.lastNumber;
  }

  setLineProgress(
    db: DbClient,
    id: string,
    progress: { doneQuantity?: Prisma.Decimal; closedQuantity?: Prisma.Decimal },
  ) {
    return db.orderLine.update({ where: { id }, data: progress });
  }

  findFulfilment(db: DbClient, id: string) {
    return db.orderFulfilment.findUnique({ where: { id } });
  }

  async createFulfilment(
    db: DbClient,
    fulfilment: Prisma.OrderFulfilmentUncheckedCreateInput,
    lines: { orderLineId: string; quantity: Prisma.Decimal }[],
  ) {
    await db.orderFulfilment.create({ data: fulfilment });
    await db.orderFulfilmentLine.createMany({
      data: lines.map((line) => ({
        tenantId: fulfilment.tenantId,
        orderId: fulfilment.orderId,
        fulfilmentId: fulfilment.id,
        ...line,
      })),
    });
  }

  markFulfilmentReversed(db: DbClient, id: string, reversalDocumentId: string) {
    return db.orderFulfilment.update({
      where: { id },
      data: { reversalDocumentId, reversedAt: new Date() },
    });
  }

  /** What each line of the order holds in the warehouse, by line. */
  async reservedByLine(db: DbClient, orderId: string): Promise<Map<string, Prisma.Decimal>> {
    const rows = await db.$queryRaw<{ lineId: string; quantity: Prisma.Decimal }[]>`
      SELECT r.origin_line_id AS "lineId", r.quantity
      FROM warehouse_reservation_refs r
      WHERE r.origin_type = ${ORIGIN_TYPE} AND r.origin_id = ${orderId}::uuid`;
    return new Map(rows.map((row) => [row.lineId, row.quantity]));
  }

  /** Free stock of these items in the warehouse, by item (absent: nothing there). */
  async availableIn(
    db: DbClient,
    warehouseId: string,
    itemIds: readonly string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    if (itemIds.length === 0) return new Map();
    const rows = await db.$queryRaw<{ itemId: string; available: Prisma.Decimal }[]>`
      SELECT s.item_id AS "itemId", s.available_quantity AS available
      FROM warehouse_stock_refs s
      WHERE s.warehouse_id = ${warehouseId}::uuid AND s.item_id = ANY(${[...itemIds]}::uuid[])`;
    return new Map(rows.map((row) => [row.itemId, row.available]));
  }

  /** The code and name of the order's warehouse, from the warehouse's published view. */
  async warehouseRef(db: DbClient, companyId: string, id: string) {
    const [row] = await db.$queryRaw<
      { id: string; code: string; name: string; archived: boolean }[]
    >`
      SELECT w.id, w.code, w.name, w.archived_at IS NOT NULL AS archived
      FROM warehouse_refs w
      WHERE w.id = ${id}::uuid AND w.company_id = ${companyId}::uuid`;
    return row ?? null;
  }

  async list(
    db: DbClient,
    filter: OrderFilter,
    sort: { field: OrderSort; direction: 'asc' | 'desc' },
    page: { skip: number; take: number },
  ): Promise<{ rows: OrderListRow[]; total: number }> {
    const rows = this.listSql(filter);
    const direction = sort.direction === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const where = Prisma.sql`
      WHERE (NOT ${filter.uncovered}::boolean OR r.uncovered)
        AND (NOT ${filter.late}::boolean OR r.late)`;
    const items = await db.$queryRaw<OrderListRow[]>`
      WITH r AS (${rows})
      SELECT * FROM r ${where}
      ORDER BY ${SORTS[sort.field](direction)}, r.id ASC
      LIMIT ${page.take} OFFSET ${page.skip}`;
    const [count] = await db.$queryRaw<{ total: bigint }[]>`
      WITH r AS (${rows}) SELECT count(*) AS total FROM r ${where}`;
    return { rows: items, total: Number(count!.total) };
  }

  private listSql(filter: OrderFilter): Prisma.Sql {
    const optional = (value: unknown, sql: Prisma.Sql) => (value ? sql : Prisma.empty);
    const status =
      filter.status === 'OPEN'
        ? Prisma.sql`AND o.status IN ${OPEN}`
        : optional(filter.status, Prisma.sql`AND o.status = ${filter.status}::order_status`);
    const text = filter.reference
      ? Prisma.sql`AND o.series = ${filter.reference.series} AND o.year = ${filter.reference.year}
                   AND o.number = ${filter.reference.number}`
      : optional(
          filter.q,
          Prisma.sql`AND (o.party_reference ILIKE ${contains(filter.q ?? '')}
                          OR p.name ILIKE ${contains(filter.q ?? '')})`,
        );
    return Prisma.sql`
      SELECT o.id, o.kind, o.status, o.series, o.year, o.number, o.order_date AS "orderDate",
             o.party_id AS "partyId", p.name AS "partyName", o.warehouse_id AS "warehouseId",
             w.code AS "warehouseCode", o.party_reference AS "partyReference",
             o.requested_date AS "requestedDate", o.taxable_total AS "taxableTotal", o.total,
             o.version, o.created_at AS "createdAt",
             (SELECT count(*) FROM order_lines l WHERE l.order_id = o.id) AS "lineCount",
             (o.status IN ${OPEN} AND o.requested_date < ${filter.today}::date) AS late,
             (o.kind = 'SALES' AND o.status IN ${OPEN} AND EXISTS (
                SELECT 1 FROM order_lines l
                LEFT JOIN warehouse_reservation_refs res
                  ON res.origin_type = ${ORIGIN_TYPE} AND res.origin_line_id = l.id
                WHERE l.order_id = o.id AND ${REMAINING} > coalesce(res.quantity, 0))) AS uncovered
      FROM orders o
      JOIN registry_party_refs p ON p.id = o.party_id
      LEFT JOIN warehouse_refs w ON w.id = o.warehouse_id
      WHERE o.company_id = ${filter.companyId}::uuid AND o.kind = ${filter.kind}::order_kind
        ${status}
        ${optional(filter.partyId, Prisma.sql`AND o.party_id = ${filter.partyId}::uuid`)}
        ${optional(filter.warehouseId, Prisma.sql`AND o.warehouse_id = ${filter.warehouseId}::uuid`)}
        ${optional(filter.from, Prisma.sql`AND o.order_date >= ${filter.from}::date`)}
        ${optional(filter.to, Prisma.sql`AND o.order_date <= ${filter.to}::date`)}
        ${text}`;
  }

  /** Items that can go on an order line: active, kept in stock, with free stock if asked. */
  searchItems(db: DbClient, q: string | undefined, warehouseId: string | undefined) {
    return db.$queryRaw<
      {
        id: string;
        code: string;
        description: string;
        unit: string;
        salePrice: Prisma.Decimal | null;
        vatCode: string;
        available: Prisma.Decimal | null;
      }[]
    >`
      SELECT i.id, i.code, i.description, i.unit, i.sale_price AS "salePrice",
             i.vat_code AS "vatCode",
             CASE WHEN ${warehouseId ?? null}::uuid IS NULL THEN NULL
                  ELSE coalesce(s.available_quantity, 0) END AS available
      FROM registry_item_refs i
      LEFT JOIN warehouse_stock_refs s
        ON s.item_id = i.id AND s.warehouse_id = ${warehouseId ?? null}::uuid
      WHERE i.stock_managed AND i.archived_at IS NULL
        AND (${q ?? null}::text IS NULL OR i.code ILIKE ${contains(q ?? '')}
             OR i.description ILIKE ${contains(q ?? '')})
      ORDER BY i.code
      LIMIT 20`;
  }

  /** Active suppliers or customers, for the party of an order. */
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

  /** Open purchase orders still bringing this item, with what each still brings. */
  incoming(db: DbClient, companyId: string, itemId: string) {
    return db.$queryRaw<
      {
        orderId: string;
        series: string;
        year: number;
        number: number;
        warehouseId: string;
        warehouseCode: string;
        requestedDate: Date | null;
        remaining: Prisma.Decimal;
      }[]
    >`
      SELECT o.id AS "orderId", o.series, o.year, o.number, o.warehouse_id AS "warehouseId",
             w.code AS "warehouseCode", o.requested_date AS "requestedDate",
             sum(${REMAINING}) AS remaining
      FROM order_lines l
      JOIN orders o ON o.id = l.order_id
      JOIN warehouse_refs w ON w.id = o.warehouse_id
      WHERE o.company_id = ${companyId}::uuid AND o.kind = 'PURCHASE' AND o.status IN ${OPEN}
        AND l.item_id = ${itemId}::uuid AND ${REMAINING} > 0
      GROUP BY o.id, w.code
      ORDER BY o.requested_date NULLS LAST, o.year, o.number`;
  }

  /** What open purchase orders still bring into a warehouse, by item. */
  async incomingByItem(
    db: DbClient,
    companyId: string,
    warehouseId: string,
  ): Promise<Map<string, Prisma.Decimal>> {
    const rows = await db.$queryRaw<{ itemId: string; remaining: Prisma.Decimal }[]>`
      SELECT l.item_id AS "itemId", sum(${REMAINING}) AS remaining
      FROM order_lines l
      JOIN orders o ON o.id = l.order_id
      WHERE o.company_id = ${companyId}::uuid AND o.warehouse_id = ${warehouseId}::uuid
        AND o.kind = 'PURCHASE' AND o.status IN ${OPEN}
      GROUP BY l.item_id`;
    return new Map(rows.map((row) => [row.itemId, row.remaining]));
  }

  /** Items of the registry as order lines and proposals need them. */
  itemRefs(db: DbClient, ids: readonly string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return db.$queryRaw<
      { id: string; code: string; description: string; unit: string; vatCode: string }[]
    >`
      SELECT i.id, i.code, i.description, i.unit, i.vat_code AS "vatCode"
      FROM registry_item_refs i WHERE i.id = ANY(${[...ids]}::uuid[])`;
  }

  async counts(db: DbClient, companyId: string, today: string) {
    const [row] = await db.$queryRaw<Record<string, bigint>[]>`
      WITH r AS (
        SELECT o.kind, o.requested_date < ${today}::date AS late,
               (o.kind = 'SALES' AND EXISTS (
                  SELECT 1 FROM order_lines l
                  LEFT JOIN warehouse_reservation_refs res
                    ON res.origin_type = ${ORIGIN_TYPE} AND res.origin_line_id = l.id
                  WHERE l.order_id = o.id AND ${REMAINING} > coalesce(res.quantity, 0))) AS uncovered
        FROM orders o
        WHERE o.company_id = ${companyId}::uuid AND o.status IN ${OPEN})
      SELECT count(*) FILTER (WHERE kind = 'SALES') AS "salesOpen",
             count(*) FILTER (WHERE kind = 'SALES' AND uncovered) AS "salesUncovered",
             count(*) FILTER (WHERE kind = 'SALES' AND late) AS "salesLate",
             count(*) FILTER (WHERE kind = 'PURCHASE') AS "purchaseOpen",
             count(*) FILTER (WHERE kind = 'PURCHASE' AND late) AS "purchaseLate"
      FROM r`;
    return Object.fromEntries(Object.entries(row!).map(([key, value]) => [key, Number(value)]));
  }
}
