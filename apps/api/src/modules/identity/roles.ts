import { MembershipRole } from '../../generated/prisma/client.js';
import { FieldErrors, optionalLine } from '../../shared/errors/index.js';
import {
  isPermission,
  missingRequirements,
  type Permission,
  PERMISSIONS,
  permissionsFor,
  RESERVED_PERMISSIONS,
} from './permissions.js';

export const BUILTIN_ROLES = Object.values(MembershipRole);

/** The role of a membership: one of the built-in ones, or one the tenant defined. */
export type RoleRef =
  { kind: 'builtin'; key: MembershipRole } | { kind: 'custom'; id: string; name: string };

/** How a caller names the role to give: a built-in key or the id of a custom role. */
export type RoleChoice = { builtin: MembershipRole } | { customRoleId: string };

/**
 * Names a custom role cannot take: the built-in roles, by key and as the interface shows them in
 * every language. Two "Accountant" roles meaning different things in one tenant would mislead
 * whoever assigns them. The interface labels are checked against this list by a test that reads
 * the translation files.
 */
export const RESERVED_ROLE_NAMES: readonly string[] = [
  ...BUILTIN_ROLES.map((key) => key.toLowerCase().replace(/_/g, ' ')),
  // it
  'amministratore',
  'magazziniere',
  'contabile',
  'sola lettura',
  // en
  'administrator',
  'warehouse keeper',
  'accountant',
  'read only',
];

export function isBuiltinRole(value: string): value is MembershipRole {
  return (BUILTIN_ROLES as string[]).includes(value);
}

export interface CustomRoleInput {
  name: string;
  description?: string | null;
  permissions: readonly string[];
}

export interface CustomRoleData {
  name: string;
  description: string | null;
  permissions: Permission[];
}

/**
 * Checks a custom role and returns it normalized: name trimmed, permissions without duplicates and
 * in catalog order. Every broken rule is reported at once (B17).
 */
export function normalizeCustomRole(input: CustomRoleInput): CustomRoleData {
  const errors = new FieldErrors();
  const name = optionalLine(input.name) ?? '';
  if (!name) errors.add('name', 'REQUIRED');
  else if (name.length > 60) errors.add('name', 'TOO_LONG');
  else if (RESERVED_ROLE_NAMES.includes(name.toLowerCase())) {
    errors.add('name', 'ROLE_NAME_RESERVED');
  }
  const description = optionalLine(input.description);
  if (description && description.length > 200) errors.add('description', 'TOO_LONG');

  const given = new Set(input.permissions);
  const unknown = [...given].filter((p) => !isPermission(p));
  const permissions = PERMISSIONS.filter((p) => given.has(p));
  if (given.size === 0) errors.add('permissions', 'REQUIRED');
  else if (unknown.length > 0) errors.add('permissions', 'PERMISSION_UNKNOWN');
  else if (permissions.some((p) => RESERVED_PERMISSIONS.includes(p))) {
    errors.add('permissions', 'PERMISSION_RESERVED');
  } else if (missingRequirements(permissions).length > 0) {
    errors.add('permissions', 'ROLE_PERMISSIONS_INCOMPLETE');
  }
  errors.throwIfAny();
  return { name, description, permissions };
}

/**
 * The permissions a membership gives. A custom role that is archived or missing gives none: the
 * archive is refused while someone holds the role, so this only covers what should not happen.
 */
export function membershipPermissions(membership: {
  role: MembershipRole | null;
  customRole: { permissions: readonly string[]; archivedAt: Date | null } | null;
}): readonly Permission[] {
  if (membership.role) return permissionsFor(membership.role);
  const custom = membership.customRole;
  if (!custom || custom.archivedAt) return [];
  // Only known permissions, never reserved ones: the database checks it too.
  return PERMISSIONS.filter(
    (p) => custom.permissions.includes(p) && !RESERVED_PERMISSIONS.includes(p),
  );
}

export function roleRefOf(membership: {
  role: MembershipRole | null;
  customRole: { id: string; name: string } | null;
}): RoleRef {
  if (membership.role) return { kind: 'builtin', key: membership.role };
  return { kind: 'custom', id: membership.customRole!.id, name: membership.customRole!.name };
}
