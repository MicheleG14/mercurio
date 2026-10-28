import { z } from 'zod';
import { decimalToInput, PRICE, parseDecimalInput, quantityLimits } from '@/lib/decimal';
import { lineAmount, type VatPreview, vatPreview } from '@/lib/money';
import type {
  CreateOrderBody,
  Order,
  OrderItemOption,
  OrderKind,
  OrderPartyOption,
  VatCode,
} from './queries';

/** A discount in percent: up to 100, two decimals, as numeric(5,2) in the API. */
const DISCOUNT = { integerDigits: 3, scale: 2 };

/** "100.5" is more than a whole: compared as text, decimals never become numbers (B30). */
function overHundred(discount: string): boolean {
  const [integer = '0', fraction = ''] = discount.split('.');
  return Number(integer) > 100 || (Number(integer) === 100 && /[1-9]/.test(fraction));
}

export interface OrderLineValues {
  item: OrderItemOption | null;
  /** As typed, in the person's language (B30: lib/decimal converts them). */
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  vatCode: string;
}

/**
 * The order form, as a draft: it may be incomplete (confirmIssues says what confirming needs).
 * The API checks it all again and is the authority.
 */
export function orderSchema(language: string) {
  return z
    .object({
      party: z.custom<OrderPartyOption | null>(),
      warehouseId: z.string(),
      orderDate: z.string(),
      requestedDate: z.string(),
      partyReference: z.string().max(35, 'validation.TOO_LONG'),
      partyReferenceDate: z.string(),
      notes: z.string().max(1000, 'validation.TOO_LONG'),
      lines: z.array(
        z.object({
          item: z.custom<OrderItemOption | null>(),
          quantity: z.string(),
          unitPrice: z.string(),
          discountPercent: z.string(),
          vatCode: z.string(),
        }),
      ),
    })
    .superRefine((v, ctx) => {
      const fail = (path: (string | number)[], code: string) =>
        ctx.addIssue({ code: 'custom', path, message: `validation.${code}` });
      if (!v.party) fail(['party'], 'REQUIRED');
      if (!v.orderDate) fail(['orderDate'], 'REQUIRED');
      if (v.requestedDate && v.orderDate && v.requestedDate < v.orderDate) {
        fail(['requestedDate'], 'REQUESTED_BEFORE_ORDER');
      }
      v.lines.forEach((line, index) => {
        const at = (field: string) => ['lines', index, field];
        if (!line.item) {
          fail(at('item'), 'REQUIRED');
          return;
        }
        const quantity = parseDecimalInput(
          line.quantity,
          language,
          quantityLimits(line.item.unitDecimals),
        );
        if (quantity === null) fail(at('quantity'), 'REQUIRED');
        else if (quantity === undefined) fail(at('quantity'), 'quantity');
        else if (/^0+(\.0+)?$/.test(quantity)) fail(at('quantity'), 'QUANTITY_NOT_POSITIVE');
        const price = parseDecimalInput(line.unitPrice, language, PRICE);
        if (price === undefined) fail(at('unitPrice'), 'PRICE_INVALID');
        const discount = parseDecimalInput(line.discountPercent, language, DISCOUNT);
        if (discount === undefined || (discount !== null && overHundred(discount))) {
          fail(at('discountPercent'), 'DISCOUNT_INVALID');
        }
        if (!line.vatCode) fail(at('vatCode'), 'REQUIRED');
      });
    });
}

export type OrderValues = z.infer<ReturnType<typeof orderSchema>>;

/**
 * What confirming needs beyond a valid draft, as [field, message key]: a warehouse, at least one
 * line, and on a sales order a price on every line. Empty when the draft can be confirmed.
 */
export function confirmIssues(values: OrderValues, kind: OrderKind): [string, string][] {
  const issues: [string, string][] = [];
  if (!values.warehouseId) issues.push(['warehouseId', 'validation.REQUIRED']);
  if (values.lines.length === 0) issues.push(['lines', 'validation.NO_LINES']);
  if (kind === 'SALES') {
    values.lines.forEach((line, index) => {
      if (!line.unitPrice.trim()) issues.push([`lines.${index}.unitPrice`, 'validation.REQUIRED']);
    });
  }
  return issues;
}

