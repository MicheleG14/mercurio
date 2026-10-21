import {
  hasValidItalianCheckDigit,
  isValidCompanyTaxCode,
  isValidPersonalTaxCode,
  italianCheckDigit,
  italianVatNumberProblem,
  personalTaxCodeCheckChar,
  stripItalianPrefix,
} from './italian-identifiers.js';

describe('Italian VAT number', () => {
  it('computes the check digit', () => {
    // Odd positions 1+3+5+7+9 = 25; even 2,4,6,8,0 doubled = 4,8,12→3,16→7,0 = 22; 47 → 3.
    expect(italianCheckDigit('1234567890')).toBe('3');
    expect(hasValidItalianCheckDigit('12345678903')).toBe(true);
    expect(hasValidItalianCheckDigit('12345678901')).toBe(false);
  });

  it('removes spaces and the IT prefix', () => {
    expect(stripItalianPrefix(' it 123 456 789 03 ')).toBe('12345678903');
    // Only in front of 11 digits: anything else is left for the validation to refuse.
    expect(stripItalianPrefix('IT123')).toBe('IT123');
  });

  it.each([
    ['1234567890', 'expected 11 digits'],
    ['1234567890A', 'expected 11 digits'],
    ['12345678901', 'wrong check digit'],
    ['00000000000', 'not an assigned number'],
  ])('refuses %s: %s', (vat, problem) => {
    expect(italianVatNumberProblem(vat)).toBe(problem);
  });

  it('accepts a valid number', () => {
    expect(italianVatNumberProblem('12345678903')).toBeNull();
  });
});

describe('Italian tax code', () => {
  // A well-known sample code: Mario Rossi, born in Rome on 1 January 1980.
  const MARIO_ROSSI = 'RSSMRA80A01H501U';

  it('computes the check letter of a person', () => {
    expect(personalTaxCodeCheckChar(MARIO_ROSSI.slice(0, 15))).toBe('U');
    expect(isValidPersonalTaxCode(MARIO_ROSSI)).toBe(true);
  });

  it('refuses a wrong check letter', () => {
    expect(isValidPersonalTaxCode('RSSMRA80A01H501A')).toBe(false);
  });

  it('accepts omocodia: digits replaced by letters, with the check letter recomputed', () => {
    // The last digit 1 becomes M (L=0, M=1…); the check letter changes with it.
    const omocode = `RSSMRA80A01H50M`;
    const code = omocode + personalTaxCodeCheckChar(omocode);
    expect(code).not.toBe(MARIO_ROSSI);
    expect(isValidPersonalTaxCode(code)).toBe(true);
  });

  it.each([
    ['RSSMRA80Z01H501U', 'month Z does not exist'],
    ['RSSMRA80A01H5A1U', 'A is not an omocodia letter'],
    ['RSSMRA80A01H501', 'too short'],
    ['12345678903', 'company code'],
  ])('refuses %s as a personal code (%s)', (code) => {
    expect(isValidPersonalTaxCode(code)).toBe(false);
  });

  it('checks the 11 digits of a company like a VAT number', () => {
    expect(isValidCompanyTaxCode('12345678903')).toBe(true);
    expect(isValidCompanyTaxCode('12345678901')).toBe(false);
    expect(isValidCompanyTaxCode(MARIO_ROSSI)).toBe(false);
  });
});
