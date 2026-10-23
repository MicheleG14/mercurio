import { z } from 'zod';
import { parseDecimalInput, quantityLimits } from '@/lib/decimal';
import type { DocumentType, ItemOption, PartyOption, Reason, StockDocumentBody } from './queries';

/**
 * What the form needs to know of each reason: its type, and which party it names. The API keeps
 * the same catalog and is the authority (it checks every rule again); this copy only shapes the
 * form, so a mismatch shows up as a server error on the field, never as a wrong document.
 */
export const REASONS: Record<
  Reason,
  { type: DocumentType; party: 'supplier' | 'customer' | null; partyRequired: boolean }
> = {
  PURCHASE_RECEIPT: { type: 'receipt', party: 'supplier', partyRequired: true },
  CUSTOMER_RETURN: { type: 'receipt', party: 'customer', partyRequired: true },
  OPENING: { type: 'receipt', party: null, partyRequired: false },
  SALE_ISSUE: { type: 'issue', party: 'customer', partyRequired: false },
  INTERNAL_USE: { type: 'issue', party: null, partyRequired: false },
  LOSS: { type: 'issue', party: null, partyRequired: false },
  INVENTORY_ADJUSTMENT: { type: 'adjustment', party: null, partyRequired: false },
  TRANSFER: { type: 'transfer', party: null, partyRequired: false },
};

export const DOCUMENT_TYPES: DocumentType[] = ['receipt', 'issue', 'adjustment', 'transfer'];

/** The reasons of a type, the most common first (it is the default). */
export const reasonsOf = (type: DocumentType) =>
  (Object.keys(REASONS) as Reason[]).filter((reason) => REASONS[reason].type === type);

export const isDocumentType = (value: string | null): value is DocumentType =>
  DOCUMENT_TYPES.includes(value as DocumentType);

export interface LineValues {
  item: ItemOption | null;
  /** As typed, in the person's language: the amount moved, or what was counted. */
  quantity: string;
}

/** The document form; quantities are the text typed (B30: lib/decimal converts them). */
export function documentSchema(language: string) {
  return z
    .object({
      reason: z.enum(Object.keys(REASONS) as [Reason, ...Reason[]]),
      documentDate: z.string(),
      warehouseId: z.string().min(1, 'validation.REQUIRED'),
      targetWarehouseId: z.string(),
      party: z.custom<PartyOption | null>(),
      partyDocumentRef: z.string().max(35, 'validation.TOO_LONG'),
      partyDocumentDate: z.string(),
      notes: z.string().max(1000, 'validation.TOO_LONG'),
      lines: z.array(z.object({ item: z.custom<ItemOption | null>(), quantity: z.string() })),
    })
    .superRefine((v, ctx) => {
      const fail = (path: (string | number)[], code: string) =>
        ctx.addIssue({ code: 'custom', path, message: `validation.${code}` });
      const rule = REASONS[v.reason];
      if (!v.documentDate) fail(['documentDate'], 'REQUIRED');
      if (rule.type === 'transfer') {
        if (!v.targetWarehouseId) fail(['targetWarehouseId'], 'REQUIRED');
        else if (v.targetWarehouseId === v.warehouseId)
          fail(['targetWarehouseId'], 'SAME_WAREHOUSE');
      }
      if (rule.partyRequired && !v.party) fail(['party'], 'REQUIRED');
      if (v.reason === 'LOSS' && !v.notes.trim()) fail(['notes'], 'REQUIRED');
      if (v.lines.length === 0) fail(['lines'], 'ARRAY_MIN_SIZE');
      const counted = rule.type === 'adjustment';
      const seen = new Set<string>();
      v.lines.forEach((line, index) => {
        if (!line.item) {
          fail(['lines', index, 'item'], 'REQUIRED');
          return;
        }
        if (counted && seen.has(line.item.id)) fail(['lines', index, 'item'], 'DUPLICATE_ITEM');
        seen.add(line.item.id);
        const parsed = parseDecimalInput(
          line.quantity,
          language,
          quantityLimits(line.item.unitDecimals),
        );
        if (parsed === null) fail(['lines', index, 'quantity'], 'REQUIRED');
        else if (parsed === undefined) fail(['lines', index, 'quantity'], 'quantity');
        else if (!counted && /^0+(\.0+)?$/.test(parsed)) {
          fail(['lines', index, 'quantity'], 'QUANTITY_NOT_POSITIVE');
        }
      });
    });
}

export type DocumentValues = z.infer<ReturnType<typeof documentSchema>>;

export const emptyLine = (): LineValues => ({ item: null, quantity: '' });

export function emptyDocument(reason: Reason, today: string, warehouseId: string): DocumentValues {
  return {
    reason,
    documentDate: today,
    warehouseId,
    targetWarehouseId: '',
    party: null,
    partyDocumentRef: '',
    partyDocumentDate: '',
    notes: '',
    lines: [emptyLine()],
  };
}

/** The request for the API, with the id chosen when the form opened (B33). */
export function documentBody(
  values: DocumentValues,
  language: string,
  id: string,
): StockDocumentBody {
  const rule = REASONS[values.reason];
  const counted = rule.type === 'adjustment';
  return {
    id,
    reason: values.reason,
    documentDate: values.documentDate,
    warehouseId: values.warehouseId,
    targetWarehouseId: rule.type === 'transfer' ? values.targetWarehouseId : null,
    partyId: rule.party ? (values.party?.id ?? null) : null,
    partyDocumentRef: rule.party ? values.partyDocumentRef.trim() || null : null,
    partyDocumentDate: rule.party ? values.partyDocumentDate || null : null,
    notes: values.notes.trim() || null,
    lines: values.lines.map((line) => {
      const quantity = parseDecimalInput(
        line.quantity,
        language,
        quantityLimits(line.item!.unitDecimals),
      )!;
      return counted
        ? { itemId: line.item!.id, countedQuantity: quantity }
        : { itemId: line.item!.id, quantity };
    }),
  };
}

/**
 * Where a field error of the API goes in the form: `lines[2].quantity` → `lines.2.quantity`, the
 * ids sent for chosen records → the field that chose them.
 */
export function formPath(field: string): string {
  return field
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\.countedQuantity$/, '.quantity')
    .replace(/\.itemId$/, '.item')
    .replace(/^partyId$/, 'party');
}
