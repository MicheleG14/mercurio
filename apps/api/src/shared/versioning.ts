import { HttpStatus } from '@nestjs/common';
import { DomainException } from './errors/index.js';

/**
 * Optimistic concurrency (docs/conventions.md B29): every change carries the version it was based
 * on. A different version means someone else saved in between, and their work must not be
 * overwritten in silence.
 */
export const editConflict = () => new DomainException('EDIT_CONFLICT', HttpStatus.CONFLICT);

export function assertVersion(current: { version: number }, sent: number): void {
  if (current.version !== sent) throw editConflict();
}

/** The fields actually sent: absent ones (undefined) leave the stored value as it is. */
export function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Partial<T>;
}

/** Names of the fields whose value differs, for the audit log (names only, never values). */
export function changedFields<T extends object>(before: T, after: T): string[] {
  return (Object.keys(after) as (keyof T & string)[]).filter(
    (key) => !Object.is(before[key], after[key]),
  );
}
