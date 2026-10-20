import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../shared/errors/index.js';

/**
 * The modules a tenant can buy, and what each one needs (S7). Registry is the shared base and
 * always on. Invoicing works without orders (manual invoices) and, with orders, also listens to
 * OrderFulfilledEvent: events make that link optional, so it is not a dependency.
 */
export const MODULE_CATALOG = {
  registry: { requires: [], alwaysOn: true },
  warehouse: { requires: ['registry'], alwaysOn: false },
  orders: { requires: ['registry', 'warehouse'], alwaysOn: false },
  invoicing: { requires: ['registry'], alwaysOn: false },
} as const satisfies Record<string, { requires: readonly string[]; alwaysOn: boolean }>;

export type ModuleKey = keyof typeof MODULE_CATALOG;
export const MODULE_KEYS = Object.keys(MODULE_CATALOG) as ModuleKey[];

export function isModuleKey(value: string): value is ModuleKey {
  return Object.hasOwn(MODULE_CATALOG, value);
}

/** Validates keys typed by a person ("warehouse", or "all" for every module). */
export function parseModuleKeys(values: readonly string[]): ModuleKey[] {
  if (values.length === 1 && values[0] === 'all') return [...MODULE_KEYS];
  const unknown = values.filter((value) => !isModuleKey(value));
  if (unknown.length > 0) {
    throw new DomainException('UNKNOWN_MODULE', HttpStatus.BAD_REQUEST, {
      detail: `Unknown module(s): ${unknown.join(', ')}. Known: ${MODULE_KEYS.join(', ')}`,
    });
  }
  return [...new Set(values as ModuleKey[])];
}

/**
 * The set of enabled modules after a change, or an error if the result would break a
 * dependency. Nothing is enabled implicitly except the always-on base: enabling a module
 * without what it requires is refused, so a tenant never gets a module nobody chose.
 */
export function applyModuleChange(
  current: readonly ModuleKey[],
  change: { enable?: readonly ModuleKey[]; disable?: readonly ModuleKey[] },
): ModuleKey[] {
  const disable = new Set(change.disable ?? []);
  for (const key of disable) {
    if (MODULE_CATALOG[key].alwaysOn) {
      throw new DomainException('MODULE_ALWAYS_ON', HttpStatus.CONFLICT, {
        detail: `${key} cannot be disabled`,
      });
    }
  }

  const always = MODULE_KEYS.filter((key) => MODULE_CATALOG[key].alwaysOn);
  const result = new Set<ModuleKey>([...always, ...current, ...(change.enable ?? [])]);
  for (const key of disable) result.delete(key);

  for (const key of result) {
    const missing = MODULE_CATALOG[key].requires.filter((required) => !result.has(required));
    if (missing.length === 0) continue;
    // Disabling something another module needs, or enabling a module without its base.
    const code = missing.some((required) => disable.has(required))
      ? 'MODULE_REQUIRED_BY_OTHER'
      : 'MODULE_DEPENDENCY_MISSING';
    throw new DomainException(code, HttpStatus.CONFLICT, {
      detail: `${key} requires ${missing.join(', ')}`,
    });
  }
  return MODULE_KEYS.filter((key) => result.has(key));
}
