import type { StockReason } from '../../generated/prisma/client.js';

/**
 * Why stock moves, fixed in code like the VAT codes (docs/adr/0021): each reason says which
 * numbering series it uses, which way goods go and which party it needs. Names are translations
 * in the frontend (G2a). A reversal is not in this list: it is made only by reversing a document,
 * with the series of the document it reverses.
 */
export const STOCK_REASONS = {
  OPENING: { type: 'receipt', series: 'CA', direction: 'in', party: null, partyRequired: false },
  PURCHASE_RECEIPT: {
    type: 'receipt',
    series: 'CA',
    direction: 'in',
    party: 'supplier',
    partyRequired: true,
  },
  CUSTOMER_RETURN: {
    type: 'receipt',
    series: 'CA',
    direction: 'in',
    party: 'customer',
    partyRequired: true,
  },
  SALE_ISSUE: {
    type: 'issue',
    series: 'SC',
    direction: 'out',
    party: 'customer',
    partyRequired: false,
  },
  INTERNAL_USE: {
    type: 'issue',
    series: 'SC',
    direction: 'out',
    party: null,
    partyRequired: false,
  },
  LOSS: { type: 'issue', series: 'SC', direction: 'out', party: null, partyRequired: false },
  INVENTORY_ADJUSTMENT: {
    type: 'adjustment',
    series: 'RE',
    direction: 'counted',
    party: null,
    partyRequired: false,
  },
  TRANSFER: {
    type: 'transfer',
    series: 'TR',
    direction: 'transfer',
    party: null,
    partyRequired: false,
  },
} as const satisfies Record<
  Exclude<StockReason, 'REVERSAL'>,
  {
    type: DocumentType;
    series: Series;
    /** in: stock grows; out: it shrinks; counted: the line says what is there; transfer: both. */
    direction: 'in' | 'out' | 'counted' | 'transfer';
    party: 'supplier' | 'customer' | null;
    partyRequired: boolean;
  }
>;

export type PostableReason = keyof typeof STOCK_REASONS;
export type DocumentType = 'receipt' | 'issue' | 'adjustment' | 'transfer';
export type Series = 'CA' | 'SC' | 'RE' | 'TR';

export const POSTABLE_REASONS = Object.keys(STOCK_REASONS) as PostableReason[];
export const DOCUMENT_TYPES: readonly DocumentType[] = [
  'receipt',
  'issue',
  'adjustment',
  'transfer',
];

/** A loss needs a word on what happened: it is the reason most worth explaining later. */
export const NOTES_REQUIRED: readonly PostableReason[] = ['LOSS'];

export function isPostableReason(value: string): value is PostableReason {
  return Object.hasOwn(STOCK_REASONS, value);
}

/** The reasons of a document type ("issue" → SALE_ISSUE, INTERNAL_USE, LOSS). */
export function reasonsOfType(type: DocumentType): PostableReason[] {
  return POSTABLE_REASONS.filter((reason) => STOCK_REASONS[reason].type === type);
}

/** One series per type: people think in "receipts" and "issues", whatever the reason. */
export const SERIES_OF_TYPE: Record<DocumentType, Series> = {
  receipt: 'CA',
  issue: 'SC',
  adjustment: 'RE',
  transfer: 'TR',
};

/** "CA-2026/0042": how people and printed documents refer to a stock document. */
export function documentReference(doc: { series: string; year: number; number: number }): string {
  return `${doc.series}-${doc.year}/${String(doc.number).padStart(4, '0')}`;
}

/** The inverse of documentReference, lenient on zeros: "ca-2026/42" works too. */
export function parseDocumentReference(
  text: string,
): { series: string; year: number; number: number } | null {
  const match = /^([A-Za-z]{2})-(\d{4})\/(\d{1,9})$/.exec(text.trim());
  if (!match) return null;
  return { series: match[1]!.toUpperCase(), year: Number(match[2]), number: Number(match[3]) };
}
