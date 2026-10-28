import { Money } from '../../shared/money.js';
import { VAT_CODES, type VatCode } from './catalogs.js';

/** One VAT code of the catalog: what a document line copies when it is confirmed or issued. */
export type VatCodeInfo = (typeof VAT_CODES)[number];

/** The catalog entry of a VAT code, or undefined for a code outside the catalog. */
export function vatCodeInfo(code: string): VatCodeInfo | undefined {
  return VAT_CODES.find((vat) => vat.code === code);
}

/** A line as the VAT summary sees it: its VAT code and its amount, already rounded. */
export interface VatLine {
  vatCode: VatCode;
  amount: Money;
}

export interface VatSummaryRow {
  vatCode: VatCode;
  rate: string;
  nature: string | null;
  taxable: Money;
  vat: Money;
}

export interface VatSummary {
  /** One row per VAT code used, in catalog order (22%, 10%… then the natures). */
  rows: VatSummaryRow[];
  taxableTotal: Money;
  vatTotal: Money;
  total: Money;
}

/**
 * The VAT summary of a document (B36, docs/adr/0026): line amounts are added per VAT code, and
 * the VAT is computed once on each sum, as the Italian e-invoice does, never line by line. Orders
 * and invoices both come here, so the same lines always give the same totals.
 *
 * @example
 * // Three lines of 0.25 at 22%: VAT is 22% of 0.75 = 0.17, not 3 × 0.06 = 0.18.
 * vatSummary([0.25, 0.25, 0.25].map(…)).vatTotal.toString(); // "0.17"
 */
export function vatSummary(lines: readonly VatLine[]): VatSummary {
  const taxableByCode = new Map<VatCode, Money>();
  for (const line of lines) {
    taxableByCode.set(
      line.vatCode,
      (taxableByCode.get(line.vatCode) ?? Money.ZERO).plus(line.amount),
    );
  }

  const rows = VAT_CODES.filter((vat) => taxableByCode.has(vat.code)).map((vat) => {
    const taxable = taxableByCode.get(vat.code)!;
    return {
      vatCode: vat.code,
      rate: vat.rate,
      nature: vat.nature,
      taxable,
      vat: taxable.percent(vat.rate),
    };
  });
  const taxableTotal = Money.sum(rows.map((row) => row.taxable));
  const vatTotal = Money.sum(rows.map((row) => row.vat));
  return { rows, taxableTotal, vatTotal, total: taxableTotal.plus(vatTotal) };
}
