import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { fromDecimal, IsDecimalString, isDecimalString, PRICE, toDecimal } from './decimal.js';

class Priced {
  @IsDecimalString(PRICE)
  price!: unknown;
}

describe('decimals in the API', () => {
  it.each(['0', '12', '12.5', '0.1', '9999999999.9999'])('accepts the price %s', (value) => {
    expect(isDecimalString(value, PRICE)).toBe(true);
  });

  it.each([
    ['12,50', 'comma'],
    ['-1', 'negative'],
    ['1e3', 'exponent'],
    ['12.', 'trailing dot'],
    ['.5', 'no integer part'],
    ['12.12345', 'five decimals'],
    ['12345678901', 'eleven integer digits'],
    ['1 000', 'thousands separator'],
    ['', 'empty'],
  ])('refuses %s (%s)', (value) => {
    expect(isDecimalString(value, PRICE)).toBe(false);
  });

  it('refuses JSON numbers: they cannot carry 0.1 exactly', () => {
    expect(isDecimalString(0.1, PRICE)).toBe(false);
  });

  it('reports an invalid value with a stable code', () => {
    const errors = validateSync(Object.assign(new Priced(), { price: '12,50' }));
    expect(errors[0]?.constraints).toHaveProperty('isDecimalString');
  });

  it('round-trips without losing digits, with the scale of the column', () => {
    expect(fromDecimal(toDecimal('0.1'), PRICE)).toBe('0.1000');
    expect(fromDecimal(toDecimal('12.5'), PRICE)).toBe('12.5000');
    expect(fromDecimal(toDecimal('9999999999.9999'), PRICE)).toBe('9999999999.9999');
    expect(fromDecimal(null, PRICE)).toBeNull();
  });
});
