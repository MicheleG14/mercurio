import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../shared/errors/index.js';

/**
 * Emails are compared and stored lowercase and trimmed (the database checks it too). The
 * format check is deliberately simple: the real proof of an address is that its owner uses it.
 */
export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new DomainException('INVALID_EMAIL', HttpStatus.BAD_REQUEST);
  }
  return email;
}
