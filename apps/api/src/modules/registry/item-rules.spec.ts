import { FieldErrors } from './field-errors.js';
import { normalizeItem, normalizeItemCode } from './item-rules.js';

const fieldErrors = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { errors: { field: string; code: string }[] }).errors.map(
      (e) => `${e.field}:${e.code}`,
    );
  }
  throw new Error('expected an error');
};

describe('item rules', () => {
  it('normalizes an item, a service by choice', () => {
    expect(
      normalizeItem({
        description: '  Installazione  ',
        unit: 'H',
        vatCode: '22',
        salePrice: '45.5',
        stockManaged: false,
        notes: '',
      }),
    ).toEqual({
      description: 'Installazione',
      unit: 'H',
      vatCode: '22',
      salePrice: '45.5',
      stockManaged: false,
      notes: null,
    });
  });

  it('manages stock unless told otherwise, and allows no price', () => {
    expect(normalizeItem({ description: 'Vite', unit: 'PZ', vatCode: 'N4' })).toMatchObject({
      stockManaged: true,
      salePrice: null,
    });
  });

  it('refuses units and VAT codes outside the catalogs', () => {
    expect(
      fieldErrors(() => normalizeItem({ description: ' ', unit: 'XX', vatCode: '21' })),
    ).toEqual(['description:REQUIRED', 'unit:UNIT_UNKNOWN', 'vatCode:VAT_CODE_UNKNOWN']);
  });

  it.each([
    ['VT-M6.20/A_1', null],
    ['  VT-1  ', null],
    ['', 'code:REQUIRED'],
    ['VT 1', 'code:ITEM_CODE_INVALID'],
    ['VITE€', 'code:ITEM_CODE_INVALID'],
    ['X'.repeat(36), 'code:ITEM_CODE_INVALID'],
  ])('checks the code %j', (code, expected) => {
    const errors = new FieldErrors();
    normalizeItemCode(code, errors);
    if (expected === null) expect(() => errors.throwIfAny()).not.toThrow();
    else expect(fieldErrors(() => errors.throwIfAny())).toEqual([expected]);
  });
});
