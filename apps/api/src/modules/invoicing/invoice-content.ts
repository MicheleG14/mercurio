import { Injectable } from '@nestjs/common';
import { type InvoiceKind, Prisma } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../prisma/index.js';
import { isDecimalString, PRICE, quantityError } from '../../shared/decimal.js';
import { FieldErrors, optionalText } from '../../shared/errors/index.js';
import { Money } from '../../shared/money.js';
import {
  isDocumentLanguage,
  isPaymentMethod,
  isPaymentTerms,
  isVatCode,
  RegistryService,
  unitDecimals,
  vatCodeInfo,
  vatSummary,
  type VatSummary,
} from '../registry/index.js';
import { STAMP_DUTY } from './invoice-rules.js';
import type { DraftLineInputDto } from './invoicing.dto.js';
import type { InvoiceableRow, InvoiceRow, LineData } from './invoicing.repository.js';

const DISCOUNT = { integerDigits: 3, scale: 2 };

/** What a stamp duty line prints, in the language of the document. */
const STAMP_DUTY_LINE = {
  it: 'Rivalsa imposta di bollo',
  en: 'Stamp duty recharge',
} as const;

export interface DraftHeaderInput {
  partyId?: string | null;
  language?: string | null;
  paymentTerms?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
}

export interface CheckedHeader {
  partyId: string | null;
  language: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  notes: string | null;
}

/** A line once checked, with its amount (B36): what both tables store. */
export type CheckedLine = LineData & { lineAmount: Prisma.Decimal | null };

export interface CheckedContent {
  header: CheckedHeader;
  lines: CheckedLine[];
  summary: VatSummary;
  /** The shipments its lines invoice. */
  fulfilmentIds: string[];
}

/** What is left to credit of each line of an invoice, and of the invoice as a whole. */
export interface Creditable {
  lines: Map<string, { quantity: Prisma.Decimal | null; amount: Money }>;
  total: Money;
}

/** What a credit note works against: the invoice it corrects and what is left to credit. */
export interface CreditContext {
  invoice: InvoiceRow;
  creditable: Creditable;
}

export function creditableOf(
  invoice: InvoiceRow,
  creditNotes: readonly {
    total: Prisma.Decimal;
    lines: {
      creditedLineId: string | null;
      quantity: Prisma.Decimal | null;
      lineAmount: Prisma.Decimal | null;
    }[];
  }[],
): Creditable {
  const lines = new Map<string, { quantity: Prisma.Decimal | null; amount: Money }>();
  for (const line of invoice.lines) {
    if (!line.lineAmount) continue;
    lines.set(line.id, { quantity: line.quantity, amount: Money.of(line.lineAmount) });
  }
  for (const note of creditNotes) {
    for (const credited of note.lines) {
      const left = credited.creditedLineId ? lines.get(credited.creditedLineId) : undefined;
      if (!left || !credited.lineAmount) continue;
      left.amount = left.amount.minus(Money.of(credited.lineAmount));
      if (left.quantity && credited.quantity)
        left.quantity = left.quantity.minus(credited.quantity);
    }
  }
  const total = Money.of(invoice.total).minus(Money.sum(creditNotes.map((n) => Money.of(n.total))));
  return { lines, total };
}

/**
 * The rules of a draft's content, when it is saved and again when it is issued (a party or an item
 * may have been archived in between). A draft may be incomplete: no customer, no lines, no prices.
 * Issuing requires them. Field errors use the request's names (B17).
 */
@Injectable()
export class InvoiceContentChecker {
  constructor(private readonly registry: RegistryService) {}

