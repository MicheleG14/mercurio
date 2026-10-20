/** What decides which companies a membership can reach. */
export interface CompanyAccess {
  status: 'ACTIVE' | 'REMOVED';
  allCompanies: boolean;
  /** Companies listed for the membership; ignored when allCompanies is true. */
  companyIds: readonly string[];
}

/**
 * Whether a membership can work on a company: only while active, and only on every company
 * (allCompanies) or on those listed. Phase 1b uses it to check the X-Company-Id header (S5).
 * The caller must already know the company belongs to the membership's tenant.
 */
export function canAccessCompany(access: CompanyAccess, companyId: string): boolean {
  if (access.status !== 'ACTIVE') return false;
  return access.allCompanies || access.companyIds.includes(companyId);
}
