import { legalNameOf, normalizeParty, type PartyInput } from './party-rules.js';

// Fictitious identifiers with valid check characters.
const VAT = '12345678903';
const PERSON_CODE = 'RSSMRA80A01H501U';

const company = (extra: Partial<PartyInput> = {}): PartyInput => ({
  kind: 'COMPANY',
  isCustomer: true,
  isSupplier: false,
  legalName: 'Ferramenta Bruni Srl',
  vatNumber: VAT,
  ...extra,
});

const privatePerson = (extra: Partial<PartyInput> = {}): PartyInput => ({
  kind: 'PRIVATE',
  isCustomer: true,
  isSupplier: false,
  firstName: 'Mario',
  lastName: 'Rossi',
  taxCode: PERSON_CODE,
  ...extra,
});

/** The field errors of an invalid input, as `field:CODE`. */
function errorsOf(input: PartyInput): string[] {
  try {
    normalizeParty(input);
  } catch (error) {
    const { code, errors } = error as { code: string; errors: { field: string; code: string }[] };
    expect(code).toBe('VALIDATION_FAILED');
    return errors.map((e) => `${e.field}:${e.code}`);
  }
  throw new Error('expected the input to be refused');
}

describe('party rules', () => {
  it('normalizes a company: IT prefix, spaces, case, blanks', () => {
    const party = normalizeParty(
      company({
        legalName: '  Ferramenta   Bruni Srl ',
        vatNumber: 'it 123 456 789 03',
        legalForm: 'srl',
        email: ' Info@Example.com ',
        province: 'mi',
        postalCode: '20121',
        sdiCode: 'abc1234',
        notes: '   ',
      }),
    );
    expect(party).toMatchObject({
      name: 'Ferramenta Bruni Srl',
      vatNumber: VAT,
      legalForm: 'SRL',
      email: 'info@example.com',
      province: 'MI',
      sdiCode: 'ABC1234',
      country: 'IT',
      notes: null,
      firstName: null,
    });
  });

  it('names people "Last First" and ignores a legal name for private people', () => {
    const party = normalizeParty(privatePerson({ legalName: 'Ignored' }));
    expect(party.name).toBe('Rossi Mario');
    expect(legalNameOf(party)).toBeNull();
  });

  it('keeps the legal name of a sole trader only when one is given', () => {
    const base = { kind: 'SOLE_TRADER' as const, firstName: 'Mario', lastName: 'Rossi' };
    const named = normalizeParty(
      privatePerson({ ...base, vatNumber: VAT, legalName: 'Bar Mario' }),
    );
    const unnamed = normalizeParty(privatePerson({ ...base, vatNumber: VAT }));
    expect([named.name, legalNameOf(named)]).toEqual(['Bar Mario', 'Bar Mario']);
    expect([unnamed.name, legalNameOf(unnamed)]).toEqual(['Rossi Mario', null]);
  });

  it('needs at least one role', () => {
    expect(errorsOf(company({ isCustomer: false }))).toEqual(['isCustomer:PARTY_NEEDS_ROLE']);
  });

  it.each([
    [company({ legalName: ' ' }), ['legalName:REQUIRED']],
    [company({ vatNumber: null }), ['vatNumber:REQUIRED']],
    [company({ vatNumber: '12345678901' }), ['vatNumber:VAT_NUMBER_INVALID']],
    [company({ taxCode: PERSON_CODE }), ['taxCode:TAX_CODE_INVALID']],
    [company({ legalForm: 'LTD' }), ['legalForm:LEGAL_FORM_UNKNOWN']],
    [company({ postalCode: '2012' }), ['postalCode:POSTAL_CODE_INVALID']],
    [company({ province: 'Milano' }), ['province:PROVINCE_INVALID']],
    [company({ sdiCode: 'ABC12' }), ['sdiCode:SDI_CODE_INVALID']],
    [company({ country: 'Italy' }), ['country:COUNTRY_INVALID']],
    [privatePerson({ taxCode: null }), ['taxCode:REQUIRED']],
    [privatePerson({ taxCode: '12345678903' }), ['taxCode:TAX_CODE_INVALID']],
    [privatePerson({ vatNumber: VAT }), ['vatNumber:NOT_ALLOWED']],
    [privatePerson({ legalForm: 'SRL' }), ['legalForm:NOT_ALLOWED']],
    [privatePerson({ firstName: '', lastName: null }), ['firstName:REQUIRED', 'lastName:REQUIRED']],
    [
      { ...company(), kind: 'ORGANIZATION' as const, vatNumber: null },
      ['taxCode:PARTY_NEEDS_IDENTIFIER'],
    ],
  ])('refuses %# with the error on the right field', (input, expected) => {
    expect(errorsOf(input)).toEqual(expected);
  });

  it('reports every broken rule at once', () => {
    expect(
      errorsOf(company({ legalName: '', vatNumber: '1', isSupplier: false, isCustomer: false })),
    ).toEqual([
      'isCustomer:PARTY_NEEDS_ROLE',
      'legalName:REQUIRED',
      'vatNumber:VAT_NUMBER_INVALID',
    ]);
  });

  it('accepts an organization with only an 11-digit tax code', () => {
    const party = normalizeParty({
      kind: 'ORGANIZATION',
      isCustomer: true,
      isSupplier: false,
      legalName: 'Associazione Amici del Libro',
      taxCode: '80012345676',
    });
    expect(party).toMatchObject({ vatNumber: null, taxCode: '80012345676' });
  });

  it('applies no Italian rule to foreign parties', () => {
    const party = normalizeParty(
      company({
        country: 'de',
        vatNumber: 'de 123456789',
        taxCode: 'anything',
        postalCode: '10115',
      }),
    );
    expect(party).toMatchObject({
      country: 'DE',
      vatNumber: 'DE123456789',
      taxCode: 'ANYTHING',
      postalCode: '10115',
    });
    expect(normalizeParty(privatePerson({ country: 'FR', taxCode: null })).taxCode).toBeNull();
  });

  it('refuses Italian-only fields abroad', () => {
    expect(errorsOf(company({ country: 'DE', legalForm: 'SRL', province: 'MI' }))).toEqual([
      'legalForm:NOT_ALLOWED',
      'province:NOT_ALLOWED',
    ]);
  });
});
