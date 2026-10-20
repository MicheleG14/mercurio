import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { DbClient } from '../../prisma/index.js';

/**
 * The only code that touches the audit tables. Rows are only ever added: the database refuses
 * updates and deletes (docs/adr/0015).
 */
@Injectable()
export class AuditRepository {
  // createMany, not create: an INSERT ... RETURNING needs the new row to be readable too, and an
  // event about an unknown person (no user_id) is writable but not readable by anyone.
  async addAuthEvent(db: DbClient, data: Prisma.AuthEventUncheckedCreateInput) {
    await db.authEvent.createMany({ data: [data] });
  }

  async addTenantEvent(db: DbClient, data: Prisma.AuditEventUncheckedCreateInput) {
    await db.auditEvent.createMany({ data: [data] });
  }

  async listTenantEvents(
    db: DbClient,
    where: Prisma.AuditEventWhereInput,
    page: { skip: number; take: number },
    direction: 'asc' | 'desc',
  ) {
    const [items, total] = await Promise.all([
      db.auditEvent.findMany({
        where,
        orderBy: [{ at: direction }, { id: direction }],
        ...page,
        include: { actor: { select: { name: true, email: true } } },
      }),
      db.auditEvent.count({ where }),
    ]);
    return { items, total };
  }

  async listAuthEvents(db: DbClient, userId: string, page: { skip: number; take: number }) {
    const where = { userId };
    const [items, total] = await Promise.all([
      db.authEvent.findMany({ where, orderBy: [{ at: 'desc' }, { id: 'desc' }], ...page }),
      db.authEvent.count({ where }),
    ]);
    return { items, total };
  }
}
