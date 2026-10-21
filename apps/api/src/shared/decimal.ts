import { ValidateBy, type ValidationOptions } from 'class-validator';
import { Prisma } from '../generated/prisma/client.js';

/**
 * Decimals in the JSON of the API (docs/conventions.md B30, docs/adr/0019): prices and
 * quantities travel as strings with a dot, `"12.5000"`, never as JSON numbers, which cannot hold
 * values like 0.1 exactly. The database keeps them as numeric and Prisma as Decimal.
 */
export interface DecimalFormat {
  /** Digits before the dot: 10 for numeric(14,4). */
  integerDigits: number;
  /** Digits after the dot, at most. */
  scale: number;
}

/** Unit prices: numeric(14,4) (B8). */
export const PRICE: DecimalFormat = { integerDigits: 10, scale: 4 };

/** Non-negative decimal written with a dot, no sign, no exponent, no thousands separator. */
export function isDecimalString(value: unknown, format: DecimalFormat): value is string {
  if (typeof value !== 'string') return false;
  const pattern = new RegExp(`^\\d{1,${format.integerDigits}}(\\.\\d{1,${format.scale}})?$`);
  return pattern.test(value);
}

/**
 * DTO decorator for a decimal string. An invalid value is reported on its field with the code
 * `IS_DECIMAL_STRING` (see shared/errors/validation.ts).
 */
export function IsDecimalString(format: DecimalFormat, options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isDecimalString',
      constraints: [format],
      validator: { validate: (value) => isDecimalString(value, format) },
    },
    options,
  );
}

/** A request value for Prisma. The string is passed through, so no digit is ever rounded. */
export function toDecimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** A stored value for the JSON response, always with the column's scale: `"12.5000"`. */
export function fromDecimal(value: Prisma.Decimal, format: DecimalFormat): string;
export function fromDecimal(value: Prisma.Decimal | null, format: DecimalFormat): string | null;
export function fromDecimal(value: Prisma.Decimal | null, format: DecimalFormat): string | null {
  return value === null ? null : value.toFixed(format.scale);
}
