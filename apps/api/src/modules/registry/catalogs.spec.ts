import {
  isLegalForm,
  isUnit,
  isVatCode,
  LEGAL_FORMS,
  unitDecimals,
  UNITS,
  VAT_CODES,
} from './catalogs.js';

describe('registry catalogs', () => {
  it('gives every exemption nature a zero rate', () => {
    for (const vat of VAT_CODES.filter((v) => v.nature !== null)) {
      expect(vat.rate).toBe('0.00');
      expect(vat.code).toBe(vat.nature);
    }
  });

  it('gives no nature to the non-zero rates', () => {
    for (const vat of VAT_CODES.filter((v) => v.rate !== '0.00')) {
      expect(vat.nature).toBeNull();
      expect(Number(vat.rate)).toBe(Number(vat.code));
    }
  });

  it('has no duplicate codes', () => {
    for (const codes of [
      VAT_CODES.map((v) => v.code),
      UNITS.map((u) => u.code),
      LEGAL_FORMS.map((f) => f.code),
    ]) {
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it('recognizes only catalog codes', () => {
    expect(isVatCode('22')).toBe(true);
    expect(isVatCode('N6.3')).toBe(true);
    expect(isVatCode('21')).toBe(false);
    expect(isVatCode('N2')).toBe(false);
    expect(isUnit('PZ')).toBe(true);
    expect(isUnit('pz')).toBe(false);
    expect(isLegalForm('SRL')).toBe(true);
    expect(isLegalForm('LTD')).toBe(false);
  });

  it('allows whole quantities for countable units and at most three decimals', () => {
    expect(unitDecimals('PZ')).toBe(0);
    expect(unitDecimals('KG')).toBe(3);
    expect(unitDecimals('H')).toBe(2);
    for (const unit of UNITS) expect(unit.decimals).toBeLessThanOrEqual(3);
  });
});
