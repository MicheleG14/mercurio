import { HttpStatus } from '@nestjs/common';
import type { FieldError } from './problem-details.js';

/**
 * A broken business rule, thrown by services (which know nothing about HTTP otherwise).
 * The exception filter turns it into a Problem Details response with the same `code`.
 *
 * @example
 * throw new DomainException('MODULE_NOT_ENABLED', HttpStatus.FORBIDDEN);
 */
export class DomainException extends Error {
  /** Developer-facing explanation; never shown as-is to users. */
  readonly detail?: string;
  readonly errors?: FieldError[];
  /** The resource a conflict is about (e.g. the party that already has a VAT number). */
  readonly existingId?: string;

  constructor(
    /** Stable, machine-readable code (UPPER_SNAKE_CASE). Part of the API contract. */
    readonly code: string,
    readonly status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
    options: { detail?: string; errors?: FieldError[]; existingId?: string } = {},
  ) {
    super(options.detail ?? code);
    this.name = 'DomainException';
    this.detail = options.detail;
    this.errors = options.errors;
    this.existingId = options.existingId;
  }
}
