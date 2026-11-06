import type { PermissionInfo } from './queries';

export type PermissionKey = PermissionInfo['key'];

/**
 * The role editor keeps a role consistent as the person ticks: a permission brings what it
 * requires, and taking one away takes what depends on it. The server checks the same rule
 * (ROLE_PERMISSIONS_INCOMPLETE); doing it here means the person never meets that error.
 */
export function togglePermission(
  catalog: readonly PermissionInfo[],
  selected: readonly string[],
  key: string,
  on: boolean,
): PermissionKey[] {
  const requires = new Map<string, readonly string[]>(catalog.map((p) => [p.key, p.requires]));
  const result = new Set<string>(selected);
  if (on) {
    const add = (k: string) => {
      if (result.has(k)) return;
      result.add(k);
      for (const r of requires.get(k) ?? []) add(r);
    };
    add(key);
  } else {
    const remove = (k: string) => {
      result.delete(k);
      for (const [other, needs] of requires)
        if (needs.includes(k) && result.has(other)) remove(other);
    };
    remove(key);
  }
  // Catalog order, so the same role always reads the same way.
  return catalog.map((p) => p.key).filter((k) => result.has(k));
}

/** The permissions a ticked one brought along, to explain why they appeared. */
export function requiredBy(
  catalog: readonly PermissionInfo[],
  selected: readonly string[],
  key: string,
) {
  return catalog
    .filter((p) => selected.includes(p.key) && p.requires.includes(key))
    .map((p) => p.key);
}

/** Module groups in the order work flows, administration last. */
export const PERMISSION_GROUPS = [
  'registry',
  'warehouse',
  'orders',
  'invoicing',
  'administration',
] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export const groupOf = (p: PermissionInfo): PermissionGroup =>
  (p.module ?? 'administration') as PermissionGroup;
