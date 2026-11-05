import { decimalToInput, PRICE, parseDecimalInput, quantityLimits } from '@/lib/decimal';
import { lineAmount, type VatPreview, vatPreview } from '@/lib/money';
import type {
  CustomerOption,
  DocumentLine,
  DraftLineInput,
  InvoiceDraft,
  InvoiceItemOption,
  UpdateDraftBody,
} from './queries';

/** A discount in percent: up to 100, two decimals, as numeric(5,2) in the API. */
const DISCOUNT = { integerDigits: 3, scale: 2 };

/**
 * The kinds of line a draft holds. `shipped` and `credited` lines come from a shipment or from
 * the invoice a credit note corrects: their item and VAT are fixed (and a shipped quantity too).
 */
export type LineKind = 'line' | 'text' | 'shipped' | 'credited' | 'stamp';

export interface DraftLineValues {
  kind: LineKind;
  item: InvoiceItemOption | null;
  /** What the line is about when it cannot change: "VT-M6-20 · Vite…". */
  fixedLabel: string;
  description: string;
  /** As typed, in the person's language (B30: lib/decimal converts them). */
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  vatCode: string;
  fulfilmentId: string | null;
  orderLineId: string | null;
  creditedLineId: string | null;
}

export interface DraftValues {
  customer: CustomerOption | null;
  paymentTerms: string;
  paymentMethod: string;
  language: string;
  notes: string;
  lines: DraftLineValues[];
}

const kindOf = (line: DocumentLine): LineKind =>
  line.stampDutyCharge
    ? 'stamp'
    : line.fulfilmentId
      ? 'shipped'
      : line.creditedLineId
        ? 'credited'
        : line.quantity === null
          ? 'text'
          : 'line';

/** A saved draft back into the form, its decimals in the person's language. */
export function valuesOf(draft: InvoiceDraft, language: string): DraftValues {
  return {
    customer: draft.partyId
      ? { id: draft.partyId, name: draft.partyName ?? '', vatNumber: null }
      : null,
    paymentTerms: draft.paymentTerms ?? '',
    paymentMethod: draft.paymentMethod ?? '',
    language: draft.language ?? '',
    notes: draft.notes ?? '',
    lines: draft.lines.map((line) => {
      const kind = kindOf(line);
      return {
        kind,
        item:
          kind === 'line' && line.itemId
            ? {
                id: line.itemId,
                code: line.itemCode ?? '',
                description: line.description,
                unit: line.unit ?? '',
                salePrice: null,
                vatCode: line.vatCode ?? '',
              }
            : null,
        fixedLabel: line.itemCode ? `${line.itemCode} · ${line.unit ?? ''}` : '',
        description: line.description,
        quantity: line.quantity ? decimalToInput(line.quantity, language, 0) : '',
        unitPrice: line.unitPrice ? decimalToInput(line.unitPrice, language) : '',
        discountPercent:
          line.discountPercent === '0.00' ? '' : decimalToInput(line.discountPercent, language, 0),
        vatCode: line.vatCode ?? '',
        fulfilmentId: line.fulfilmentId,
        orderLineId: line.orderLineId,
        creditedLineId: line.creditedLineId,
      };
    }),
  };
}

export const emptyLine = (kind: 'line' | 'text' | 'stamp' = 'line'): DraftLineValues => ({
  kind,
  item: null,
  fixedLabel: '',
  description: '',
  quantity: kind === 'line' ? '1' : '',
  unitPrice: '',
  discountPercent: '',
  vatCode: '',
  fulfilmentId: null,
  orderLineId: null,
  creditedLineId: null,
});

/**
 * What the form says wrong before sending, as [field, message key]: the API checks it all again
 * and is the authority; this only spares a round trip for what is plainly wrong.
 */
