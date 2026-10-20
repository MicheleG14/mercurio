import { HttpStatus } from '@nestjs/common';
import { DomainException } from './errors/index.js';

/** A required display name: trimmed, inner spaces collapsed, 1-200 characters. */
export function normalizeName(value: string, code = 'INVALID_NAME'): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > 200) {
    throw new DomainException(code, HttpStatus.BAD_REQUEST, { detail: '1-200 characters' });
  }
  return name;
}
