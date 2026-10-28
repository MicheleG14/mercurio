import { Prisma } from '../../generated/prisma/client.js';
import { ORDER_KINDS, orderReference, parseOrderReference } from './order-kinds.js';
import {
  discountError,
  lineAmount,
  orderDateError,
  orderTotals,
  priceError,
  remainingOf,
  statusFromLines,
} from './order-rules.js';

const d = (value: string | number) => new Prisma.Decimal(value);
const priced = (
  quantity: string,
  price: string | null,
  discount = '0',
  vatCode = '22' as const,
) => ({
  quantity: d(quantity),
  unitPrice: price === null ? null : d(price),
  discountPercent: d(discount),
  vatCode,
});
const progress = (quantity: number, done: number, closed: number) => ({
  quantity: d(quantity),
  doneQuantity: d(done),
  closedQuantity: d(closed),
});

describe('order kinds', () => {
  it('numbers purchases OF and sales OC, and only sales reserve goods', () => {
    expect(ORDER_KINDS.PURCHASE).toMatchObject({
      series: 'OF',
      party: 'supplier',
      reserves: false,
    });
    expect(ORDER_KINDS.SALES).toMatchObject({ series: 'OC', party: 'customer', reserves: true });
  });

  it('formats and reads references', () => {
    expect(orderReference({ series: 'OC', year: 2026, number: 12 })).toBe('OC-2026/0012');
    expect(parseOrderReference(' oc-2026/12 ')).toEqual({ series: 'OC', year: 2026, number: 12 });
    expect(parseOrderReference('CA-2026/12')).toBeNull();
  });
});

describe('order amounts', () => {
  it('computes a line amount once, rounded to the cent, and none without a price', () => {
    expect(lineAmount(priced('3', '1.3333', '10'))!.toString()).toBe('3.60');
    expect(lineAmount(priced('3', null))).toBeNull();
  });

  it('totals the lines with VAT on the sum per rate, skipping lines without a price', () => {
    const totals = orderTotals([
      priced('1', '0.25'),
      priced('1', '0.25'),
      priced('1', '0.25'),
      priced('2', '10', '0', '4' as never),
      priced('5', null),
    ]);
    expect(totals.taxableTotal.toString()).toBe('20.75');
    expect(totals.vatTotal.toString()).toBe('0.97'); // 0.17 + 0.80
    expect(totals.total.toString()).toBe('21.72');
  });

  it.each([
    ['0', null],
    ['12.5', null],
    ['100', null],
    ['100.01', 'DISCOUNT_INVALID'],
    ['-1', 'DISCOUNT_INVALID'],
    ['5.123', 'DISCOUNT_INVALID'],
  ])('checks the discount %s', (value, error) => {
    expect(discountError(value)).toBe(error);
  });

  it('checks a price as a decimal string with at most four decimals', () => {
    expect(priceError('1.2345')).toBeNull();
    expect(priceError('1,5')).toBe('PRICE_INVALID');
    expect(priceError('1.23456')).toBe('PRICE_INVALID');
  });
});

describe('order progress', () => {
  it('leaves to move what was neither moved nor closed', () => {
    expect(remainingOf(progress(10, 4, 3)).toString()).toBe('3');
  });

  it.each([
    [[progress(10, 0, 0), progress(5, 0, 0)], 'CONFIRMED'],
    [[progress(10, 0, 10), progress(5, 0, 0)], 'CONFIRMED'],
    [[progress(10, 2, 0), progress(5, 0, 0)], 'PARTIAL'],
    [[progress(10, 10, 0), progress(5, 2, 3)], 'COMPLETED'],
    [[progress(10, 0, 10)], 'COMPLETED'],
  ])('derives the status of %j as %s', (lines, status) => {
    expect(statusFromLines(lines)).toBe(status);
  });

  it('accepts an order date in the past, never in the future', () => {
    expect(orderDateError('2020-01-31', '2026-10-28')).toBeNull();
    expect(orderDateError('2026-10-29', '2026-10-28')).toBe('DATE_IN_FUTURE');
    expect(orderDateError('2026-02-30', '2026-10-28')).toBe('DATE_INVALID');
  });
});
