import type { TenantContext } from '../../prisma/index.js';

/** Who works, in which tenant and company: what every warehouse use case needs. */
export interface CompanyContext {
  tenantId: string;
  companyId: string;
  userId: string | null;
}

/**
 * The company of the request. Every warehouse route has @RequiresCompany(), so the header has
 * been verified before any service runs; a missing company here is a programming error.
 */
export function companyOf(context: TenantContext): CompanyContext {
  if (!context.companyId)
    throw new Error('No company in context: the route needs @RequiresCompany()');
  return {
    tenantId: context.tenantId,
    companyId: context.companyId,
    userId: context.userId ?? null,
  };
}
