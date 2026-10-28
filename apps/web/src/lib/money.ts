/**
 * Amounts in euro computed in the browser, for a preview while a document is typed: the line
 * amount and the VAT summary, with the same rules as the API (docs/conventions.md B36). The API
 * computes them again and is the authority; these only show the total before saving. Decimal
 * strings (B30) become exact integers here (BigInt), never JS numbers.
 */

/** "12.5" with `scale` decimals → 12500n for scale 3. Signs are not expected. */
function scaled(value: string, scale: number): bigint {
  const [integer = '0', fraction = ''] = value.split('.');
  return (
    BigInt(integer) * 10n ** BigInt(scale) +
    BigInt(fraction.padEnd(scale, '0').slice(0, scale) || '0')
  );
}

/** n / d rounded to the nearest integer, half away from zero (both positive here). */
function divideRounded(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (2n * d);
}

function cents(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

/**
 * Quantity × unit price, less the discount in percent, rounded to the cent once at the end:
 * "3" × "1.3333" less "10" → "3.60". Strings as the API takes them (a dot, no sign).
 */
export function lineAmount(quantity: string, unitPrice: string, discountPercent = '0'): string {
  // Quantity in thousandths, price in ten-thousandths, the part kept in ten-thousandths of a
  // unit (100% = 10000): the product has 11 decimals, cents have 2.
  const kept = 10000n - scaled(discountPercent, 2);
  return cents(divideRounded(scaled(quantity, 3) * scaled(unitPrice, 4) * kept, 10n ** 9n));
}

export interface VatPreviewLine {
  vatCode: string;
  /** "22.00" */
  vatRate: string;
  /** "3.60", or null for a line without a price yet. */
  amount: string | null;
}

export interface VatPreview {
  rows: { vatCode: string; rate: string; taxable: string; vat: string }[];
  taxableTotal: string;
  vatTotal: string;
  total: string;
}

/** Taxable per VAT code, VAT on each sum rounded to the cent, totals: as an invoice does. */
export function vatPreview(lines: readonly VatPreviewLine[]): VatPreview {
  const byCode = new Map<string, { rate: string; taxable: bigint }>();
  for (const line of lines) {
    if (line.amount === null) continue;
    const row = byCode.get(line.vatCode) ?? { rate: line.vatRate, taxable: 0n };
    row.taxable += scaled(line.amount, 2);
    byCode.set(line.vatCode, row);
  }
  let taxableTotal = 0n;
  let vatTotal = 0n;
  const rows = [...byCode].map(([vatCode, { rate, taxable }]) => {
    const vat = divideRounded(taxable * scaled(rate, 2), 10000n);
    taxableTotal += taxable;
    vatTotal += vat;
    return { vatCode, rate, taxable: cents(taxable), vat: cents(vat) };
  });
  return {
    rows,
    taxableTotal: cents(taxableTotal),
    vatTotal: cents(vatTotal),
    total: cents(taxableTotal + vatTotal),
  };
}
