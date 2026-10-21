/**
 * Italian tax identifiers: VAT number (partita IVA) and tax code (codice fiscale). Pure
 * functions with no business rules: each module decides when an identifier is required and
 * which error to report. Shared by tenancy (companies) and registry (parties), a declared
 * exception to the "rule of three" of B5, since the alternative is copying a check algorithm.
 */

/** Removes spaces and uppercases: how people type identifiers, not how they are stored. */
export function compactIdentifier(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/** "IT 123…" → "123…": the country prefix people often type before an Italian VAT number. */
export function stripItalianPrefix(value: string): string {
  const compact = compactIdentifier(value);
  return /^IT\d{11}$/.test(compact) ? compact.slice(2) : compact;
}

/**
 * Why an Italian VAT number is invalid, for developers and logs, or null when it is valid:
 * 11 digits, not all zeros (passes the check digit but is never assigned), right check digit.
 */
export function italianVatNumberProblem(digits: string): string | null {
  if (!/^\d{11}$/.test(digits)) return 'expected 11 digits';
  if (/^0+$/.test(digits)) return 'not an assigned number';
  if (!hasValidItalianCheckDigit(digits)) return 'wrong check digit';
  return null;
}

export function isValidItalianVatNumber(digits: string): boolean {
  return italianVatNumberProblem(digits) === null;
}

/**
 * Italian VAT check digit: odd positions (1st, 3rd…) are summed; even positions are doubled,
 * minus 9 when above 9, and summed; the 11th digit makes the total a multiple of 10.
 */
export function hasValidItalianCheckDigit(digits: string): boolean {
  return /^\d{11}$/.test(digits) && italianCheckDigit(digits.slice(0, 10)) === digits[10];
}

/** The check digit for the first 10 digits of a VAT number (or a company tax code). */
export function italianCheckDigit(first10: string): string {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = Number(first10[i]);
    if (i % 2 === 0) {
      sum += digit;
    } else {
      const doubled = digit * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    }
  }
  return String((10 - (sum % 10)) % 10);
}

// Tax code of a person: surname (3 letters), name (3), year (2 digits), month (letter),
// day and sex (2 digits, +40 for women), place of birth (letter + 3 digits), check letter.
// When two people would get the same code ("omocodia"), digits are replaced by letters from
// the right with L=0, M=1, N=2, P=3, Q=4, R=5, S=6, T=7, U=8, V=9: they are valid as well.
const OMOCODE = '[0-9LMNPQRSTUV]';
const PERSONAL_TAX_CODE = new RegExp(
  `^[A-Z]{6}${OMOCODE}{2}[ABCDEHLMPRST]${OMOCODE}{2}[A-Z]${OMOCODE}{3}[A-Z]$`,
);

// Values of the characters in odd positions (1st, 3rd…), from the Ministry decree of 1976.
// Digits take the value of the letter at the same index (0 = A, 1 = B…).
const ODD_VALUES = [
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23,
];

/** The check letter of the first 15 characters of a personal tax code. */
export function personalTaxCodeCheckChar(first15: string): string {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const char = first15[i]!;
    const index = /\d/.test(char) ? Number(char) : char.charCodeAt(0) - 65;
    // Positions are counted from 1, so index 0 is an odd position.
    sum += i % 2 === 0 ? ODD_VALUES[index]! : index;
  }
  return String.fromCharCode(65 + (sum % 26));
}

/** A 16-character tax code of a person, omocodia included, with the right check letter. */
export function isValidPersonalTaxCode(code: string): boolean {
  return PERSONAL_TAX_CODE.test(code) && personalTaxCodeCheckChar(code.slice(0, 15)) === code[15];
}

/** An 11-digit tax code of a company or organization: the same check as a VAT number. */
export function isValidCompanyTaxCode(code: string): boolean {
  return isValidItalianVatNumber(code);
}
