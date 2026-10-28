import { lineAmount, vatPreview } from './money';

// The same cases as the API's Money and VAT summary tests: the preview must agree to the cent.
describe('money preview', () => {
  it.each([
    ['3', '1.3333', '0', '4.00'],
    ['3', '1.3333', '10', '3.60'],
    ['1.250', '7.9900', '0', '9.99'],
    ['7', '0.0050', '0', '0.04'],
    ['2', '10', '100', '0.00'],
    ['0.333', '3', '0', '1.00'],
    ['10', '19.99', '12.5', '174.91'],
  ])('%s × %s less %s%% is %s', (quantity, price, discount, amount) => {
    expect(lineAmount(quantity, price, discount)).toBe(amount);
  });

  it('computes VAT on the sum per rate, and skips lines without a price', () => {
    const preview = vatPreview([
      { vatCode: '22', vatRate: '22.00', amount: '0.25' },
      { vatCode: '22', vatRate: '22.00', amount: '0.25' },
      { vatCode: '22', vatRate: '22.00', amount: '0.25' },
      { vatCode: '4', vatRate: '4.00', amount: '10.11' },
      { vatCode: '22', vatRate: '22.00', amount: null },
    ]);
    expect(preview.rows).toEqual([
      { vatCode: '22', rate: '22.00', taxable: '0.75', vat: '0.17' },
      { vatCode: '4', rate: '4.00', taxable: '10.11', vat: '0.40' },
    ]);
    expect(preview).toMatchObject({ taxableTotal: '10.86', vatTotal: '0.57', total: '11.43' });
  });
});
