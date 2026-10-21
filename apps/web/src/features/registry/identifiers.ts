/**
 * Quick checks of Italian identifiers while typing, so a typo shows before saving. The API runs
 * the same checks and has the last word (apps/api/src/shared/italian-identifiers.ts): two copies
 * of a small algorithm, since the apps share no code.
 */

/** "IT 123…" → "123…", spaces removed, uppercase. */
export function compactVat(value: string): string {
  const compact = value.replace(/\s+/g, '').toUpperCase();
  return /^IT\d{11}$/.test(compact) ? compact.slice(2) : compact;
}

export function isValidItalianVat(value: string): boolean {
  const digits = compactVat(value);
  if (!/^\d{11}$/.test(digits) || /^0+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = Number(digits[i]);
    const weighted = i % 2 === 0 ? digit : digit * 2;
    sum += weighted > 9 ? weighted - 9 : weighted;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[10]);
}

const ODD_VALUES = [
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23,
];
const OMOCODE = '[0-9LMNPQRSTUV]';
const PERSONAL = new RegExp(
  `^[A-Z]{6}${OMOCODE}{2}[ABCDEHLMPRST]${OMOCODE}{2}[A-Z]${OMOCODE}{3}[A-Z]$`,
);

/** A 16-character personal tax code with the right check letter (omocodia included). */
export function isValidPersonalTaxCode(value: string): boolean {
  const code = value.replace(/\s+/g, '').toUpperCase();
  if (!PERSONAL.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const char = code[i]!;
    const index = /\d/.test(char) ? Number(char) : char.charCodeAt(0) - 65;
    sum += i % 2 === 0 ? ODD_VALUES[index]! : index;
  }
  return String.fromCharCode(65 + (sum % 26)) === code[15];
}

/** An 11-digit tax code of a company or organization: the same check as a VAT number. */
export const isValidCompanyTaxCode = (value: string) =>
  /^\d{11}$/.test(value.replace(/\s+/g, '')) && isValidItalianVat(value);
