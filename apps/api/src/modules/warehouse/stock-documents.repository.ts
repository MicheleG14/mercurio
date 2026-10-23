import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { DbClient } from '../../prisma/index.js';
import type { StockKey } from './stock-rules.js';

type Link = { id: string; series: string; year: number; number: number };

/** A document with what its screens show of the rows around it. */
export type DocumentRow = Prisma.StockDocumentGetPayload<object> & {
  warehouse: { code: string };
  targetWarehouse: { code: string } | null;
  reverses: (Link & { reason: Prisma.StockDocumentGetPayload<object>['reason'] }) | null;
  reversedBy: Link | null;
  _count: { movements: number };
};

const LINK = { id: true, series: true, year: true, number: true } as const;

/**
 * The only code that touches documents, movements, balances and counters. The locking queries are
 * SQL written by hand: Prisma cannot express SELECT ... FOR UPDATE or ON CONFLICT ... RETURNING.
 * They join only this module's tables (docs/adr/0022; checked by a test).
 * Queries run one after the other: inside a transaction they share one connection, and Prisma's
 * `include` would send its queries for relations at the same time on it.
 */
@Injectable()
export class StockDocumentsRepository {
  async findById(db: DbClient, companyId: string, id: string): Promise<DocumentRow | null> {
    const document = await db.stockDocument.findFirst({ where: { id, companyId } });
    return document ? ((await this.withLinks(db, [document]))[0] ?? null) : null;
  }

  /** Any document with this id, in any company of the tenant: ids are unique in the table. */
  async findAnyById(db: DbClient, id: string): Promise<DocumentRow | null> {
    const document = await db.stockDocument.findUnique({ where: { id } });
    return document ? ((await this.withLinks(db, [document]))[0] ?? null) : null;
  }

  movementsOf(db: DbClient, documentId: string) {
    return db.stockMovement.findMany({
      where: { documentId },
      orderBy: [{ lineNo: 'asc' }, { quantity: 'asc' }],
    });
  }

  async list(
    db: DbClient,
    where: Prisma.StockDocumentWhereInput,
    orderBy: Prisma.StockDocumentOrderByWithRelationInput[],
    page: { skip: number; take: number },
  ) {
    const documents = await db.stockDocument.findMany({ where, orderBy, ...page });
    const total = await db.stockDocument.count({ where });
    return { items: await this.withLinks(db, documents), total };
  }

  /** Warehouse codes, reversal links and movement counts of a page of documents, in batches. */
  private async withLinks(
    db: DbClient,
    documents: Prisma.StockDocumentGetPayload<object>[],
  ): Promise<DocumentRow[]> {
    if (documents.length === 0) return [];
    const ids = documents.map((d) => d.id);
    const warehouseIds = [
      ...new Set(documents.flatMap((d) => [d.warehouseId, d.targetWarehouseId ?? d.warehouseId])),
    ];
    const reversedIds = documents.map((d) => d.reversesId).filter((r): r is string => r !== null);
    const warehouses = await db.warehouse.findMany({
      where: { id: { in: warehouseIds } },
      select: { id: true, code: true },
    });
    const reverses = await db.stockDocument.findMany({
      where: { id: { in: reversedIds } },
      select: { ...LINK, reason: true },
    });
    const reversals = await db.stockDocument.findMany({
      where: { reversesId: { in: ids } },
      select: { ...LINK, reversesId: true },
    });
    const counts = await db.stockMovement.groupBy({
      by: ['documentId'],
      where: { documentId: { in: ids } },
      _count: true,
    });
    const code = new Map(warehouses.map((w) => [w.id, { code: w.code }]));
    return documents.map((d) => {
      const reversal = reversals.find((r) => r.reversesId === d.id);
      return {
        ...d,
        warehouse: code.get(d.warehouseId)!,
        targetWarehouse: d.targetWarehouseId ? (code.get(d.targetWarehouseId) ?? null) : null,
        reverses: reverses.find((r) => r.id === d.reversesId) ?? null,
        reversedBy: reversal
          ? {
              id: reversal.id,
              series: reversal.series,
              year: reversal.year,
              number: reversal.number,
            }
          : null,
        _count: { movements: counts.find((c) => c.documentId === d.id)?._count ?? 0 },
      };
    });
  }

