import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../shared/errors/index.js';

/** Lowercase letters, digits and single dashes, e.g. `rossi` or `bianchi-snc` (max 50). */
export function normalizeSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 50) {
    throw new DomainException('INVALID_SLUG', HttpStatus.BAD_REQUEST, {
      detail: 'use lowercase letters, digits and single dashes (max 50 characters)',
    });
  }
  return slug;
}
