import { INTL_LOCALES, type Language } from '@/i18n/resources';

/**
 * Decimals arrive from the API as strings with a dot, `"12.5000"` (docs/conventions.md B30), and
 * never become JS numbers on the way: Intl formats the string itself, exactly. These are the only
 * helpers that read or write them (F10): components never format or parse decimals themselves.
 */
function intlLocale(language: string): string {
  return INTL_LOCALES[language as Language] ?? INTL_LOCALES.it;
}

/** The decimal separator of the language: "," in Italian, "." in English. */
export function decimalSeparator(language: string): string {
  const parts = new Intl.NumberFormat(intlLocale(language)).formatToParts(1.5);
  return parts.find((part) => part.type === 'decimal')?.value ?? '.';
}

/** A decimal string as an amount in euro: "1234.5000" → "1.234,50 €" in Italian. */
export function formatMoney(value: string, language: string, maximumFractionDigits = 4): string {
  return new Intl.NumberFormat(intlLocale(language), {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(value as Intl.StringNumericLiteral);
}

/** A decimal string for an input field: no grouping, the language's separator, "12.5000" → "12,50". */
export function decimalToInput(
  value: string | null | undefined,
  language: string,
  minimumFractionDigits = 2,
): string {
  if (value === null || value === undefined || value === '') return '';
  return new Intl.NumberFormat(intlLocale(language), {
    useGrouping: false,
    minimumFractionDigits,
    maximumFractionDigits: 20,
  }).format(value as Intl.StringNumericLiteral);
}

export interface DecimalLimits {
  integerDigits: number;
  scale: number;
}

/** Unit prices: numeric(14,4), as in the API (B8). */
export const PRICE: DecimalLimits = { integerDigits: 10, scale: 4 };

/** Quantities in a unit with these decimals (numeric(14,3) at most, B8): pieces are whole. */
export const quantityLimits = (decimals: number): DecimalLimits => ({
  integerDigits: 11,
  scale: Math.min(decimals, 3),
});

/** A quantity as people read it: "1250.500" in kilograms → "1.250,5", pieces "12.000" → "12". */
export function formatQuantity(value: string, language: string, decimals = 3): string {
  return new Intl.NumberFormat(intlLocale(language), {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
    signDisplay: 'auto',
  }).format(value as Intl.StringNumericLiteral);
}

/**
 * What a person typed, as the API wants it: "12,50" in Italian → "12.50". Only the language's
 * decimal separator is accepted, and no thousands separator: "12.50" typed in Italian would be
 * ambiguous (twelve and a half, or one thousand two hundred and fifty?), so it is refused rather
 * than guessed. Returns null for an empty field, undefined when the text is not a valid decimal.
 */
export function parseDecimalInput(
  text: string,
  language: string,
  limits: DecimalLimits = PRICE,
): string | null | undefined {
  const compact = text.replace(/\s+/g, '');
  if (compact === '') return null;
  const separator = decimalSeparator(language);
  const [integer, fraction, ...rest] = compact.split(separator);
  if (rest.length > 0 || !integer || !/^\d+$/.test(integer)) return undefined;
  if (integer.length > limits.integerDigits) return undefined;
  if (fraction === undefined) return integer;
  if (!/^\d+$/.test(fraction) || fraction.length > limits.scale) return undefined;
  return `${integer}.${fraction}`;
}

/**
 * a − b for two quantities of the API ("4.000", "-2.5"), exactly: as integers of thousandths,
 * never through floating point. For the difference an inventory count will make.
 */
export function subtractQuantities(a: string, b: string): string {
  const thousandths = (value: string) => {
    const negative = value.startsWith('-');
    const [integer = '0', fraction = ''] = value.replace(/^[-+]/, '').split('.');
    const units = BigInt(integer) * 1000n + BigInt(fraction.padEnd(3, '0').slice(0, 3));
    return negative ? -units : units;
  };
  const difference = thousandths(a) - thousandths(b);
  const sign = difference < 0n ? '-' : '';
  const absolute = difference < 0n ? -difference : difference;
  return `${sign}${absolute / 1000n}.${String(absolute % 1000n).padStart(3, '0')}`;
}
