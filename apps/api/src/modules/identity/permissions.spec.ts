import { MembershipRole } from '../../generated/prisma/client.js';
import {
  ASSIGNABLE_PERMISSIONS,
  missingRequirements,
  PERMISSION_MODULE,
  PERMISSION_REQUIRES,
  PERMISSIONS,
  type Permission,
  permissionsFor,
  RESERVED_PERMISSIONS,
} from './permissions.js';

// The matrix, row by row: a change here must be a deliberate decision (docs/adr/0014, 0018
// for the registry, 0021 for the warehouse, 0024 for orders, 0030 for invoicing), not a side effect.
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
    'payments:write',
  ],
  READ_ONLY: ['parties:read', 'items:read', 'stock:read', 'orders:read', 'invoicing:read'],
};

describe('role permissions', () => {
  it.each(Object.values(MembershipRole))('%s has exactly the expected permissions', (role) => {
    expect([...permissionsFor(role)].sort()).toEqual([...EXPECTED[role]].sort());
  });

  it('keeps people, roles and audit for administrators only', () => {
    for (const role of Object.values(MembershipRole).filter((r) => r !== 'ADMIN')) {
      expect(permissionsFor(role)).not.toContain('members:read');
      expect(permissionsFor(role)).not.toContain('members:manage');
      expect(permissionsFor(role)).not.toContain('roles:manage');
      expect(permissionsFor(role)).not.toContain('audit:read');
    }
  });

  it.each(Object.values(MembershipRole))('%s holds everything its permissions need', (role) => {
    expect(missingRequirements(permissionsFor(role))).toEqual([]);
  });

  it('never lets a read-only person write', () => {
    expect(permissionsFor('READ_ONLY').every((p) => p.endsWith(':read'))).toBe(true);
  });

  it('lets only administrators set up warehouses and the company data', () => {
    for (const role of Object.values(MembershipRole)) {
      expect(permissionsFor(role).includes('warehouses:manage')).toBe(role === 'ADMIN');
      expect(permissionsFor(role).includes('companies:manage')).toBe(role === 'ADMIN');
    }
  });
});

describe('permission catalog', () => {
  it('reserves managing people and roles to the built-in administrator', () => {
    expect(RESERVED_PERMISSIONS).toEqual(['members:manage', 'roles:manage']);
    expect(ASSIGNABLE_PERMISSIONS).toEqual(
      PERMISSIONS.filter((p) => !RESERVED_PERMISSIONS.includes(p)),
    );
  });

  it('knows the requirements and the module of every permission', () => {
    expect(Object.keys(PERMISSION_REQUIRES).sort()).toEqual([...PERMISSIONS].sort());
    expect(Object.keys(PERMISSION_MODULE).sort()).toEqual([...PERMISSIONS].sort());
  });

  it('never requires a reserved permission from an assignable one', () => {
    for (const permission of ASSIGNABLE_PERMISSIONS) {
      expect(
        missingRequirements([permission]).filter((p) => RESERVED_PERMISSIONS.includes(p)),
      ).toEqual([]);
    }
  });

  it('follows the whole chain of requirements', () => {
    expect(missingRequirements(['invoicing:issue'])).toEqual(['invoicing:read', 'invoicing:write']);
    expect(missingRequirements(['invoicing:issue', 'invoicing:write', 'invoicing:read'])).toEqual(
      [],
    );
    expect(missingRequirements([])).toEqual([]);
  });
});
