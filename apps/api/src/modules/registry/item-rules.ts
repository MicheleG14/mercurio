import { isUnit, isVatCode } from './catalogs.js';
import { FieldErrors, optionalText } from '../../shared/errors/index.js';

/** What a person fills in for an item. The code is given only on creation: it never changes. */
export interface ItemInput {
  code?: string;
  description: string;
  unit: string;
  vatCode: string;
  /** Decimal string (B30), already checked for its format by the DTO. */
  salePrice?: string | null;
  stockManaged?: boolean;
  notes?: string | null;
}

export interface ItemData {
  description: string;
  unit: string;
  vatCode: string;
  salePrice: string | null;
  stockManaged: boolean;
  notes: string | null;
}

/** 1-35 letters, digits and - . _ /: 35 is the limit of an item code in the e-invoice. */
const ITEM_CODE = /^[A-Za-z0-9._/-]{1,35}$/;

/** The code of a new item, trimmed. Uniqueness is the database's job (unique index). */
export function normalizeItemCode(value: string, errors: FieldErrors): string {
  const code = value.trim();
  if (!code) errors.add('code', 'REQUIRED');
  else if (!ITEM_CODE.test(code)) errors.add('code', 'ITEM_CODE_INVALID');
  return code;
}

/**
 * Applies the item rules: description of 1-1000 characters (the e-invoice limit), unit of
 * measure and VAT code from the catalogs. Throws 400 VALIDATION_FAILED listing every broken rule.
 */
export function normalizeItem(input: ItemInput, errors = new FieldErrors()): ItemData {
  const description = input.description.trim();
  if (!description) errors.add('description', 'REQUIRED');
  else if (description.length > 1000) errors.add('description', 'TOO_LONG');
  if (!isUnit(input.unit)) errors.add('unit', 'UNIT_UNKNOWN');
  if (!isVatCode(input.vatCode)) errors.add('vatCode', 'VAT_CODE_UNKNOWN');
  errors.throwIfAny();
  return {
    description,
    unit: input.unit,
    vatCode: input.vatCode,
    salePrice: input.salePrice ?? null,
    stockManaged: input.stockManaged ?? true,
    notes: optionalText(input.notes),
  };
}
