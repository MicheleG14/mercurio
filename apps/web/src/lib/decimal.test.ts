import { decimalToInput, formatMoney, parseDecimalInput } from './decimal';

// Intl may use a narrow no-break space before the euro sign: compare with plain spaces.
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('decimals', () => {
  it('formats amounts in euro in each language, from the string itself', () => {
    expect(plain(formatMoney('12345.5000', 'it'))).toBe('12.345,50 €');
    // Italian groups only from five digits (CLDR minimum grouping digits).
    expect(plain(formatMoney('1234.5000', 'it'))).toBe('1234,50 €');
    expect(formatMoney('1234.5000', 'en')).toBe('€1,234.50');
    expect(plain(formatMoney('0.1250', 'it'))).toBe('0,125 €');
    // Beyond what a double can hold exactly: the string is formatted, not a number.
    expect(formatMoney('9999999999.9999', 'en')).toBe('€9,999,999,999.9999');
  });

  it('shows a stored decimal in an input with the language separator and no grouping', () => {
    expect(decimalToInput('12.5000', 'it')).toBe('12,50');
    expect(decimalToInput('1234.1250', 'it')).toBe('1234,125');
    expect(decimalToInput('12.5000', 'en')).toBe('12.50');
    expect(decimalToInput(null, 'it')).toBe('');
  });

  it.each([
    ['12,50', 'it', '12.50'],
    [' 1 234,5 ', 'it', '1234.5'],
    ['12', 'it', '12'],
    ['0,1', 'it', '0.1'],
    ['12.50', 'en', '12.50'],
    ['', 'it', null],
  ])('reads %j typed in %s as %j', (text, language, expected) => {
    expect(parseDecimalInput(text, language)).toBe(expected);
  });

  it.each([
    ['12.50', 'it', 'the English separator in Italian is ambiguous'],
    ['12,50', 'en', 'the Italian separator in English'],
    ['1.234,50', 'it', 'thousands separators'],
    ['-1', 'it', 'negative'],
    ['12,12345', 'it', 'five decimals'],
    ['12345678901', 'it', 'eleven integer digits'],
    [',5', 'it', 'no integer part'],
    ['12,', 'it', 'no fraction after the separator'],
    ['1e3', 'en', 'exponent'],
  ])('refuses %j in %s (%s)', (text, language) => {
    expect(parseDecimalInput(text, language)).toBeUndefined();
  });
});
