import type { OrderKind } from '../../generated/prisma/client.js';

/**
 * What differs between a purchase and a sales order, fixed in code like the stock reasons
 * (docs/adr/0024): the numbering series, the role of the party, the stock document that moves
 * the goods, whether goods are reserved and whether a price is required.
 */
export const ORDER_KINDS = {
  PURCHASE: {
    series: 'OF',
    party: 'supplier',
    stockReason: 'PURCHASE_RECEIPT',
    reserves: false,
    priceRequired: false,
  },
  SALES: {
    series: 'OC',
    party: 'customer',
    stockReason: 'SALE_ISSUE',
    reserves: true,
    priceRequired: true,
  },
} as const satisfies Record<
  OrderKind,
  {
    series: string;
    party: 'supplier' | 'customer';
    stockReason: 'PURCHASE_RECEIPT' | 'SALE_ISSUE';
    reserves: boolean;
    priceRequired: boolean;
  }
>;

export const ORDER_KIND_KEYS = Object.keys(ORDER_KINDS) as OrderKind[];

/** How the warehouse knows the documents and reservations an order makes (B35). */
export const ORIGIN_TYPE = 'order';

/** "OC-2026/0012": how people refer to a confirmed order. */
export function orderReference(order: { series: string; year: number; number: number }): string {
  return `${order.series}-${order.year}/${String(order.number).padStart(4, '0')}`;
}

/** The inverse of orderReference, lenient on zeros and case: "oc-2026/12" works too. */
export function parseOrderReference(
  text: string,
): { series: string; year: number; number: number } | null {
  const match = /^(OF|OC)-(\d{4})\/(\d{1,9})$/i.exec(text.trim());
  if (!match) return null;
  return { series: match[1]!.toUpperCase(), year: Number(match[2]), number: Number(match[3]) };
}
