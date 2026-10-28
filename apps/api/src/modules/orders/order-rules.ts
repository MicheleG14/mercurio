import { Prisma } from '../../generated/prisma/client.js';
import { isCalendarDate } from '../../shared/dates.js';
import { type DecimalFormat, isDecimalString, PRICE } from '../../shared/decimal.js';
import { Money } from '../../shared/money.js';
import { type VatCode, type VatSummary, vatSummary } from '../registry/index.js';

/**
 * Pure rules of orders: amounts, progress, status and dates. No database here, so every rule is
 * tested on its own (order-rules.spec.ts).
 */

/** A discount in percent: numeric(5,2), 0 to 100. */
export const DISCOUNT: DecimalFormat = { integerDigits: 3, scale: 2 };

/** null when the price is acceptable, otherwise the error code. */
export function priceError(value: string): string | null {
  return isDecimalString(value, PRICE) ? null : 'PRICE_INVALID';
}

/** null when the discount is acceptable, otherwise the error code. */
export function discountError(value: string): string | null {
  if (!isDecimalString(value, DISCOUNT)) return 'DISCOUNT_INVALID';
  return new Prisma.Decimal(value).greaterThan(100) ? 'DISCOUNT_INVALID' : null;
}

/** null when the order date is acceptable: a real day, not in the future. Past is fine. */
export function orderDateError(date: string, today: string): string | null {
  if (!isCalendarDate(date)) return 'DATE_INVALID';
  return date > today ? 'DATE_IN_FUTURE' : null;
}

export interface PricedLine {
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal | null;
  discountPercent: Prisma.Decimal;
  vatCode: VatCode;
}

/** The amount of a line (B36), or null for a line without a price. */
export function lineAmount(line: PricedLine): Money | null {
  return line.unitPrice === null
    ? null
    : Money.lineAmount(line.quantity, line.unitPrice, line.discountPercent);
}

/** Taxable, VAT per rate and total of an order: lines without a price add nothing. */
export function orderTotals(lines: readonly PricedLine[]): VatSummary {
  return vatSummary(
    lines.flatMap((line) => {
      const amount = lineAmount(line);
      return amount ? [{ vatCode: line.vatCode, amount }] : [];
    }),
  );
}

export interface LineProgress {
  quantity: Prisma.Decimal;
  doneQuantity: Prisma.Decimal;
  closedQuantity: Prisma.Decimal;
}

/** What is still to receive or ship: ordered, less moved, less closed. */
export function remainingOf(line: LineProgress): Prisma.Decimal {
  return line.quantity.minus(line.doneQuantity).minus(line.closedQuantity);
}

/**
 * The status of a confirmed order from its lines: completed when nothing remains, partial once
 * something moved, confirmed otherwise (a line closed by hand alone is not progress).
 */
export function statusFromLines(
  lines: readonly LineProgress[],
): 'CONFIRMED' | 'PARTIAL' | 'COMPLETED' {
  if (lines.every((line) => remainingOf(line).isZero())) return 'COMPLETED';
  if (lines.some((line) => !line.doneQuantity.isZero())) return 'PARTIAL';
  return 'CONFIRMED';
}

/** Open: confirmed and not finished, so goods can still move. */
export const OPEN_STATUSES = ['CONFIRMED', 'PARTIAL'] as const;
export const isOpen = (status: string) => (OPEN_STATUSES as readonly string[]).includes(status);
