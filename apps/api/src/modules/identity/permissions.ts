import { SetMetadata } from '@nestjs/common';
import type { MembershipRole } from '../../generated/prisma/client.js';

/**
 * What a person may do, as `area:action`. Roles are bundles of permissions; the code checks
 * permissions, never roles, so a role can change without touching the routes
 * (docs/adr/0014). The matrix is provisional for the areas not built yet: the phase that builds
 * an area refines its actions, as phase 2 did for the registry (parties and items apart).
 */
export const PERMISSIONS = [
  'parties:read',
  'parties:write',
  'items:read',
  'items:write',
  'warehouse:read',
  'warehouse:write',
  'orders:read',
  'orders:write',
  'invoicing:read',
  'invoicing:write',
  'invoicing:issue',
  'users:read',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ: readonly Permission[] = [
  'parties:read',
  'items:read',
  'warehouse:read',
  'orders:read',
  'invoicing:read',
];

export const ROLE_PERMISSIONS: Record<MembershipRole, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  // The warehouse keeper maintains the item catalog, the accountant customers and suppliers.
  WAREHOUSE_KEEPER: [
    'parties:read',
    'items:read',
    'items:write',
    'warehouse:read',
    'warehouse:write',
    'orders:read',
    'orders:write',
  ],
  ACCOUNTANT: [...READ, 'parties:write', 'invoicing:write', 'invoicing:issue'],
  READ_ONLY: READ,
};

export function permissionsFor(role: MembershipRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export const REQUIRED_PERMISSION = 'mercurio:requiredPermission';

/**
 * Marks a route (or a whole controller) as needing a permission, or any one of several. Enforced
 * by the guard of the `auth` module; a route without it only needs a signed-in person.
 *
 * @example
 * @RequiresPermission('audit:read')
 * @Get()
 */
export const RequiresPermission = (...anyOf: [Permission, ...Permission[]]) =>
  SetMetadata(REQUIRED_PERMISSION, anyOf);
