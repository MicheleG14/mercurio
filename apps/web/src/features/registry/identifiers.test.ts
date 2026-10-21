import {
  compactVat,
  isValidCompanyTaxCode,
  isValidItalianVat,
  isValidPersonalTaxCode,
} from './identifiers';

describe('Italian identifiers (client checks)', () => {
  it('checks VAT numbers like the API', () => {
    expect(compactVat(' it 123 456 789 03')).toBe('12345678903');
    expect(isValidItalianVat('IT12345678903')).toBe(true);
    expect(isValidItalianVat('12345678901')).toBe(false);
    expect(isValidItalianVat('00000000000')).toBe(false);
    expect(isValidItalianVat('1234567890')).toBe(false);
  });

  it('checks personal tax codes with their check letter', () => {
    expect(isValidPersonalTaxCode('rssmra80a01h501u')).toBe(true);
    expect(isValidPersonalTaxCode('RSSMRA80A01H501A')).toBe(false);
    expect(isValidPersonalTaxCode('12345678903')).toBe(false);
  });

  it('checks company tax codes as VAT numbers', () => {
    expect(isValidCompanyTaxCode('12345678903')).toBe(true);
    expect(isValidCompanyTaxCode('IT12345678903')).toBe(false);
  });
});