  /**
   * Locks the balances a document touches, creating the missing ones at zero, and returns their
   * stock. Both steps go in lock order (B34): rows are inserted from an ordered list and locked
   * through an ORDER BY, so two documents on the same items queue up instead of deadlocking.
   */
  async lockBalances(
    db: DbClient,
    owner: { tenantId: string; companyId: string },
    keys: readonly StockKey[],
  ): Promise<{ warehouseId: string; itemId: string; quantity: Prisma.Decimal }[]> {
    if (keys.length === 0) return [];
    const warehouseIds = keys.map((k) => k.warehouseId);
    const itemIds = keys.map((k) => k.itemId);
    await db.$executeRaw`
      INSERT INTO stock_balances (tenant_id, company_id, warehouse_id, item_id, quantity)
      SELECT ${owner.tenantId}::uuid, ${owner.companyId}::uuid, k.warehouse_id, k.item_id, 0
      FROM unnest(${warehouseIds}::uuid[], ${itemIds}::uuid[]) WITH ORDINALITY
        AS k(warehouse_id, item_id, position)
      ORDER BY k.position
      ON CONFLICT (warehouse_id, item_id) DO NOTHING`;
    return db.$queryRaw<{ warehouseId: string; itemId: string; quantity: Prisma.Decimal }[]>`
      SELECT b.warehouse_id AS "warehouseId", b.item_id AS "itemId", b.quantity
      FROM stock_balances b
      JOIN unnest(${warehouseIds}::uuid[], ${itemIds}::uuid[]) AS k(warehouse_id, item_id)
        ON b.warehouse_id = k.warehouse_id AND b.item_id = k.item_id
      ORDER BY b.warehouse_id, b.item_id
      FOR UPDATE OF b`;
  }

  /** Applies the net changes to balances already locked by lockBalances. */
  async applyChanges(
    db: DbClient,
    changes: readonly (StockKey & { change: Prisma.Decimal })[],
  ): Promise<void> {
    if (changes.length === 0) return;
    await db.$executeRaw`
      UPDATE stock_balances b SET quantity = b.quantity + c.change, updated_at = now()
      FROM unnest(
        ${changes.map((c) => c.warehouseId)}::uuid[],
        ${changes.map((c) => c.itemId)}::uuid[],
        ${changes.map((c) => c.change.toString())}::numeric[]
      ) AS c(warehouse_id, item_id, change)
      WHERE b.warehouse_id = c.warehouse_id AND b.item_id = c.item_id`;
  }

  /**
   * The next number of a series, taken in the document's transaction: the counter row stays
   * locked until commit, so concurrent documents get consecutive numbers, and a document that
   * fails gives its number back (no gaps, B32).
   */
  async nextNumber(
    db: DbClient,
    owner: { tenantId: string; companyId: string },
    series: string,
    year: number,
  ): Promise<number> {
    const [row] = await db.$queryRaw<{ lastNumber: number }[]>`
      INSERT INTO stock_document_counters (tenant_id, company_id, series, year, last_number)
      VALUES (${owner.tenantId}::uuid, ${owner.companyId}::uuid, ${series}, ${year}, 1)
      ON CONFLICT (company_id, series, year)
        DO UPDATE SET last_number = stock_document_counters.last_number + 1
      RETURNING last_number AS "lastNumber"`;
    return row!.lastNumber;
  }

  async create(
    db: DbClient,
    document: Prisma.StockDocumentUncheckedCreateInput,
    movements: Omit<Prisma.StockMovementCreateManyInput, 'documentId'>[],
  ) {
    const created = await db.stockDocument.create({ data: document, select: { id: true } });
    await db.stockMovement.createMany({
      data: movements.map((movement) => ({ ...movement, documentId: created.id })),
    });
    return created;
  }

  countToday(db: DbClient, companyId: string, today: Date) {
    return db.stockDocument.count({ where: { companyId, documentDate: today } });
  }
}