  async check(
    tx: TenantTransaction,
    kind: InvoiceKind,
    header: DraftHeaderInput,
    inputs: readonly DraftLineInputDto[],
    context: {
      /** The shipments the lines may invoice, locked, by id. */
      shipments: ReadonlyMap<string, InvoiceableRow>;
      credit?: CreditContext;
      forIssue?: boolean;
    },
  ): Promise<CheckedContent> {
    const errors = new FieldErrors();
    const forIssue = context.forIssue ?? false;

    const partyId = header.partyId ?? null;
    if (partyId) {
      const [party] = await this.registry.findPartyRefs(tx, [partyId]);
      if (!party) errors.add('partyId', 'PARTY_NOT_FOUND');
      else if (!party.isCustomer) errors.add('partyId', 'PARTY_WRONG_ROLE');
      else if (party.archived && forIssue) errors.add('partyId', 'PARTY_ARCHIVED');
    } else if (forIssue) {
      errors.add('partyId', 'REQUIRED');
    }
    const language = optionalText(header.language)?.toLowerCase() ?? null;
    if (language && !isDocumentLanguage(language)) errors.add('language', 'LANGUAGE_UNKNOWN');
    const paymentTerms = optionalText(header.paymentTerms)?.toUpperCase() ?? null;
    if (paymentTerms && !isPaymentTerms(paymentTerms)) {
      errors.add('paymentTerms', 'PAYMENT_TERMS_UNKNOWN');
    }
    const paymentMethod = optionalText(header.paymentMethod)?.toUpperCase() ?? null;
    if (paymentMethod && !isPaymentMethod(paymentMethod)) {
      errors.add('paymentMethod', 'PAYMENT_METHOD_UNKNOWN');
    }

    if (
      forIssue &&
      !inputs.some((line) => line.quantity || line.fulfilmentId || line.stampDutyCharge)
    ) {
      errors.add('lines', 'NO_LINES');
    }
    const items = new Map(
      (
        await this.registry.findItemRefs(
          tx,
          inputs.flatMap((line) => (line.itemId && !line.fulfilmentId ? [line.itemId] : [])),
        )
      ).map((item) => [item.id, item]),
    );
    const creditedLines = new Map(context.credit?.invoice.lines.map((line) => [line.id, line]));
    const fulfilmentIds = new Set<string>();
    const seenShipped = new Set<string>();
    /** Credited per invoice line by this draft, to compare with what is left. */
    const crediting = new Map<string, { quantity: Prisma.Decimal; amount: Money; index: number }>();

    const lines = inputs.map((input, index): CheckedLine | null => {
      const at = (field: string) => `lines[${index}].${field}`;
      const lineNo = index + 1;
      const discount = input.discountPercent ?? '0';
      const discountOk = isDecimalString(discount, DISCOUNT) && Number(discount) <= 100;
      if (!discountOk) errors.add(at('discountPercent'), 'DISCOUNT_INVALID');
      const price = input.unitPrice ?? null;
      const priceOk = price === null || isDecimalString(price, PRICE);
      if (!priceOk) errors.add(at('unitPrice'), 'PRICE_INVALID');
      const typed = optionalText(input.description);

      // The stamp duty charged to the customer: 2 €, excluded from VAT (art. 15, nature N1).
      if (input.stampDutyCharge) {
        const vat = vatCodeInfo('N1')!;
        return {
          lineNo,
          itemId: null,
          description: STAMP_DUTY_LINE[language === 'en' ? 'en' : 'it'],
          unit: null,
          quantity: new Prisma.Decimal(1),
          unitPrice: STAMP_DUTY.toDecimal(),
          discountPercent: new Prisma.Decimal(0),
          vatCode: vat.code,
          vatRate: new Prisma.Decimal(vat.rate),
          vatNature: vat.nature,
          lineAmount: STAMP_DUTY.toDecimal(),
          fulfilmentId: null,
          orderLineId: null,
          creditedLineId: null,
          stampDutyCharge: true,
        };
      }

      // A shipped line: what left the warehouse is fixed, its price and description are not.
      if (input.fulfilmentId || input.orderLineId) {
        if (kind !== 'INVOICE') {
          errors.add(at('fulfilmentId'), 'NOT_ALLOWED');
          return null;
        }
        const shipment = input.fulfilmentId ? context.shipments.get(input.fulfilmentId) : undefined;
        const shipped = shipment?.lines.find((l) => l.orderLineId === input.orderLineId);
        if (!shipment || !shipped) {
          errors.add(at('orderLineId'), 'FULFILMENT_LINE_NOT_FOUND');
          return null;
        }
        const key = `${shipment.fulfilmentId}/${shipped.orderLineId}`;
        if (seenShipped.has(key)) errors.add(at('orderLineId'), 'DUPLICATE_LINE');
        seenShipped.add(key);
        if (input.quantity && !new Prisma.Decimal(safe(input.quantity)).equals(shipped.quantity)) {
          errors.add(at('quantity'), 'FULFILMENT_LINE_QUANTITY_FIXED');
        }
        fulfilmentIds.add(shipment.fulfilmentId);
        if (!priceOk || !discountOk) return null;
        const unitPrice = price === null ? shipped.unitPrice : new Prisma.Decimal(price);
        const discountPercent =
          input.discountPercent === undefined
            ? shipped.discountPercent
            : new Prisma.Decimal(discount);
        return {
          lineNo,
          itemId: shipped.itemId,
          description: typed ?? shipped.description,
          unit: shipped.unit,
          quantity: shipped.quantity,
          unitPrice,
          discountPercent,
          vatCode: shipped.vatCode,
          vatRate: shipped.vatRate,
          vatNature: shipped.vatNature,
          lineAmount: Money.lineAmount(shipped.quantity, unitPrice, discountPercent).toDecimal(),
          fulfilmentId: shipment.fulfilmentId,
          orderLineId: shipped.orderLineId,
          creditedLineId: null,
          stampDutyCharge: false,
        };
      }

      // A line of a credit note that corrects a line of the invoice: same item, unit and VAT.
      if (input.creditedLineId) {
        const credited = context.credit ? creditedLines.get(input.creditedLineId) : undefined;
        if (!context.credit) {
          errors.add(at('creditedLineId'), 'NOT_ALLOWED');
          return null;
        }
        if (!credited || !credited.lineAmount) {
          errors.add(at('creditedLineId'), 'CREDITED_LINE_NOT_FOUND');
          return null;
        }
        const quantityText = input.quantity ?? null;
        const quantityProblem =
          quantityText === null
            ? 'REQUIRED'
            : quantityError(quantityText, unitDecimals(credited.unit ?? ''));
        if (quantityProblem) errors.add(at('quantity'), quantityProblem);
        if (quantityProblem || !priceOk || !discountOk) return null;
        const quantity = new Prisma.Decimal(quantityText!);
        const unitPrice = price === null ? credited.unitPrice! : new Prisma.Decimal(price);
        const discountPercent =
          input.discountPercent === undefined
            ? credited.discountPercent
            : new Prisma.Decimal(discount);
        const amount = Money.lineAmount(quantity, unitPrice, discountPercent);
        const sum = crediting.get(credited.id);
        crediting.set(credited.id, {
          quantity: (sum?.quantity ?? new Prisma.Decimal(0)).plus(quantity),
          amount: (sum?.amount ?? Money.ZERO).plus(amount),
          index,
        });
        return {
          lineNo,
          itemId: credited.itemId,
          description: typed ?? credited.description,
          unit: credited.unit,
          quantity,
          unitPrice,
          discountPercent,
          vatCode: credited.vatCode,
          vatRate: credited.vatRate,
          vatNature: credited.vatNature,
          lineAmount: amount.toDecimal(),
          fulfilmentId: null,
          orderLineId: null,
          creditedLineId: credited.id,
          stampDutyCharge: false,
        };
      }

      // An item or a service of the registry, or a free line.
      const item = input.itemId ? items.get(input.itemId) : undefined;
      if (input.itemId) {
        if (!item) errors.add(at('itemId'), 'ITEM_NOT_FOUND');
        else if (item.archived) errors.add(at('itemId'), 'ITEM_ARCHIVED');
      }
      const description = typed ?? item?.description ?? null;
      if (!description) errors.add(at('description'), 'REQUIRED');
      const quantityText = input.quantity ?? null;
      if (quantityText === null) {
        if (input.itemId) errors.add(at('quantity'), 'REQUIRED');
        if (price !== null) errors.add(at('unitPrice'), 'NOT_ALLOWED');
        if (input.vatCode) errors.add(at('vatCode'), 'NOT_ALLOWED');
        if (input.itemId || price !== null || input.vatCode || !description) return null;
        return descriptive(lineNo, description);
      }
      const quantityProblem = quantityError(quantityText, item ? unitDecimals(item.unit) : 3);
      if (quantityProblem) errors.add(at('quantity'), quantityProblem);
      const vatCode = input.vatCode ?? item?.vatCode ?? null;
      if (vatCode === null) errors.add(at('vatCode'), 'REQUIRED');
      else if (!isVatCode(vatCode)) errors.add(at('vatCode'), 'VAT_CODE_UNKNOWN');
      if (price === null && forIssue) errors.add(at('unitPrice'), 'REQUIRED');
      if (
        (input.itemId && (!item || item.archived)) ||
        !description ||
        quantityProblem ||
        !priceOk ||
        !discountOk ||
        !vatCode ||
        !isVatCode(vatCode)
      ) {
        return null;
      }
      const vat = vatCodeInfo(vatCode)!;
      const quantity = new Prisma.Decimal(quantityText);
      const unitPrice = price === null ? null : new Prisma.Decimal(price);
      const discountPercent = new Prisma.Decimal(discount);
      return {
        lineNo,
        itemId: item?.id ?? null,
        description,
        unit: item?.unit ?? null,
        quantity,
        unitPrice,
        discountPercent,
        vatCode,
        vatRate: new Prisma.Decimal(vat.rate),
        vatNature: vat.nature,
        lineAmount:
          unitPrice === null
            ? null
            : Money.lineAmount(quantity, unitPrice, discountPercent).toDecimal(),
        fulfilmentId: null,
        orderLineId: null,
        creditedLineId: null,
        stampDutyCharge: false,
      };
    });

    // A credit note never gives back more of a line than is left of it (quantity and amount).
    if (context.credit) {
      for (const [lineId, credited] of crediting) {
        const left = context.credit.creditable.lines.get(lineId)!;
        const overQuantity = left.quantity !== null && credited.quantity.greaterThan(left.quantity);
        if (overQuantity || credited.amount.greaterThan(left.amount)) {
          errors.add(`lines[${credited.index}].quantity`, 'CREDIT_OVER_INVOICED');
        }
      }
    }
    errors.throwIfAny();

    const checked = lines as CheckedLine[];
    const summary = vatSummary(
      checked.flatMap((line) =>
        line.lineAmount && line.vatCode && isVatCode(line.vatCode)
          ? [{ vatCode: line.vatCode, amount: Money.of(line.lineAmount) }]
          : [],
      ),
    );
    return {
      header: { partyId, language, paymentTerms, paymentMethod, notes: optionalText(header.notes) },
      lines: checked,
      summary,
      fulfilmentIds: [...fulfilmentIds],
    };
  }
}

/** A line of text only: a delivery note reference, a note. */
export function descriptive(lineNo: number, description: string): CheckedLine {
  return {
    lineNo,
    itemId: null,
    description,
    unit: null,
    quantity: null,
    unitPrice: null,
    discountPercent: new Prisma.Decimal(0),
    vatCode: null,
    vatRate: null,
    vatNature: null,
    lineAmount: null,
    fulfilmentId: null,
    orderLineId: null,
    creditedLineId: null,
    stampDutyCharge: false,
  };
}

/** A quantity as sent, for comparing: text that is not a number compares as -1. */
function safe(value: string): string {
  try {
    return new Prisma.Decimal(value).toString();
  } catch {
    return '-1';
  }
}
