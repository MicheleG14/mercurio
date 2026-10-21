import { normalizeCountry, normalizeTaxCode, normalizeVatNumber } from './company-identifiers.js';

// The check algorithms are tested in shared/italian-identifiers.spec.ts; here, how companies use
// them. 12345678903 has a valid check digit.
describe('company identifiers', () => {
  it('normalizes an Italian VAT number with prefix and spaces', () => {
    expect(normalizeVatNumber('IT', ' it 123 456 789 03 ')).toBe('12345678903');
  });

  it.each([
    ['1234567890', 'too short'],
    ['1234567890A', 'not a number'],
    ['12345678901', 'wrong check digit'],
    ['00000000000', 'never assigned'],
  ])('rejects the Italian VAT number %s (%s)', (vat) => {
    expect(() => normalizeVatNumber('IT', vat)).toThrow(
      expect.objectContaining({ code: 'VAT_NUMBER_INVALID' }),
    );
  });

  it('keeps foreign VAT numbers as typed, trimmed and uppercase', () => {
    expect(normalizeVatNumber('DE', ' de 123456789 ')).toBe('DE123456789');
  });

  it('accepts 11-digit and 16-character tax codes, and none', () => {
    expect(normalizeTaxCode('12345678903')).toBe('12345678903');
    expect(normalizeTaxCode('rssmra80a01h501u')).toBe('RSSMRA80A01H501U');
    expect(normalizeTaxCode('  ')).toBeUndefined();
    for (const wrong of ['ABC', '12345678901', 'RSSMRA80A01H501A']) {
      expect(() => normalizeTaxCode(wrong)).toThrow(
        expect.objectContaining({ code: 'TAX_CODE_INVALID' }),
      );
    }
  });

  it('defaults the country to Italy and validates it', () => {
    expect(normalizeCountry(undefined)).toBe('IT');
    expect(normalizeCountry(' de ')).toBe('DE');
    expect(() => normalizeCountry('Italy')).toThrow(
      expect.objectContaining({ code: 'COUNTRY_INVALID' }),
    );
  });
});
