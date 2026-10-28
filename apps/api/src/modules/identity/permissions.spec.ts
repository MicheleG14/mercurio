import { MembershipRole } from '../../generated/prisma/client.js';
import { PERMISSIONS, type Permission, permissionsFor } from './permissions.js';

// The matrix, row by row: a change here must be a deliberate decision (docs/adr/0014, 0018
// for the registry, 0021 for the warehouse, 0024 for orders), not a side effect.
const EXPECTED: Record<MembershipRole, Permission[]> = {
  ADMIN: [...PERMISSIONS],
  WAREHOUSE_KEEPER: [
    'parties:read',
    'items:read',
    'items:write',
    'stock:read',
    'stock:write',
    'orders:read',
    'orders:write',
    'orders:fulfil',
  ],
  ACCOUNTANT: [
    'parties:read',
    'parties:write',
    'items:read',
    'stock:read',
    'orders:read',
    'orders:write',
    'invoicing:read',
    'invoicing:write',
    'invoicing:issue',
  ],
  READ_ONLY: ['parties:read', 'items:read', 'stock:read', 'orders:read', 'invoicing:read'],
};

describe('role permissions', () => {
  it.each(Object.values(MembershipRole))('%s has exactly the expected permissions', (role) => {
    expect([...permissionsFor(role)].sort()).toEqual([...EXPECTED[role]].sort());
  });

  it('keeps users and audit for administrators only', () => {
    for (const role of Object.values(MembershipRole).filter((r) => r !== 'ADMIN')) {
      expect(permissionsFor(role)).not.toContain('users:read');
      expect(permissionsFor(role)).not.toContain('audit:read');
    }
  });

  it('never lets a read-only person write', () => {
    expect(permissionsFor('READ_ONLY').every((p) => p.endsWith(':read'))).toBe(true);
  });

  it('lets only administrators set up warehouses', () => {
    for (const role of Object.values(MembershipRole)) {
      expect(permissionsFor(role).includes('warehouses:manage')).toBe(role === 'ADMIN');
    }
  });
});
