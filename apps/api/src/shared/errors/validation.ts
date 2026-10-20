import { HttpStatus } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { DomainException } from './domain.exception.js';
import type { FieldError } from './problem-details.js';

/**
 * Turns class-validator results into one error per broken constraint, with the path of the
 * field and a code derived from the constraint name: `isEmail` becomes `IS_EMAIL`,
 * `whitelistValidation` (an unknown field) becomes `UNKNOWN_FIELD`.
 */
export function toFieldErrors(errors: ValidationError[], parentPath = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = joinPath(parentPath, error.property);
    const own = Object.keys(error.constraints ?? {}).map((constraint) => ({
      field,
      code: constraintCode(constraint),
    }));
    return [...own, ...toFieldErrors(error.children ?? [], field)];
  });
}

/** Used as the ValidationPipe's exceptionFactory, so invalid input follows docs/adr/0003. */
export function validationException(errors: ValidationError[]): DomainException {
  return new DomainException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, {
    errors: toFieldErrors(errors),
  });
}

function joinPath(parent: string, property: string): string {
  if (!parent) return property;
  return /^\d+$/.test(property) ? `${parent}[${property}]` : `${parent}.${property}`;
}

function constraintCode(constraint: string): string {
  if (constraint === 'whitelistValidation') return 'UNKNOWN_FIELD';
  return constraint.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}
