import type { ValidationError } from 'class-validator';
import { toFieldErrors, validationException } from './validation.js';

function error(
  property: string,
  constraints?: Record<string, string>,
  children: ValidationError[] = [],
): ValidationError {
  return { property, constraints, children } as ValidationError;
}

describe('toFieldErrors', () => {
  it('maps each broken constraint to a field and an UPPER_SNAKE_CASE code', () => {
    const errors = [error('email', { isEmail: 'email must be an email', isNotEmpty: '...' })];

    expect(toFieldErrors(errors)).toEqual([
      { field: 'email', code: 'IS_EMAIL' },
      { field: 'email', code: 'IS_NOT_EMPTY' },
    ]);
  });

  it('builds paths for nested objects and arrays', () => {
    const errors = [
      error('lines', undefined, [error('0', undefined, [error('quantity', { isPositive: '' })])]),
      error('address', undefined, [error('postalCode', { matches: '' })]),
    ];

    expect(toFieldErrors(errors)).toEqual([
      { field: 'lines[0].quantity', code: 'IS_POSITIVE' },
      { field: 'address.postalCode', code: 'MATCHES' },
    ]);
  });

  it('reports unknown fields with a dedicated code', () => {
    expect(toFieldErrors([error('isAdmin', { whitelistValidation: '' })])).toEqual([
      { field: 'isAdmin', code: 'UNKNOWN_FIELD' },
    ]);
  });

  it('wraps the errors in a 400 VALIDATION_FAILED domain exception', () => {
    const exception = validationException([error('email', { isEmail: '' })]);

    expect(exception).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(exception.errors).toEqual([{ field: 'email', code: 'IS_EMAIL' }]);
  });
});
