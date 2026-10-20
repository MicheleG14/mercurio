import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import type { TenantTransaction } from './tenant-database.js';
import { assertUuid } from './uuid.js';

/**
 * Runs code on behalf of a person who has not chosen a tenant (yet): signing in, activating an
 * account, picking the tenant. It sets only `app.user_id`, so the person's own rows are visible
 * (credentials, sessions, their memberships) and no tenant table is: without `app.tenant_id`
 * Row-Level Security shows none of them.
 */
@Injectable()
export class UserDatabase {
  constructor(private readonly prisma: PrismaService) {}

  async runAs<T>(userId: string, work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    assertUuid(userId, 'userId');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT set_config('app.tenant_id', '', true), set_config('app.user_id', ${userId}, true)`;
      return work(tx);
    });
  }
}
