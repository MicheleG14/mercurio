import { Money } from '../../shared/money.js';
import type { VatCode } from './catalogs.js';
import { vatCodeInfo, vatSummary } from './vat.js';

const line = (vatCode: VatCode, amount: string) => ({ vatCode, amount: Money.of(amount) });

describe('VAT summary', () => {
  it('computes the VAT on the sum per rate, not line by line', () => {
    // Line by line: 3 × round(0.055) = 0.18. On the sum: round(0.165) = 0.17.
    const summary = vatSummary([line('22', '0.25'), line('22', '0.25'), line('22', '0.25')]);
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]!.taxable.toString()).toBe('0.75');
    expect(summary.vatTotal.toString()).toBe('0.17');
    expect(summary.total.toString()).toBe('0.92');
  });

  it('keeps one row per code, in catalog order, with rate and nature copied', () => {
    const summary = vatSummary([
      line('N3.1', '50'),
      line('4', '10.10'),
      line('22', '100'),
      line('4', '0.01'),
    ]);
    expect(
      summary.rows.map((row) => ({
        vatCode: row.vatCode,
        rate: row.rate,
        nature: row.nature,
        taxable: row.taxable.toString(),
        vat: row.vat.toString(),
      })),
    ).toEqual([
      { vatCode: '22', rate: '22.00', nature: null, taxable: '100.00', vat: '22.00' },
      { vatCode: '4', rate: '4.00', nature: null, taxable: '10.11', vat: '0.40' },
      { vatCode: 'N3.1', rate: '0.00', nature: 'N3.1', taxable: '50.00', vat: '0.00' },
    ]);
    expect(summary.taxableTotal.toString()).toBe('160.11');
    expect(summary.vatTotal.toString()).toBe('22.40');
    expect(summary.total.toString()).toBe('182.51');
  });

  it('has empty totals for a document without lines', () => {
    const summary = vatSummary([]);
    expect(summary.rows).toEqual([]);
    expect(summary.total.isZero()).toBe(true);
  });

  it('finds a code in the catalog', () => {
    expect(vatCodeInfo('10')).toEqual({ code: '10', rate: '10.00', nature: null });
    expect(vatCodeInfo('N6.1')?.nature).toBe('N6.1');
    expect(vatCodeInfo('21')).toBeUndefined();
  });
});