export const emptyOrderLine = (): OrderLineValues => ({
  item: null,
  quantity: '',
  unitPrice: '',
  discountPercent: '',
  vatCode: '',
});

export function emptyOrder(today: string, warehouseId: string): OrderValues {
  return {
    party: null,
    warehouseId,
    orderDate: today,
    requestedDate: '',
    partyReference: '',
    partyReferenceDate: '',
    notes: '',
    lines: [emptyOrderLine()],
  };
}

/** A saved draft back into the form, its decimals in the person's language. */
export function valuesOf(order: Order, language: string): OrderValues {
  return {
    party: { id: order.partyId, name: order.partyName, vatNumber: null },
    warehouseId: order.warehouseId ?? '',
    orderDate: order.orderDate,
    requestedDate: order.requestedDate ?? '',
    partyReference: order.partyReference ?? '',
    partyReferenceDate: order.partyReferenceDate ?? '',
    notes: order.notes ?? '',
    lines: order.lines.map((line) => ({
      item: {
        id: line.itemId,
        code: line.itemCode,
        description: line.description,
        unit: line.unit,
        unitDecimals: line.unitDecimals,
        salePrice: null,
        vatCode: line.vatCode,
        availableQuantity: line.availableQuantity,
      },
      quantity: decimalToInput(line.quantity, language, 0),
      unitPrice: decimalToInput(line.unitPrice, language),
      discountPercent:
        line.discountPercent === '0.00' ? '' : decimalToInput(line.discountPercent, language, 0),
      vatCode: line.vatCode,
    })),
  };
}

/** The request for the API, with the id chosen when the form opened (B33). */
export function orderBody(
  values: OrderValues,
  language: string,
  id: string,
  kind: OrderKind,
): CreateOrderBody {
  return {
    id,
    kind,
    partyId: values.party!.id,
    warehouseId: values.warehouseId || null,
    orderDate: values.orderDate,
    requestedDate: values.requestedDate || null,
    partyReference: values.partyReference.trim() || null,
    partyReferenceDate: values.partyReferenceDate || null,
    notes: values.notes.trim() || null,
    lines: values.lines.map((line) => ({
      itemId: line.item!.id,
      quantity: parseDecimalInput(
        line.quantity,
        language,
        quantityLimits(line.item!.unitDecimals),
      )!,
      unitPrice: parseDecimalInput(line.unitPrice, language, PRICE) ?? null,
      discountPercent: parseDecimalInput(line.discountPercent, language, DISCOUNT) ?? '0',
      vatCode: line.vatCode,
    })),
  };
}

/** A line's amount for the preview, or null while its quantity or price is missing or wrong. */
export function previewAmount(line: OrderLineValues, language: string): string | null {
  if (!line.item) return null;
  const quantity = parseDecimalInput(
    line.quantity,
    language,
    quantityLimits(line.item.unitDecimals),
  );
  const price = parseDecimalInput(line.unitPrice, language, PRICE);
  const discount = parseDecimalInput(line.discountPercent, language, DISCOUNT);
  if (!quantity || !price || discount === undefined) return null;
  if (discount !== null && overHundred(discount)) return null;
  return lineAmount(quantity, price, discount ?? '0');
}

/** Totals and VAT summary of the form as typed: a preview, the API computes them again. */
export function previewTotals(
  lines: readonly OrderLineValues[],
  vatCodes: readonly VatCode[],
  language: string,
): VatPreview {
  return vatPreview(
    lines.flatMap((line) => {
      const vat = vatCodes.find((v) => v.code === line.vatCode);
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
    .replace(/^partyId$/, 'party');
}

/** "22%" for an ordinary rate, the nature ("N4") for an operation at 0%: short, for totals. */
export function vatShortLabel(code: string, rate: string): string {
  return rate === '0.00' ? code : `${code}%`;
}
