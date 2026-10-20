import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

/** On whose behalf the code is running: the tenant, and the user when there is one. */
export interface TenantContext {
  tenantId: string;
  userId?: string;
  /** The company the person is working on (header X-Company-Id, already verified). */
  companyId?: string;
}

// One store for the whole process: every async call started inside run() sees the same context,
// and code outside it sees none.
const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Holds the tenant context of the current operation. Terminal commands and tests set it
 * explicitly; from phase 1b an interceptor sets it from the verified session, never from
 * values sent by the client (S5).
 */
@Injectable()
export class TenantContextService {
  run<T>(context: TenantContext, fn: () => T): T {
    return storage.run(context, fn);
  }

  current(): TenantContext | undefined {
    return storage.getStore();
  }

  /** The current context; a missing one is a programming error, not a user error. */
  require(): TenantContext {
    const context = storage.getStore();
    if (!context)
      throw new Error('No tenant context: run this code inside TenantContextService.run()');
    return context;
  }
}
