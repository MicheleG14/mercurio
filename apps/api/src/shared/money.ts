import { Prisma } from '../generated/prisma/client.js';
import { type DecimalFormat } from './decimal.js';

/** Amounts: numeric(14,2) (B8), in euro only (docs/adr/0017). */
export const AMOUNT: DecimalFormat = { integerDigits: 12, scale: 2 };

const ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

/**
 * An amount in euro, always to the cent: the one place where money is rounded (B8, B36).
 * Rounding is to the nearest cent, a half cent away from zero (0.005 → 0.01, −0.005 → −0.01).
 * Values come in and go out as decimal strings (B30), never as JS numbers.
 *
 * @example
 * Money.lineAmount('3', '1.3333', '10').toString(); // "3.60"
 */
export class Money {
  private constructor(private readonly value: Prisma.Decimal) {}

  static readonly ZERO = new Money(new Prisma.Decimal(0));

  /** An amount that is already in cents ("12.5", a stored numeric(14,2)); more decimals throw. */
  static of(value: string | Prisma.Decimal): Money {
    const decimal = new Prisma.Decimal(value);
    if (decimal.decimalPlaces() > AMOUNT.scale) {
      throw new RangeError(`An amount has at most two decimals: ${decimal.toString()}`);
    }
    return new Money(decimal);
  }

  /** Rounds any decimal to the cent. */
  static round(value: string | Prisma.Decimal): Money {
    return new Money(new Prisma.Decimal(value).toDecimalPlaces(AMOUNT.scale, ROUNDING));
  }

  /**
   * The amount of a document line: quantity × unit price, less the discount in percent, rounded
   * once at the end. Nothing in between is rounded (B36).
   */
  static lineAmount(
    quantity: string | Prisma.Decimal,
    unitPrice: string | Prisma.Decimal,
    discountPercent: string | Prisma.Decimal = '0',
  ): Money {
    const gross = new Prisma.Decimal(quantity).times(unitPrice);
    const kept = new Prisma.Decimal(100).minus(discountPercent).dividedBy(100);
    return Money.round(gross.times(kept));
  }

  static sum(amounts: Iterable<Money>): Money {
    let total = Money.ZERO;
    for (const amount of amounts) total = total.plus(amount);
    return total;
  }

  plus(other: Money): Money {
    return new Money(this.value.plus(other.value));
  }

  minus(other: Money): Money {
    return new Money(this.value.minus(other.value));
  }

  /** This amount times a rate in percent ("22.00"), rounded to the cent: the VAT on a taxable. */
  percent(rate: string | Prisma.Decimal): Money {
    return Money.round(this.value.times(rate).dividedBy(100));
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  equals(other: Money): boolean {
    return this.value.equals(other.value);
  }

  /** For Prisma: a numeric(14,2) column. */
  toDecimal(): Prisma.Decimal {
    return this.value;
  }

  /** For the JSON of the API: always two decimals, "12.50". */
  toString(): string {
    return this.value.toFixed(AMOUNT.scale);
  }
}
