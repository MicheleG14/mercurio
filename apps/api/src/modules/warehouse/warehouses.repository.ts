import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { DbClient } from '../../prisma/index.js';

/** The only code that touches the warehouses table. Row-Level Security limits it to the tenant. */
@Injectable()
export class WarehousesRepository {
  async list(
    db: DbClient,
    where: Prisma.WarehouseWhereInput,
    page: { skip: number; take: number },
  ) {
    const items = await db.warehouse.findMany({
      where,
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      ...page,
    });
    return { items, total: await db.warehouse.count({ where }) };
  }

  findInCompany(db: DbClient, companyId: string, id: string) {
    return db.warehouse.findFirst({ where: { id, companyId } });
  }

  findByCode(db: DbClient, companyId: string, code: string) {
    return db.warehouse.findFirst({ where: { companyId, code: code.trim().toUpperCase() } });
  }

  /**
   * The warehouses of a document, locked against archiving until the document is recorded: an
   * archive waits for the document, then sees its stock and refuses (FOR SHARE: documents do not
   * wait for each other). In id order, like every lock (B34).
   */
  lockForDocument(db: DbClient, companyId: string, ids: readonly string[]) {
    const sorted = [...new Set(ids)].sort();
    return db.$queryRaw<{ id: string; code: string; archived: boolean }[]>`
      SELECT id, code, archived_at IS NOT NULL AS archived FROM warehouses
      WHERE company_id = ${companyId}::uuid AND id IN (${Prisma.join(sorted.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id
      FOR SHARE`;
  }

  /** True while any item has stock in the warehouse. */
  async hasStock(db: DbClient, warehouseId: string): Promise<boolean> {
    return (await db.stockBalance.count({ where: { warehouseId, quantity: { not: 0 } } })) > 0;
  }

  create(db: DbClient, data: Prisma.WarehouseUncheckedCreateInput) {
    return db.warehouse.create({ data });
  }

  /** null when someone else saved first (B29). */
  async updateAtVersion(
    db: DbClient,
    id: string,
    version: number,
    data: Prisma.WarehouseUpdateInput,
  ) {
    const [updated] = await db.warehouse.updateManyAndReturn({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });
    return updated ?? null;
  }
}
