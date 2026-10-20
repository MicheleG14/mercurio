import { canAccessCompany } from './company-access.js';

describe('canAccessCompany', () => {
  it('lets an active membership with every company reach any of them', () => {
    expect(canAccessCompany({ status: 'ACTIVE', allCompanies: true, companyIds: [] }, 'c1')).toBe(
      true,
    );
  });

  it('limits a membership to the companies listed', () => {
    const access = { status: 'ACTIVE' as const, allCompanies: false, companyIds: ['c1'] };

    expect(canAccessCompany(access, 'c1')).toBe(true);
    expect(canAccessCompany(access, 'c2')).toBe(false);
  });

  it('gives a removed membership no access at all', () => {
    expect(
      canAccessCompany({ status: 'REMOVED', allCompanies: true, companyIds: ['c1'] }, 'c1'),
    ).toBe(false);
  });
});
