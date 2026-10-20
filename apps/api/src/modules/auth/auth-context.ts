import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { MembershipRole } from '../../generated/prisma/client.js';
import type { Permission } from '../identity/index.js';

/** Who is making the request, as established from a verified access token. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  /** Empty until the person chooses a tenant. */
  tenantId?: string;
  role?: MembershipRole;
  permissions: readonly Permission[];
  /** Companies the person can reach in the tenant. */
  accessibleCompanyIds: readonly string[];
  /** The company named by the X-Company-Id header, only when the person can reach it. */
  companyId?: string;
  /** What the X-Company-Id header said: absent, a reachable company, or anything else. */
  companyHeader: 'none' | 'valid' | 'invalid';
}

const storage = new AsyncLocalStorage<AuthContext>();

/** Holds the identity of the current request. Set by the authentication middleware. */
@Injectable()
export class AuthContextService {
  run<T>(context: AuthContext, fn: () => T): T {
    return storage.run(context, fn);
  }

  current(): AuthContext | undefined {
    return storage.getStore();
  }

  /** For code that only runs behind the authentication guard: a missing context is a bug. */
  require(): AuthContext {
    const context = storage.getStore();
    if (!context) throw new Error('No authenticated request: is the route marked @Public()?');
    return context;
  }
}
