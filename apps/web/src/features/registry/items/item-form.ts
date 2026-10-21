import { z } from 'zod';
import { decimalToInput, parseDecimalInput } from '@/lib/decimal';
import type { Item, ItemBody } from '../queries';

/** 1-35 letters, digits and - . _ /, as the API and the e-invoice allow. */
const ITEM_CODE = /^[A-Za-z0-9._/-]{1,35}$/;

/**
 * The item form. The price is the text typed in the person's language ("12,50"); itemBody turns
 * it into the API's decimal string with lib/decimal.ts (B30). `language` is the one the person is
 * using, so the same text is read the same way it is shown.
 */
export function itemSchema(language: string) {
  return z
    .object({
      code: z.string(),
      description: z.string(),
      unit: z.string().min(1, 'validation.REQUIRED'),
      vatCode: z.string().min(1, 'validation.REQUIRED'),
      salePrice: z.string(),
      stockManaged: z.boolean(),
      notes: z.string(),
    })
    .superRefine((v, ctx) => {
      const fail = (path: string, code: string) =>
        ctx.addIssue({ code: 'custom', path: [path], message: `validation.${code}` });
      const code = v.code.trim();
      if (!code) fail('code', 'REQUIRED');
      else if (!ITEM_CODE.test(code)) fail('code', 'ITEM_CODE_INVALID');
      if (!v.description.trim()) fail('description', 'REQUIRED');
      if (v.description.trim().length > 1000) fail('description', 'TOO_LONG');
      if (parseDecimalInput(v.salePrice, language) === undefined) fail('salePrice', 'decimal');
    });
}

export type ItemFormValues = z.infer<ReturnType<typeof itemSchema>>;

export const ITEM_FIELDS: (keyof ItemFormValues)[] = [
  'code',
  'description',
  'unit',
  'vatCode',
  'salePrice',
  'stockManaged',
  'notes',
];

export const emptyItem: ItemFormValues = {
  code: '',
  description: '',
  unit: 'PZ',
  vatCode: '22',
  salePrice: '',
  stockManaged: true,
  notes: '',
};

export function itemValues(item: Item, language: string): ItemFormValues {
  return {
    code: item.code,
    description: item.description,
    unit: item.unit,
    vatCode: item.vatCode,
    salePrice: decimalToInput(item.salePrice, language),
    stockManaged: item.stockManaged,
    notes: item.notes ?? '',
  };
}

export function itemBody(values: ItemFormValues, language: string): ItemBody {
  return {
    code: values.code.trim(),
    description: values.description.trim(),
    unit: values.unit,
    vatCode: values.vatCode,
    salePrice: parseDecimalInput(values.salePrice, language) ?? null,
    stockManaged: values.stockManaged,
    notes: values.notes.trim() || null,
  };
}
