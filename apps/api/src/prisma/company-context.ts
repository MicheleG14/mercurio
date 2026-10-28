import type { TenantContext } from './tenant-context.js';

/** Who works, in which tenant and company: what every use case working on a company needs. */
export interface CompanyContext {
  tenantId: string;
  companyId: string;
  userId: string | null;
}

/**
 * The company of the request. Every route working on a company has @RequiresCompany(), so the header has
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
