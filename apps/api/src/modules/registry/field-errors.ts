import { HttpStatus } from '@nestjs/common';
import { DomainException, type FieldError } from '../../shared/errors/index.js';

/**
 * Collects every broken rule of a form before answering, so the person sees all of them at once,
 * each on its field (B17), with the same shape as the DTO validation: 400 VALIDATION_FAILED.
 */
export class FieldErrors {
  private readonly errors: FieldError[] = [];

  add(field: string, code: string): void {
    this.errors.push({ field, code });
  }

  throwIfAny(): void {
    if (this.errors.length > 0) {
      throw new DomainException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, {
        errors: this.errors,
      });
    }
  }
}

/** Trimmed text, or null when empty: optional fields never store blank strings. */
export function optionalText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/** Like optionalText, with inner runs of spaces collapsed: names and addresses. */
export function optionalLine(value: string | null | undefined): string | null {
  return optionalText(value)?.replace(/\s+/g, ' ') ?? null;
}
