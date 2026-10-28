import { Prisma } from '../generated/prisma/client.js';
import { Money } from './money.js';

describe('Money', () => {
  it('keeps amounts to the cent and prints them with two decimals', () => {
    expect(Money.of('12.5').toString()).toBe('12.50');
    expect(Money.of(new Prisma.Decimal('0')).toString()).toBe('0.00');
  });

  it('refuses an amount with more than two decimals instead of rounding it silently', () => {
    expect(() => Money.of('1.005')).toThrow(RangeError);
  });

  it.each([
    ['0.005', '0.01'],
    ['0.0049', '0.00'],
    ['2.675', '2.68'],
    ['-0.005', '-0.01'],
    ['-2.675', '-2.68'],
  ])('rounds %s to %s: half a cent away from zero', (value, rounded) => {
    expect(Money.round(value).toString()).toBe(rounded);
  });

  it('adds without the errors of binary floating point', () => {
    expect(Money.of('0.1').plus(Money.of('0.2')).toString()).toBe('0.30');
    expect(Money.sum(['0.10', '0.20', '0.30'].map((a) => Money.of(a))).toString()).toBe('0.60');
    expect(Money.of('1').minus(Money.of('0.99')).toString()).toBe('0.01');
    expect(Money.sum([]).isZero()).toBe(true);
  });

  describe('line amount', () => {
    it.each([
      // quantity, unit price, discount, amount
      ['3', '1.3333', '0', '4.00'],
      ['3', '1.3333', '10', '3.60'],
      ['1.250', '7.9900', '0', '9.99'], // 9.9875
      ['7', '0.0050', '0', '0.04'], // 0.035: half a cent rounds up
      ['2', '10', '100', '0.00'],
      ['0.333', '3', '0', '1.00'], // 0.999
      ['10', '19.99', '12.5', '174.91'], // 174.9125
    ])('%s × %s less %s%% is %s, rounded once at the end', (quantity, price, discount, amount) => {
      expect(Money.lineAmount(quantity, price, discount).toString()).toBe(amount);
    });

    it('has no discount by default', () => {
      expect(Money.lineAmount('2', '2.5').toString()).toBe('5.00');
    });
  });

  it('computes a percentage rounded to the cent (the VAT on a taxable)', () => {
    expect(Money.of('100').percent('22.00').toString()).toBe('22.00');
    expect(Money.of('0.25').percent('22.00').toString()).toBe('0.06'); // 0.055
    expect(Money.of('10.10').percent('4.00').toString()).toBe('0.40'); // 0.404
    expect(Money.of('99.99').percent('0.00').isZero()).toBe(true);
  });

  it('compares by value and hands Prisma a decimal', () => {
    expect(Money.of('1.5').equals(Money.of('1.50'))).toBe(true);
    expect(Money.of('1.5').toDecimal().toFixed(2)).toBe('1.50');
  });
});