export function formIssues(values: DraftValues, language: string): [string, string][] {
  const issues: [string, string][] = [];
  values.lines.forEach((line, index) => {
    const at = (field: string) => `lines.${index}.${field}`;
    if (line.kind === 'stamp') return;
    if (line.kind === 'text') {
      if (!line.description.trim()) issues.push([at('description'), 'validation.REQUIRED']);
      return;
    }
    const quantity = parseDecimalInput(line.quantity, language, quantityLimits(3));
    if (line.kind !== 'shipped') {
      if (quantity === null) issues.push([at('quantity'), 'validation.REQUIRED']);
      else if (quantity === undefined) issues.push([at('quantity'), 'validation.quantity']);
    }
    if (parseDecimalInput(line.unitPrice, language, PRICE) === undefined) {
      issues.push([at('unitPrice'), 'validation.PRICE_INVALID']);
    }
    if (parseDecimalInput(line.discountPercent, language, DISCOUNT) === undefined) {
      issues.push([at('discountPercent'), 'validation.DISCOUNT_INVALID']);
    }
    if (line.kind === 'line' && !line.item && !line.description.trim()) {
      issues.push([at('description'), 'validation.REQUIRED']);
    }
    if (line.kind === 'line' && !line.vatCode) issues.push([at('vatCode'), 'validation.REQUIRED']);
  });
  return issues;
}

/** One line of the request: only what the kind of line lets the person change. */
function lineInput(line: DraftLineValues, language: string): DraftLineInput {
  const price = parseDecimalInput(line.unitPrice, language, PRICE) ?? null;
  const discount = parseDecimalInput(line.discountPercent, language, DISCOUNT) ?? '0';
  const description = line.description.trim() || undefined;
  switch (line.kind) {
    case 'stamp':
      return { stampDutyCharge: true };
    case 'text':
      return { description };
    case 'shipped':
      return {
        fulfilmentId: line.fulfilmentId,
        orderLineId: line.orderLineId,
        description,
        ...(price ? { unitPrice: price } : {}),
        discountPercent: discount,
      };
    case 'credited':
      return {
        creditedLineId: line.creditedLineId,
        description,
        quantity: parseDecimalInput(line.quantity, language, quantityLimits(3)) ?? null,
        ...(price ? { unitPrice: price } : {}),
        discountPercent: discount,
      };
    case 'line':
      return {
        itemId: line.item?.id ?? null,
        description,
        quantity: parseDecimalInput(line.quantity, language, quantityLimits(3)) ?? null,
        unitPrice: price,
        discountPercent: discount,
        vatCode: line.vatCode || null,
      };
  }
}

/** The request for the API: header and lines, at the version read (B29). */
export function draftBody(values: DraftValues, language: string, version: number): UpdateDraftBody {
  return {
    version,
    partyId: values.customer?.id ?? null,
    paymentTerms: values.paymentTerms || null,
    paymentMethod: values.paymentMethod || null,
    language: (values.language || null) as UpdateDraftBody['language'],
    notes: values.notes.trim() || null,
    lines: values.lines.map((line) => lineInput(line, language)),
  };
}

/** A line's amount for the preview, or null while its quantity or price is missing or wrong. */
export function previewAmount(line: DraftLineValues, language: string): string | null {
  if (line.kind === 'text') return null;
  if (line.kind === 'stamp') return '2.00';
  const quantity = parseDecimalInput(line.quantity, language, quantityLimits(3));
  const price = parseDecimalInput(line.unitPrice, language, PRICE);
  const discount = parseDecimalInput(line.discountPercent, language, DISCOUNT);
  if (!quantity || !price || discount === undefined) return null;
  return lineAmount(quantity, price, discount ?? '0');
}

/** Totals and VAT summary as typed: a preview, the API computes them again when saving. */
export function previewTotals(
  lines: readonly DraftLineValues[],
  vatCodes: readonly { code: string; rate: string }[],
  language: string,
): VatPreview {
  return vatPreview(
    lines.flatMap((line) => {
      const code = line.kind === 'stamp' ? 'N1' : line.vatCode;
      const vat = vatCodes.find((v) => v.code === code);
      const amount = previewAmount(line, language);
      return vat ? [{ vatCode: vat.code, vatRate: vat.rate, amount }] : [];
    }),
  );
}

/**
 * Where a field error of the API goes in the form: `lines[2].unitPrice` → `lines.2.unitPrice`,
 * the ids sent for chosen records → the field that chose them.
 */
export function formPath(field: string): string {
  return field
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\.itemId$/, '.item')
    .replace(/\.(orderLineId|fulfilmentId|creditedLineId)$/, '.description')
    .replace(/^partyId$/, 'customer');
}
