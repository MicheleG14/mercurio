import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from './prisma.service.js';
import { type TenantContext, TenantContextService } from './tenant-context.js';
import { assertUuid } from './uuid.js';

/** The database client a use case receives: every query runs inside its transaction. */
export type TenantTransaction = Prisma.TransactionClient;

/**
 * Runs code on behalf of a tenant. Opens one transaction, sets `app.tenant_id` and
 * `app.user_id` for it (local to the transaction, so they never leak to another request
 * through the connection pool), and hands the transactional client to the code.
 *
 * Isolation does not depend on this class: Row-Level Security in the database enforces it,
 * and a query without context sees no tenant rows at all. This class only supplies the
 * context, and gives every use case one transaction (docs/conventions.md B12).
 */
@Injectable()
export class TenantDatabase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContextService,
  ) {}

  /** Uses the context of the current operation (TenantContextService). */
  async run<T>(work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return this.runAs(this.context.require(), work);
  }

  /** Uses an explicit context: terminal commands and tests. Async, so a bad context rejects. */
  async runAs<T>(context: TenantContext, work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    assertUuid(context.tenantId, 'tenantId');
    if (context.userId !== undefined) assertUuid(context.userId, 'userId');

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT set_config('app.tenant_id', ${context.tenantId}, true),
               set_config('app.user_id', ${context.userId ?? ''}, true)`;
      return work(tx);
    });
  }
}
