import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { DbClient } from '../../prisma/index.js';
import type { PartyData } from './party-rules.js';

/** The only code that touches the parties table. Row-Level Security limits it to the tenant. */
@Injectable()
export class PartiesRepository {
  async list(
    db: DbClient,
    where: Prisma.PartyWhereInput,
    orderBy: Prisma.PartyOrderByWithRelationInput[],
    page: { skip: number; take: number },
  ) {
    const [items, total] = await Promise.all([
      db.party.findMany({ where, orderBy, ...page }),
      db.party.count({ where }),
    ]);
    return { items, total };
  }

  findById(db: DbClient, id: string) {
    return db.party.findUnique({ where: { id } });
  }

  /** The active party with this VAT number, other than `exceptId`. */
  findActiveByVat(db: DbClient, vatNumber: string, exceptId?: string) {
    return db.party.findFirst({
      where: { vatNumber, archivedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
  }

  /** Parties, archived ones too, with one of these VAT numbers or this tax code. */
  findByIdentifiers(db: DbClient, match: { vatNumbers?: string[]; taxCode?: string }) {
    return db.party.findMany({
      where: {
        OR: [
          ...(match.vatNumbers?.length ? [{ vatNumber: { in: match.vatNumbers } }] : []),
          ...(match.taxCode ? [{ taxCode: match.taxCode }] : []),
        ],
      },
      orderBy: [{ archivedAt: { sort: 'desc', nulls: 'first' } }, { name: 'asc' }],
      take: 10,
    });
  }

  create(db: DbClient, tenantId: string, data: PartyData) {
    return db.party.create({ data: { tenantId, ...data } });
  }

  /**
   * Changes the party only if it still has `version`, and moves it to the next version. Null when
   * nothing matched: someone else saved first (B29).
   */
  async updateAtVersion(
    db: DbClient,
    id: string,
    version: number,
    data: Partial<PartyData> & { archivedAt?: Date | null },
  ) {
    const [updated] = await db.party.updateManyAndReturn({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });
    return updated ?? null;
  }
}
