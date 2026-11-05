// Events of the orders module (B4, docs/adr/0027): the contract other modules may listen to. This
// file is public like index.ts, and the only part of orders a listener may import
// (.dependency-cruiser.cjs). Values are plain: dates as "2026-10-12", decimals as strings (B30).

/** A line of a shipment, with what the sales order agreed for it. */
export interface FulfilledLine {
  orderLineId: string;
  lineNo: number;
  itemId: string;
  description: string;
  unit: string;
  /** What left the warehouse with this shipment, "3.000". */
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  vatCode: string;
  vatRate: string;
  vatNature: string | null;
}

/**
 * A sales order was shipped, in part or in full: the goods left with a stock document (the
 * delivery note). Published inside the shipment's transaction, also again by
 * `republish-fulfilments` for shipments recorded before anybody listened: listeners are
 * idempotent on `fulfilmentId`. Receipts of purchase orders publish nothing.
 */
export class OrderFulfilledEvent {
  constructor(
    readonly fulfilmentId: string,
    readonly order: {
      id: string;
      /** "OC-2026/0012". */
      reference: string;
      /** The customer's own reference of the order, if any. */
      partyReference: string | null;
      partyReferenceDate: string | null;
    },
    readonly partyId: string,
    /** The stock document that moved the goods: "SC-2026/0031" and its date. */
    readonly document: { id: string; reference: string; date: string },
    readonly lines: FulfilledLine[],
  ) {}
}

/**
 * A shipment of a sales order is being undone. A listener may refuse by throwing (an invoiced
 * shipment stays): the whole undo fails with its error.
 */
export class OrderFulfilmentReversedEvent {
  constructor(
    readonly fulfilmentId: string,
    readonly orderReference: string,
  ) {}
}
