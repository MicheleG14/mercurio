import {
  decimalToInput,
  formatMoney,
  formatQuantity,
  parseDecimalInput,
  quantityLimits,
  subtractQuantities,
} from './decimal';

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

describe('quantities', () => {
  it('shows only the decimals that matter, up to the unit', () => {
    expect(formatQuantity('12.000', 'it', 0)).toBe('12');
    expect(formatQuantity('1250.500', 'it', 3)).toBe('1250,5');
    expect(formatQuantity('12500.250', 'en', 3)).toBe('12,500.25');
    expect(formatQuantity('-4.000', 'it', 0)).toBe('-4');
  });

  it('reads quantities with the decimals of the unit', () => {
    expect(parseDecimalInput('3', 'it', quantityLimits(0))).toBe('3');
    expect(parseDecimalInput('1,5', 'it', quantityLimits(0))).toBeUndefined();
    expect(parseDecimalInput('1,250', 'it', quantityLimits(3))).toBe('1.250');
    expect(parseDecimalInput('1,2505', 'it', quantityLimits(3))).toBeUndefined();
  });
});

describe('subtractQuantities', () => {
  it('subtracts exactly, signs included', () => {
    expect(subtractQuantities('4', '7.000')).toBe('-3.000');
    expect(subtractQuantities('0.3', '0.1')).toBe('0.200');
    expect(subtractQuantities('12.5', '-0.25')).toBe('12.750');
    expect(subtractQuantities('5.000', '5')).toBe('0.000');
  });
});
