import { describe, expect, it } from 'vitest';
import { isValidIban, normalizeIban } from './iban.js';

describe('IBAN', () => {
  it('accepts valid IBANs, typed with spaces and in lower case', () => {
    expect(isValidIban(normalizeIban('it60 x054 2811 1010 0000 0123 456'))).toBe(true);
    expect(isValidIban('DE89370400440532013000')).toBe(true);
    expect(isValidIban('GB82WEST12345698765432')).toBe(true);
  });

  it('refuses wrong check digits, shapes and Italian lengths', () => {
    expect(isValidIban('IT61X0542811101000000123456')).toBe(false);
    expect(isValidIban('IT60X054281110100000012345')).toBe(false);
    expect(isValidIban('1T60X0542811101000000123456')).toBe(false);
    expect(isValidIban('')).toBe(false);
  });
});
