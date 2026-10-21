import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { DbClient } from '../../prisma/index.js';

/** The only code that touches the items table. Row-Level Security limits it to the tenant. */
@Injectable()
export class ItemsRepository {
  async list(
    db: DbClient,
    where: Prisma.ItemWhereInput,
    orderBy: Prisma.ItemOrderByWithRelationInput[],
    page: { skip: number; take: number },
  ) {
    const [items, total] = await Promise.all([
      db.item.findMany({ where, orderBy, ...page }),
      db.item.count({ where }),
    ]);
    return { items, total };
  }

  findById(db: DbClient, id: string) {
    return db.item.findUnique({ where: { id } });
  }

  /** Whether the tenant has an item with this code, in any case (the unique index's rule). */
  async codeExists(db: DbClient, tenantId: string, code: string): Promise<boolean> {
    const rows = await db.$queryRaw<unknown[]>`
      SELECT 1 FROM items WHERE tenant_id = ${tenantId}::uuid AND lower(code) = lower(${code})`;
    return rows.length > 0;
  }

  create(db: DbClient, data: Prisma.ItemUncheckedCreateInput) {
    return db.item.create({ data });
  }

  /** As PartiesRepository.updateAtVersion: null when someone else saved first (B29). */
  async updateAtVersion(db: DbClient, id: string, version: number, data: Prisma.ItemUpdateInput) {
    const [updated] = await db.item.updateManyAndReturn({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });
    return updated ?? null;
  }
}
