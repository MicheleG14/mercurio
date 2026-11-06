import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DomainException } from '../../shared/errors/index.js';
import { PERMISSIONS } from './permissions.js';
import {
  membershipPermissions,
  normalizeCustomRole,
  RESERVED_ROLE_NAMES,
  roleRefOf,
} from './roles.js';

function errorsOf(fn: () => unknown): { field: string; code: string }[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainException) {
      return error.errors ?? [];
    }
    throw error;
  }
  return [];
}

describe('custom roles', () => {
  it('normalizes name, description and permissions', () => {
    expect(
      normalizeCustomRole({
        name: '  Commerciale   Nord ',
        description: ' ',
        permissions: ['parties:write', 'parties:read', 'parties:read'],
      }),
    ).toEqual({
      name: 'Commerciale Nord',
      description: null,
      permissions: ['parties:read', 'parties:write'],
    });
  });

  it('reports every broken rule at once', () => {
    expect(errorsOf(() => normalizeCustomRole({ name: ' ', permissions: [] }))).toEqual([
      { field: 'name', code: 'REQUIRED' },
      { field: 'permissions', code: 'REQUIRED' },
    ]);
  });

  it.each(['Contabile', 'ACCOUNTANT', 'read only', 'Amministratore'])(
    'refuses the name of a built-in role: %s',
    (name) => {
      expect(errorsOf(() => normalizeCustomRole({ name, permissions: ['parties:read'] }))).toEqual([
        { field: 'name', code: 'ROLE_NAME_RESERVED' },
      ]);
    },
  );

  it.each([
    [['parties:read', 'users:read'], 'PERMISSION_UNKNOWN'],
    [['members:read', 'members:manage'], 'PERMISSION_RESERVED'],
    [['members:read', 'roles:manage'], 'PERMISSION_RESERVED'],
    [['invoicing:issue', 'invoicing:read'], 'ROLE_PERMISSIONS_INCOMPLETE'],
  ])('refuses %j with %s', (permissions, code) => {
    expect(errorsOf(() => normalizeCustomRole({ name: 'Test', permissions }))).toEqual([
      { field: 'permissions', code },
    ]);
  });

  it('has a label for every permission in the interface, in every language', () => {
    const locales = join(import.meta.dirname, '../../../../web/src/locales');
    for (const language of readdirSync(locales)) {
      const members = JSON.parse(readFileSync(join(locales, language, 'members.json'), 'utf8')) as {
        roles: { permission: Record<string, Record<string, string>> };
      };
      for (const permission of PERMISSIONS) {
        const [area, action] = permission.split(':') as [string, string];
        expect(members.roles.permission[area]?.[action], `${language}: ${permission}`).toBeTruthy();
      }
    }
  });

  it('reserves the names the interface shows for built-in roles, in every language', () => {
    const locales = join(import.meta.dirname, '../../../../web/src/locales');
    for (const language of readdirSync(locales)) {
      const auth = JSON.parse(readFileSync(join(locales, language, 'auth.json'), 'utf8')) as {
        roles: Record<string, string>;
      };
      for (const label of Object.values(auth.roles)) {
        expect(RESERVED_ROLE_NAMES).toContain(label.toLowerCase());
      }
    }
  });
});

describe('permissions of a membership', () => {
  const custom = (permissions: string[], archivedAt: Date | null = null) => ({
    role: null,
    customRole: { id: 'r1', name: 'Commerciale', permissions, archivedAt },
  });

  it('come from the built-in role, or from the custom one', () => {
    expect(membershipPermissions({ role: 'READ_ONLY', customRole: null })).toContain(
      'invoicing:read',
    );
    expect(membershipPermissions(custom(['parties:read', 'parties:write']))).toEqual([
      'parties:read',
      'parties:write',
    ]);
  });

  it('are none for an archived custom role, and never reserved or unknown ones', () => {
    expect(membershipPermissions(custom(['parties:read'], new Date()))).toEqual([]);
    expect(membershipPermissions(custom(['members:manage', 'nope', 'audit:read']))).toEqual([
      'audit:read',
    ]);
  });

  it('describe the role as the interface needs it', () => {
    expect(roleRefOf({ role: 'ADMIN', customRole: null })).toEqual({
      kind: 'builtin',
      key: 'ADMIN',
    });
    expect(roleRefOf(custom([]))).toEqual({ kind: 'custom', id: 'r1', name: 'Commerciale' });
  });
});
