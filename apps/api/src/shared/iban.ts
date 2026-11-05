/**
 * An IBAN typed by a person: spaces removed, upper case. Valid when it has the shape of its
 * country (two letters, two check digits, up to 30 characters; 27 for Italy) and its check digits
 * pass the ISO 7064 mod-97 test.
 */
export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith('IT') && iban.length !== 27) return false;
  // Country and check digits go to the end; letters become numbers (A = 10 … Z = 35).
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}
