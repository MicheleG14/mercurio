import { describe, expect, it } from 'vitest';
import { missingForInvoices, normalizeCompanyProfile } from './company-profile.js';

/** The field errors of an invalid input, as `field:CODE`. */
function errorsOf(country: string, input: Parameters<typeof normalizeCompanyProfile>[1]) {
  try {
    normalizeCompanyProfile(country, input);
  } catch (error) {
    return (error as { errors: { field: string; code: string }[] }).errors.map(
      (e) => `${e.field}:${e.code}`,
    );
  }
  throw new Error('expected the input to be refused');
}

describe('company profile', () => {
  it('normalizes the header data of an Italian company', () => {
    expect(
      normalizeCompanyProfile('IT', {
        address: '  Via Roma 1 ',
        postalCode: '20121',
        city: 'Milano',
        province: 'mi',
        reaOffice: 'mi',
        reaNumber: '1234567',
        shareCapital: '10000',
        iban: 'it60 x054 2811 1010 0000 0123 456',
        pecEmail: 'Rossi@PEC.example.com',
      }),
    ).toMatchObject({
      address: 'Via Roma 1',
      province: 'MI',
      reaOffice: 'MI',
      shareCapital: '10000.00',
      iban: 'IT60X0542811101000000123456',
      pecEmail: 'rossi@pec.example.com',
      taxRegime: 'RF01',
      inLiquidation: false,
      chargeStampDuty: true,
    });
  });

  it('reports every broken rule on its field', () => {
    expect(
      errorsOf('IT', {
        postalCode: '2012',
        province: 'Milano',
        reaNumber: '123',
        shareCapital: '-5',
        taxRegime: 'RF03',
        iban: 'IT00X0542811101000000123456',
      }),
    ).toEqual([
      'postalCode:POSTAL_CODE_INVALID',
      'province:PROVINCE_INVALID',
      'reaOffice:REQUIRED',
      'shareCapital:AMOUNT_INVALID',
      'taxRegime:TAX_REGIME_UNKNOWN',
      'iban:IBAN_INVALID',
    ]);
    expect(errorsOf('DE', { province: 'BY' })).toEqual(['province:NOT_ALLOWED']);
  });

  it('lists what an invoice needs from the seller: the registered office', () => {
    const office = { address: 'Via Roma 1', postalCode: '20121', city: 'Milano', province: 'MI' };
    expect(missingForInvoices({ country: 'IT', ...office })).toEqual([]);
    expect(
      missingForInvoices({
        country: 'IT',
        address: null,
        postalCode: null,
        city: null,
        province: null,
      }),
    ).toEqual(['address', 'postalCode', 'city', 'province']);
    expect(missingForInvoices({ country: 'DE', ...office, province: null })).toEqual([]);
  });
});
