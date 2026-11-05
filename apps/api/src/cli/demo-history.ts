import { Prisma } from '../generated/prisma/client.js';
import type { InvoicingService } from '../modules/invoicing/index.js';
import type { OrdersService } from '../modules/orders/index.js';
import type { CreateStockDocumentDto, WarehouseService } from '../modules/warehouse/index.js';
import type { CompanyContext, DbClient } from '../prisma/index.js';
import { addDays } from '../shared/dates.js';
import { uuidv7 } from '../shared/uuid.js';

/**
 * Twelve months of a demo company, written through the same use cases as the API, each action on
 * its own day: numbering, date rules, reservations and locks all apply. Dates are relative to a
 * reference day (`today`, the last day of the story), so what is overdue or due soon is always
 * there; quantities come from a generator with a fixed seed, so a reference day always gives the
 * same documents and amounts.
 *
 * The story is planned day by day while a small simulation of the stock keeps every quantity
 * possible (nothing below zero, nothing promised twice); what depends on the server's figures
 * (due dates, amounts still open) is planned when the server returns them.
 */

/** What the demo shows at least once; the seed reports what is missing (docs/adr/0028). */
export const FEATURES = [
  'stock.opening',
  'stock.purchaseReceipt',
  'stock.saleIssue',
  'stock.internalUse',
  'stock.loss',
  'stock.customerReturn',
  'stock.inventoryCount',
  'stock.transfer',
  'stock.reversal',
  'orders.purchaseReceivedInParts',
  'orders.purchaseIncoming',
  'orders.purchaseCancelled',
  'orders.purchaseDraft',
  'orders.salesShippedInParts',
  'orders.salesUncoveredAndLate',
  'orders.reserveAvailable',
  'orders.shipmentUndone',
  'orders.restClosed',
  'orders.salesDraft',
  'orders.transport',
  'invoicing.deferred',
  'invoicing.immediate',
  'invoicing.byHand',
  'invoicing.stampDuty',
  'invoicing.foreignCustomer',
  'invoicing.privateCustomer',
  'invoicing.instalments',
  'invoicing.creditPartial',
  'invoicing.creditTotal',
  'invoicing.refund',
  'invoicing.paymentPartial',
  'invoicing.paymentSeveralDueDates',
  'invoicing.paymentReversed',
  'invoicing.draft',
  'invoicing.toInvoiceLeft',
  'invoicing.withoutOrders',
  'invoicing.secondCompany',
] as const;
export type Feature = (typeof FEATURES)[number];

export interface HistoryServices {
  warehouse: WarehouseService;
  orders: OrdersService;
  invoicing: InvoicingService;
}

export interface HistoryItem {
  id: string;
  salePrice: string;
}

/** Which story a company gets. */
export type Story = 'rossi-srl' | 'rossi-logistica' | 'bianchi';

export interface HistoryInput {
  db: DbClient;
  services: HistoryServices;
  company: CompanyContext;
  story: Story;
  today: string;
  items: ReadonlyMap<string, HistoryItem>;
  /** Party ids by the demo's short names ("bruni", "edilnord"…). */
  parties: ReadonlyMap<string, string>;
  /** Warehouse ids by code. */
  warehouses: ReadonlyMap<string, string>;
}

export interface HistoryResult {
  documents: number;
  orders: number;
  invoices: number;
  features: Set<Feature>;
}

// ---- Small pure helpers ------------------------------------------------------------------------

/** A seeded pseudo-random generator (mulberry32): the same seed, the same story. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const isWorkday = (date: string) => weekday(date) >= 1 && weekday(date) <= 5;

/** The next working day from `date` on (itself if it is one). */
function workday(date: string): string {
  let day = date;
  while (!isWorkday(day)) day = addDays(day, 1);
  return day;
}

function lastOfMonth(date: string): string {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

/** The first day of the month twelve months before `today`: the story starts there. */
export function storyStart(today: string): string {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 12);
  return d.toISOString().slice(0, 10);
}

const half = (amount: string) => new Prisma.Decimal(amount).dividedBy(2).toFixed(2);

// ---- The timeline -------------------------------------------------------------------------------

/** Order of the steps of one day: goods in before they are promised, payments last. */
const AT = {
  stock: 0,
  receive: 1,
  sale: 2,
  reserve: 3,
  ship: 4,
  invoice: 5,
  credit: 6,
  pay: 7,
  undo: 8,
} as const;

interface Step {
  date: string;
  at: number;
  seq: number;
  run: () => Promise<void>;
}

/** Steps in date order; a step can add later ones. Nothing after `today` happens. */
class Timeline {
  /** Kept sorted: each new step goes in its place (binary search), the first one runs next. */
  private readonly steps: Step[] = [];
  private seq = 0;

  constructor(readonly today: string) {}

  add(date: string, at: number, run: () => Promise<void>): boolean {
    if (date > this.today) return false;
    const step = { date, at, seq: this.seq++, run };
    let low = 0;
    let high = this.steps.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (before(this.steps[mid]!, step)) low = mid + 1;
      else high = mid;
    }
    this.steps.splice(low, 0, step);
    return true;
  }

  async play(): Promise<void> {
    for (let step = this.steps.shift(); step; step = this.steps.shift()) await step.run();
  }
}

function before(a: Step, b: Step): boolean {
  return (
    a.date < b.date || (a.date === b.date && (a.at < b.at || (a.at === b.at && a.seq < b.seq)))
  );
}

/**
 * What is in each warehouse, as the story plans it: physical and reserved per item, with the
 * changes of days still to come. Quantities here are whole numbers (every demo unit is).
 */
class StockPlan {
  private readonly physical = new Map<string, number>();
  private readonly reserved = new Map<string, number>();
  private readonly later = new Map<string, (() => void)[]>();

  private key = (warehouse: string, item: string) => `${warehouse}:${item}`;

  /** Applies what was planned for `date`: call once per day, before planning it. */
  arrive(date: string): void {
    for (const change of this.later.get(date) ?? []) change();
    this.later.delete(date);
  }

  on(date: string, change: () => void): void {
    this.later.set(date, [...(this.later.get(date) ?? []), change]);
  }

  move(warehouse: string, item: string, physical: number, reserved = 0): void {
    const key = this.key(warehouse, item);
    this.physical.set(key, (this.physical.get(key) ?? 0) + physical);
    this.reserved.set(key, (this.reserved.get(key) ?? 0) + reserved);
  }

  physicalOf(warehouse: string, item: string): number {
    return this.physical.get(this.key(warehouse, item)) ?? 0;
  }

  available(warehouse: string, item: string): number {
    const key = this.key(warehouse, item);
    return (this.physical.get(key) ?? 0) - (this.reserved.get(key) ?? 0);
  }
}

// ---- Who buys what, and how they pay ------------------------------------------------------------

type Pays =
  /** On the due date, plus 0 to `late` days. */
  | { kind: 'onTime'; late: number }
  /** Late by `min` to `max` days; every fourth invoice in two halves. */
  | { kind: 'late'; min: number; max: number }
  /** Once a month, on `day`, every due date older than `lag` days, in one payment. */
  | { kind: 'batch'; day: number; lag: number }
  /** Pays only what fell due more than `recent` days ago, `late` days after it. */
  | { kind: 'slow'; recent: number; late: number };

interface Customer {
  terms: string;
  method: string;
  pays: Pays;
  /** Invoiced at each shipment, or once a month for the shipments of the month. */
  invoiced: 'immediate' | 'deferred';
  discount?: string;
  /** Items bought and how many at a time: [code, min, max, step]. */
  buys: readonly (readonly [string, number, number, number])[];
  transport?: boolean;
}

const ROSSI_CUSTOMERS: Record<string, Customer> = {
  bruni: {
    terms: '30FM',
    method: 'MP05',
    pays: { kind: 'onTime', late: 3 },
    invoiced: 'deferred',
    discount: '3',
    buys: [
      ['VT-M6-20', 200, 1000, 100],
      ['VT-M8-30', 200, 800, 100],
      ['DD-M6', 200, 1000, 100],
      ['RN-M6', 200, 1000, 100],
      ['TS-8', 2, 10, 1],
      ['CH-BRU', 1, 3, 1],
      ['TR-18V', 1, 2, 1],
      ['GU-NIT', 2, 6, 1],
    ],
  },
  edilnord: {
    terms: '30-60FM',
    method: 'MP12',
    pays: { kind: 'onTime', late: 0 },
    invoiced: 'deferred',
    discount: '5',
    transport: true,
    buys: [
      ['CM-PORT', 100, 300, 50],
      ['VR-BIA', 4, 12, 2],
      ['CV-3G15', 50, 150, 10],
      ['GU-NIT', 2, 6, 1],
    ],
  },
  marino: {
    terms: 'RD',
    method: 'MP05',
    pays: { kind: 'batch', day: 10, lag: 15 },
    invoiced: 'deferred',
    buys: [
      ['MAN-INST', 1, 2, 1],
      ['CH-BRU', 1, 2, 1],
      ['SM-125', 1, 1, 1],
    ],
  },
  ferri: {
    terms: 'RD',
    method: 'MP08',
    pays: { kind: 'onTime', late: 0 },
    invoiced: 'immediate',
    buys: [
      ['TR-18V', 1, 1, 1],
      ['VR-BIA', 2, 6, 2],
      ['GU-NIT', 1, 2, 1],
      ['TS-8', 1, 2, 1],
    ],
  },
};

/** Warehouse of the sales and its opening stock, which purchases refill each month. */
const ROSSI_STOCK: Record<string, number> = {
  'VT-M6-20': 6000,
  'VT-M8-30': 4000,
  'DD-M6': 6000,
  'RN-M6': 6000,
  'TS-8': 80,
  'CH-BRU': 20,
  'TR-18V': 12,
  'SM-125': 8,
  'CV-3G15': 800,
  'CM-PORT': 2500,
  'VR-BIA': 80,
  'GU-NIT': 40,
  'MAN-INST': 15,
};
/** Who sells Rossi Srl what. */
const ROSSI_SUPPLIERS: Record<string, readonly string[]> = {
  viteria: ['VT-M6-20', 'VT-M8-30', 'DD-M6', 'RN-M6', 'TS-8', 'CH-BRU', 'TR-18V', 'SM-125'],
  edilnord: ['CM-PORT', 'VR-BIA', 'CV-3G15', 'GU-NIT', 'MAN-INST'],
};
/** Purchase prices: about 60% of the sale price. */
const cost = (salePrice: string) => new Prisma.Decimal(salePrice).times('0.6').toFixed(4);

// ---- The writer ---------------------------------------------------------------------------------

/** Writes the story of one company. */
export async function writeHistory(input: HistoryInput): Promise<HistoryResult> {
  const writer = new HistoryWriter(input);
  await writer.write();
  return writer.result;
}

interface Issued {
  id: string;
  partyId: string;
  date: string;
  lines: { id: string; itemId: string | null }[];
}

class HistoryWriter {
  readonly result: HistoryResult = { documents: 0, orders: 0, invoices: 0, features: new Set() };
  private readonly timeline: Timeline;
  private readonly random: () => number;
  private readonly stock = new StockPlan();
  private readonly start: string;
  /** Issued invoices of each customer, for those who pay in batches. */
  private readonly invoicesOf = new Map<string, Issued[]>();

  constructor(private readonly input: HistoryInput) {
    this.timeline = new Timeline(input.today);
    this.random = seededRandom(
      { 'rossi-srl': 2026, 'rossi-logistica': 1987, bianchi: 1999 }[input.story],
    );
    this.start = storyStart(input.today);
  }

  async write(): Promise<void> {
    if (this.input.story === 'rossi-srl') this.planRossiSrl();
    else if (this.input.story === 'rossi-logistica') this.planRossiLogistica();
    else this.planBianchi();
    await this.timeline.play();
  }

  // ---- Helpers on the services ----------------------------------------------------------------

  private show(feature: Feature) {
    this.result.features.add(feature);
  }

  private int(min: number, max: number, step = 1): number {
    const steps = Math.floor((max - min) / step);
    return min + Math.floor(this.random() * (steps + 1)) * step;
  }

  private chance(p: number): boolean {
    return this.random() < p;
  }

  private item(code: string): HistoryItem {
    const item = this.input.items.get(code);
    if (!item) throw new Error(`demo item ${code} missing`);
    return item;
  }

  private party(key: string): string {
    const id = this.input.parties.get(key);
    if (!id) throw new Error(`demo party ${key} missing`);
    return id;
  }

  private warehouse(code: string): string {
    const id = this.input.warehouses.get(code);
    if (!id) throw new Error(`demo warehouse ${code} missing`);
    return id;
  }

  private days(): string[] {
    const days: string[] = [];
    for (let day = this.start; day <= this.input.today; day = addDays(day, 1)) days.push(day);
    return days;
  }

  /** A stock document on `date`; with `undoOn`, reversed that day. */
  private document(
    date: string,
    reason: CreateStockDocumentDto['reason'],
    warehouse: string,
    lines: [code: string, quantity: number][],
    extra: { target?: string; party?: string; ref?: string; notes?: string; undoOn?: string } = {},
  ): void {
    const { db, services, company } = this.input;
    this.timeline.add(date, AT.stock, async () => {
      const counted = reason === 'INVENTORY_ADJUSTMENT';
      const posted = await services.warehouse.postDocument(
        db,
        company,
        {
          id: uuidv7(Date.parse(`${date}T09:00:00Z`)),
          reason,
          documentDate: date,
          warehouseId: this.warehouse(warehouse),
          targetWarehouseId: extra.target ? this.warehouse(extra.target) : null,
          partyId: extra.party ? this.party(extra.party) : null,
          partyDocumentRef: extra.ref ?? null,
          partyDocumentDate: extra.ref ? date : null,
          notes: extra.notes ?? null,
          lines: lines.map(([code, quantity]) => ({
            itemId: this.item(code).id,
            ...(counted ? { countedQuantity: String(quantity) } : { quantity: String(quantity) }),
          })),
        },
        { today: date },
      );
      this.result.documents++;
      if (extra.undoOn) {
        const undoOn = extra.undoOn;
        this.timeline.add(undoOn, AT.undo, async () => {
          await services.warehouse.reverseDocument(db, company, posted.id, { today: undoOn });
          this.result.documents++;
          this.show('stock.reversal');
        });
      }
    });
  }

  /**
   * An order created and confirmed on `date` (or left a draft), then received or shipped as
   * `deliveries` say. Returns nothing: what happens next is scheduled.
   */
  private order(spec: {
    kind: 'PURCHASE' | 'SALES';
    date: string;
    party: string;
    warehouse: string;
    lines: { code: string; quantity: number; price: string; discount?: string; vat?: string }[];
    requested?: string;
    ref?: string;
    notes?: string;
    draft?: boolean;
    cancelOn?: string;
    /** Receipts or shipments: date and quantity of each line (by position). */
    deliveries?: { date: string; quantities: number[]; ref?: string; undoOn?: string }[];
    reserveOn?: string;
    closeOn?: string;
    transport?: boolean;
    onShipped?: (fulfilmentId: string, date: string) => void;
  }): void {
    const { db, services, company } = this.input;
    this.timeline.add(spec.date, spec.kind === 'PURCHASE' ? AT.receive : AT.sale, async () => {
      const id = uuidv7(Date.parse(`${spec.date}T08:00:00Z`));
      let order = await services.orders.createDraft(
        db,
        company,
        {
          id,
          kind: spec.kind,
          orderDate: spec.date,
          partyId: this.party(spec.party),
          warehouseId: this.warehouse(spec.warehouse),
          partyReference: spec.ref ?? null,
          requestedDate: spec.requested ?? null,
          notes: spec.notes ?? null,
          lines: spec.lines.map((line) => ({
            itemId: this.item(line.code).id,
            quantity: String(line.quantity),
            unitPrice: line.price,
            ...(line.discount ? { discountPercent: line.discount } : {}),
            ...(line.vat ? { vatCode: line.vat } : {}),
          })),
        },
        spec.date,
      );
      this.result.orders++;
      if (spec.draft) return;
      order = await services.orders.confirm(db, company, id, order.version, spec.date);
      const lineIds = order.lines.map((line) => line.id);
      if (spec.cancelOn) {
        this.timeline.add(spec.cancelOn, AT.undo, async () => {
          const current = await services.orders.cancel(db, company, id, order.version);
          order = current;
          this.show('orders.purchaseCancelled');
        });
      }
      if (spec.reserveOn) {
        this.timeline.add(spec.reserveOn, AT.reserve, async () => {
          order = await services.orders.reserve(db, company, id);
          this.show('orders.reserveAvailable');
        });
      }
      for (const delivery of (spec.deliveries ?? []).filter((d) =>
        d.quantities.some((q) => q > 0),
      )) {
        const fulfilmentId = uuidv7(Date.parse(`${delivery.date}T10:00:00Z`));
        const at = spec.kind === 'PURCHASE' ? AT.receive : AT.ship;
        this.timeline.add(delivery.date, at, async () => {
          const lines = delivery.quantities
            .map((quantity, i) => ({ orderLineId: lineIds[i]!, quantity: String(quantity) }))
            .filter((line) => line.quantity !== '0');
          order = await services.orders.fulfil(
            db,
            company,
            id,
            {
              id: fulfilmentId,
              documentDate: delivery.date,
              partyDocumentRef: delivery.ref ?? null,
              ...(spec.transport
                ? {
                    transport: {
                      reason: 'Vendita',
                      by: 'CARRIER' as const,
                      carrier: 'Trasporti Brembo Srl',
                      packages: this.int(1, 6),
                      appearance: 'Bancali',
                      weightKg: String(this.int(200, 900, 50)),
                    },
                  }
                : {}),
              lines,
            },
            delivery.date,
          );
          this.result.documents++;
          if (spec.transport) this.show('orders.transport');
          if (delivery.undoOn) {
            const undoOn = delivery.undoOn;
            this.timeline.add(undoOn, AT.undo, async () => {
              order = await services.orders.reverseFulfilment(
                db,
                company,
                id,
                fulfilmentId,
                undoOn,
              );
              this.result.documents++;
              this.show('orders.shipmentUndone');
            });
          } else {
            spec.onShipped?.(fulfilmentId, delivery.date);
          }
        });
      }
      if (spec.closeOn) {
        this.timeline.add(spec.closeOn, AT.undo, async () => {
          order = await services.orders.close(db, company, id, order.version);
          this.show('orders.restClosed');
        });
      }
    });
  }

  /** A draft invoice issued on `date`: by hand, or of shipments. Then its payments. */
  private invoice(spec: {
    date: string;
    party: string;
    terms: string;
    method: string;
    pays: Pays;
    lines?: { code: string; quantity: number; vat?: string; price?: string }[];
    fulfilmentIds?: string[];
    stampDuty?: boolean;
    notes?: string;
    draft?: boolean;
    onIssued?: (issued: Issued) => void;
  }): void {
    const { db, services, company } = this.input;
    this.timeline.add(spec.date, AT.invoice, async () => {
      const id = uuidv7(Date.parse(`${spec.date}T11:00:00Z`));
      const partyId = this.party(spec.party);
      const draft = await services.invoicing.createDraft(
        db,
        company,
        {
          id,
          partyId,
          fulfilmentIds: spec.fulfilmentIds ?? [],
          paymentTerms: spec.terms,
          paymentMethod: spec.method,
          notes: spec.notes ?? null,
          lines: [
            ...(spec.lines ?? []).map((line) => ({
              itemId: this.item(line.code).id,
              quantity: String(line.quantity),
              unitPrice: line.price ?? this.item(line.code).salePrice,
              ...(line.vat ? { vatCode: line.vat } : {}),
            })),
            ...(spec.stampDuty ? [{ stampDutyCharge: true }] : []),
          ],
        },
        spec.date,
      );
      if (spec.draft) {
        this.show('invoicing.draft');
        return;
      }
      const invoice = await services.invoicing.issue(db, company, id, draft.version, spec.date);
      this.result.invoices++;
      if (Number(invoice.stampDuty) > 0) this.show('invoicing.stampDuty');
      if (invoice.dueDates.length > 1) this.show('invoicing.instalments');
      const issued: Issued = { id, partyId, date: spec.date, lines: invoice.lines };
      this.invoicesOf.set(spec.party, [...(this.invoicesOf.get(spec.party) ?? []), issued]);
      this.schedulePayments(spec.party, spec.method, spec.pays, issued, invoice.dueDates);
      spec.onIssued?.(issued);
    });
  }

  private pay(
    date: string,
    party: string,
    method: string,
    allocations: { dueDateId: string; amount: string }[],
    kind: 'RECEIPT' | 'REFUND' = 'RECEIPT',
  ): Promise<{ id: string }> {
    const { db, services, company } = this.input;
    const amount = allocations
      .reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0))
      .toFixed(2);
    return services.invoicing.recordPayment(
      db,
      company,
      {
        id: uuidv7(Date.parse(`${date}T12:00:00Z`)),
        kind,
        partyId: this.party(party),
        paymentDate: date,
        amount,
        method,
        allocations,
      },
      date,
    );
  }

  /** What is still open on the due dates of an invoice, fresh (credit notes reduce them). */
  private open(invoiceId: string) {
    const { db, services, company } = this.input;
    return services.invoicing.openDueDates(db, company.companyId, invoiceId);
  }

  private schedulePayments(
    party: string,
    method: string,
    pays: Pays,
    issued: Issued,
    dueDates: { id: string; dueDate: string }[],
  ): void {
    if (pays.kind === 'batch') return; // paid by the monthly batch
    // Every third invoice of the customer is paid in two halves (counted per customer).
    const nth = this.invoicesOf.get(party)?.length ?? 0;
    for (const due of dueDates) {
      if (pays.kind === 'slow' && due.dueDate > addDays(this.input.today, -pays.recent)) continue;
      const delay =
        pays.kind === 'onTime'
          ? this.int(0, pays.late)
          : pays.kind === 'late'
            ? this.int(pays.min, pays.max)
            : pays.late;
      const date =
        addDays(due.dueDate, delay) < issued.date ? issued.date : addDays(due.dueDate, delay);
      const inHalves = pays.kind === 'late' && nth % 3 === 1;
      this.timeline.add(date, AT.pay, async () => {
        const open = (await this.open(issued.id)).find((d) => d.id === due.id);
        if (!open || open.open === '0.00') return;
        if (inHalves) {
          await this.pay(date, party, method, [{ dueDateId: due.id, amount: half(open.open) }]);
          this.show('invoicing.paymentPartial');
          const rest = addDays(date, 20);
          this.timeline.add(rest, AT.pay, async () => {
            const left = (await this.open(issued.id)).find((d) => d.id === due.id);
            if (left && left.open !== '0.00') {
              await this.pay(rest, party, method, [{ dueDateId: due.id, amount: left.open }]);
            }
          });
          return;
        }
        await this.pay(date, party, method, [{ dueDateId: due.id, amount: open.open }]);
      });
    }
  }

  /** Once a month, every due date of the customer older than `lag` days, in one payment. */
  private batchPayments(party: string, method: string, pays: Extract<Pays, { kind: 'batch' }>) {
    for (const day of this.days()) {
      if (Number(day.slice(8, 10)) !== pays.day) continue;
      this.timeline.add(day, AT.pay, async () => {
        const allocations: { dueDateId: string; amount: string }[] = [];
        for (const issued of this.invoicesOf.get(party) ?? []) {
          for (const due of await this.open(issued.id)) {
            if (due.open !== '0.00' && due.dueDate <= addDays(day, -pays.lag)) {
              allocations.push({ dueDateId: due.id, amount: due.open });
            }
          }
        }
        if (allocations.length === 0) return;
        await this.pay(day, party, method, allocations);
        if (allocations.length > 1) this.show('invoicing.paymentSeveralDueDates');
      });
    }
  }

  /**
   * A credit note of some lines (`quantity` of each) or of all of an invoice. Lines are counted
   * among the goods and services, in the order of their codes.
   */
  private credit(
    date: string,
    issued: Issued,
    spec: { lines?: number[]; quantity?: string; onCredited?: (noteId: string) => void } = {},
  ): void {
    const { db, services, company } = this.input;
    this.timeline.add(date, AT.credit, async () => {
      const id = uuidv7(Date.parse(`${date}T11:30:00Z`));
      // Lines of goods by item code: ids are random, codes are not, so the choice is stable.
      const codeOf = new Map([...this.input.items].map(([code, item]) => [item.id, code]));
      const goods = issued.lines
        .filter((l) => l.itemId)
        .sort((a, b) => codeOf.get(a.itemId!)!.localeCompare(codeOf.get(b.itemId!)!));
      const lineIds = spec.lines?.map((i) => goods[i]!.id);
      let draft = await services.invoicing.creditNote(
        db,
        company,
        issued.id,
        { id, ...(lineIds ? { lineIds } : {}) },
        date,
      );
      if (spec.quantity) {
        draft = await services.invoicing.updateDraft(
          db,
          company,
          id,
          {
            version: draft.version,
            partyId: draft.partyId,
            paymentTerms: draft.paymentTerms,
            paymentMethod: draft.paymentMethod,
            language: draft.language,
            lines: draft.lines.map((line) => ({
              description: line.description,
              ...(line.creditedLineId
                ? { creditedLineId: line.creditedLineId, quantity: spec.quantity }
                : {}),
            })),
          },
          date,
        );
      }
      await services.invoicing.issue(db, company, id, draft.version, date);
      this.result.invoices++;
      this.show(spec.lines ? 'invoicing.creditPartial' : 'invoicing.creditTotal');
      spec.onCredited?.(id);
    });
  }

  // ---- Sales and purchases of a warehouse, day by day ------------------------------------------

  /**
   * Plans the sales of a warehouse: on working days, an order now and then from the customers
   * given, as much as the stock allows, shipped a few days later (sometimes in two parts) and
   * invoiced at once or at the end of the month.
   */
  private planSales(
    day: string,
    warehouse: string,
    customers: Record<string, Customer>,
    weights: Record<string, number>,
    perDay: number,
    shipments: Map<string, { party: string; fulfilmentId: string; date: string }[]>,
  ): void {
    if (!isWorkday(day) || !this.chance(perDay)) return;
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let roll = this.random() * total;
    const key = Object.keys(weights).find((k) => (roll -= weights[k]!) < 0) ?? 'bruni';
    const customer = customers[key]!;
    const count = this.int(1, Math.min(3, customer.buys.length));
    const chosen = [...customer.buys].sort(() => this.random() - 0.5).slice(0, count);
    const lines: { code: string; quantity: number; price: string; discount?: string }[] = [];
    for (const [code, min, max, step] of chosen) {
      // Keep a margin: the special cases and the free issues need goods too.
      const room = this.stock.available(warehouse, code) - Math.max(step, 2);
      const quantity = Math.min(this.int(min, max, step), Math.floor(room / step) * step);
      if (quantity < min) continue;
      lines.push({
        code,
        quantity,
        price: this.item(code).salePrice,
        ...(customer.discount ? { discount: customer.discount } : {}),
      });
      this.stock.move(warehouse, code, 0, quantity);
    }
    if (lines.length === 0) return;
    const first = workday(addDays(day, this.int(1, 3)));
    const inParts = lines.some((l) => l.quantity > 1) && this.chance(0.2);
    const deliveries = inParts
      ? [
          { date: first, quantities: lines.map((l) => Math.ceil(l.quantity / 2)) },
          {
            date: workday(addDays(first, 3)),
            quantities: lines.map((l) => l.quantity - Math.ceil(l.quantity / 2)),
          },
        ]
      : [{ date: first, quantities: lines.map((l) => l.quantity) }];
    for (const delivery of deliveries) {
      delivery.quantities.forEach((quantity, i) => {
        this.stock.on(delivery.date, () =>
          this.stock.move(warehouse, lines[i]!.code, -quantity, -quantity),
        );
      });
    }
    let shippedParts = 0;
    this.order({
      kind: 'SALES',
      date: day,
      party: key,
      warehouse,
      lines,
      requested: addDays(day, 7),
      deliveries,
      transport: customer.transport,
      onShipped: (fulfilmentId, date) => {
        if (inParts && ++shippedParts === 2) this.show('orders.salesShippedInParts');
        if (key === 'ferri') this.show('invoicing.privateCustomer');
        if (customer.invoiced === 'immediate') {
          this.invoice({
            date,
            party: key,
            terms: customer.terms,
            method: customer.method,
            pays: customer.pays,
            fulfilmentIds: [fulfilmentId],
          });
          this.show('invoicing.immediate');
        } else {
          const month = date.slice(0, 7);
          shipments.set(month, [
            ...(shipments.get(month) ?? []),
            { party: key, fulfilmentId, date },
          ]);
        }
      },
    });
  }

  /**
   * Month-end deferred invoices: on the last day of each month, one invoice per customer for its
   * shipments of the month. The month still open stays to invoice.
   */
  private planDeferred(
    customers: Record<string, Customer>,
    shipments: Map<string, { party: string; fulfilmentId: string }[]>,
  ): void {
    for (const day of this.days()) {
      if (day !== lastOfMonth(day)) continue;
      const month = day.slice(0, 7);
      this.timeline.add(day, AT.invoice - 0.5, async () => {
        const ofMonth = shipments.get(month) ?? [];
        for (const key of new Set(ofMonth.map((s) => s.party))) {
          const customer = customers[key]!;
          this.invoice({
            date: day,
            party: key,
            terms: customer.terms,
            method: customer.method,
            pays: customer.pays,
            fulfilmentIds: ofMonth.filter((s) => s.party === key).map((s) => s.fulfilmentId),
          });
          this.show('invoicing.deferred');
        }
      });
    }
    // The shipments after the last month-end are there to invoice.
    const current = this.input.today.slice(0, 7);
    this.timeline.add(this.input.today, AT.undo, async () => {
      const lastDay = this.input.today === lastOfMonth(this.input.today);
      if (!lastDay && (shipments.get(current)?.length ?? 0) > 0)
        this.show('invoicing.toInvoiceLeft');
    });
  }

  /**
   * Monthly purchase orders that bring the stock back to its opening level: received in one or
   * two deliveries a few working days later.
   */
  private planPurchases(
    day: string,
    warehouse: string,
    supplier: string,
    codes: readonly string[],
    target: Record<string, number>,
    orderDay: number,
    incoming: Map<string, number>,
  ): void {
    if (Number(day.slice(8, 10)) !== orderDay) return;
    const lines = codes
      .map((code) => ({
        code,
        quantity: target[code]! - this.stock.available(warehouse, code) - (incoming.get(code) ?? 0),
      }))
      .filter((line) => line.quantity > 0)
      .map((line) => ({ ...line, price: cost(this.item(line.code).salePrice) }));
    if (lines.length === 0) return;
    const date = workday(day);
    const first = workday(addDays(date, this.int(3, 5)));
    const inParts = this.chance(0.35);
    const firstShare = (q: number) => (inParts ? Math.ceil(q * 0.6) : q);
    const deliveries = [
      {
        date: first,
        quantities: lines.map((l) => firstShare(l.quantity)),
        ref: `DDT ${supplier.toUpperCase()}-${date.slice(2, 4)}${date.slice(5, 7)}A`,
      },
      ...(inParts
        ? [
            {
              date: workday(addDays(first, this.int(4, 8))),
              quantities: lines.map((l) => l.quantity - firstShare(l.quantity)),
              ref: `DDT ${supplier.toUpperCase()}-${date.slice(2, 4)}${date.slice(5, 7)}B`,
            },
          ]
        : []),
    ];
    for (const line of lines)
      incoming.set(line.code, (incoming.get(line.code) ?? 0) + line.quantity);
    let received = 0;
    for (const delivery of deliveries) {
      delivery.quantities.forEach((quantity, i) => {
        const code = lines[i]!.code;
        this.stock.on(delivery.date, () => {
          this.stock.move(warehouse, code, quantity);
          incoming.set(code, (incoming.get(code) ?? 0) - quantity);
        });
      });
      if (delivery.date > this.input.today) this.show('orders.purchaseIncoming');
    }
    this.order({
      kind: 'PURCHASE',
      date,
      party: supplier,
      warehouse,
      lines,
      requested: addDays(date, 7),
      ref: `Conferma ${date.slice(5, 7)}/${date.slice(0, 4)}`,
      deliveries,
      onShipped: () => {
        received++;
        this.show('stock.purchaseReceipt');
        if (inParts && received === 2) this.show('orders.purchaseReceivedInParts');
      },
    });
  }

  // ---- The stories --------------------------------------------------------------------------------

  /**
   * Rossi Srl: a hardware and building materials wholesaler. Two warehouses, monthly purchases
   * from two suppliers, sales most working days, deferred invoices at the end of the month,
   * immediate ones for a private customer, services invoiced by hand, every special case once.
   * Special cases are planned on their own day, against the stock of that day.
   */
  private planRossiSrl(): void {
    const today = this.input.today;
    const incoming = new Map<string, number>();
    const shipments = new Map<string, { party: string; fulfilmentId: string; date: string }[]>();
    const firsts = this.days().filter((d) => d.endsWith('-01'));
    const month = (n: number) => firsts[Math.min(n, firsts.length - 1)]!;
    const deferred = (party: string) => (fulfilmentId: string, date: string) => {
      const m = date.slice(0, 7);
      shipments.set(m, [...(shipments.get(m) ?? []), { party, fulfilmentId, date }]);
    };
    const specials = new Map<string, (() => void)[]>();
    const on = (date: string, plan: () => void) => {
      if (date <= today) specials.set(date, [...(specials.get(date) ?? []), plan]);
    };

    // A purchase receipt recorded with the wrong supplier, reversed the next day.
    const wrong = workday(addDays(month(2), 9));
    on(wrong, () => {
      this.document(wrong, 'PURCHASE_RECEIPT', 'SEDE', [['CM-PORT', 300]], {
        party: 'edilnord',
        ref: 'EN 4471',
        undoOn: workday(addDays(wrong, 1)),
      });
      // Taken back before anything else: never counted as available.
    });
    // A grinder fallen off the pallet, every four months.
    for (const n of [3, 7, 11]) {
      const date = workday(addDays(month(n), 12));
      on(date, () => {
        if (this.stock.available('SEDE', 'SM-125') < 1) return;
        this.document(date, 'LOSS', 'SEDE', [['SM-125', 1]], { notes: 'Caduta dal bancale' });
        this.stock.move('SEDE', 'SM-125', -1);
        this.show('stock.loss');
      });
    }
    // A customer brings back a drill.
    const returned = workday(addDays(month(3), 3));
    on(returned, () => {
      this.document(returned, 'CUSTOMER_RETURN', 'SEDE', [['TR-18V', 1]], { party: 'ferri' });
      this.stock.move('SEDE', 'TR-18V', 1);
      this.show('stock.customerReturn');
    });
    // More drills than there are: what is free is reserved, the rest when an urgent purchase
    // arrives ("Prenota disponibile"), then all shipped.
    const short = workday(addDays(month(4), 14));
    on(short, () => {
      const free = this.stock.available('SEDE', 'TR-18V');
      const drills = free + 3;
      const arrives = workday(addDays(short, 3));
      const ships = workday(addDays(arrives, 1));
      this.stock.move('SEDE', 'TR-18V', 0, free);
      this.stock.on(arrives, () => this.stock.move('SEDE', 'TR-18V', 5, 3));
      this.stock.on(ships, () => this.stock.move('SEDE', 'TR-18V', -drills, -drills));
      this.order({
        kind: 'PURCHASE',
        date: short,
        party: 'viteria',
        warehouse: 'SEDE',
        lines: [{ code: 'TR-18V', quantity: 5, price: cost(this.item('TR-18V').salePrice) }],
        deliveries: [{ date: arrives, quantities: [5], ref: 'VL urgente' }],
        ref: 'Urgente',
      });
      this.order({
        kind: 'SALES',
        date: short,
        party: 'edilnord',
        warehouse: 'SEDE',
        lines: [{ code: 'TR-18V', quantity: drills, price: this.item('TR-18V').salePrice }],
        reserveOn: arrives,
        deliveries: [{ date: ships, quantities: [drills] }],
        notes: 'Prenotato il disponibile, il resto all’arrivo dal fornitore.',
        onShipped: deferred('edilnord'),
      });
    });
    // A purchase order cancelled the next day: price not confirmed.
    const cancelled = workday(addDays(month(5), 5));
    on(cancelled, () =>
      this.order({
        kind: 'PURCHASE',
        date: cancelled,
        party: 'edilnord',
        warehouse: 'SEDE',
        lines: [{ code: 'VR-BIA', quantity: 50, price: '4.50' }],
        cancelOn: workday(addDays(cancelled, 1)),
        notes: 'Annullato: prezzo non confermato dal fornitore.',
      }),
    );
    // A private customer's invoice, paid at once: a credit note of part of it, the excess
    // refunded three days later.
    const refund = workday(addDays(month(5), 11));
    on(refund, () =>
      this.invoice({
        date: refund,
        party: 'ferri',
        terms: 'RD',
        method: 'MP08',
        pays: { kind: 'onTime', late: 0 },
        lines: [{ code: 'MDO-ORA', quantity: 2 }],
        notes: 'Montaggio a domicilio.',
        onIssued: (issued) => {
          this.show('invoicing.byHand');
          const credited = workday(addDays(refund, 6));
          this.credit(credited, issued, {
            lines: [0],
            quantity: '1',
            onCredited: (noteId) => {
              const back = workday(addDays(credited, 3));
              this.timeline.add(back, AT.pay, async () => {
                const [excess] = await this.open(noteId);
                if (!excess || excess.open === '0.00') return;
                await this.pay(
                  back,
                  'ferri',
                  'MP05',
                  [{ dueDateId: excess.id, amount: excess.open }],
                  'REFUND',
                );
                this.show('invoicing.refund');
              });
            },
          });
        },
      }),
    );
    // A shipment undone (wrong colour) and shipped again: the goods come back reserved.
    const undone = workday(addDays(month(7), 8));
    on(undone, () => {
      if (this.stock.available('SEDE', 'VR-BIA') < 4) return;
      // One working day after the other: on the same day a shipment would come before its undo.
      const first = workday(addDays(undone, 1));
      const back = workday(addDays(first, 1));
      const again = workday(addDays(back, 1));
      this.stock.move('SEDE', 'VR-BIA', 0, 4);
      this.stock.on(first, () => this.stock.move('SEDE', 'VR-BIA', -4, -4));
      this.stock.on(back, () => this.stock.move('SEDE', 'VR-BIA', 4, 4));
      this.stock.on(again, () => this.stock.move('SEDE', 'VR-BIA', -4, -4));
      this.order({
        kind: 'SALES',
        date: undone,
        party: 'bruni',
        warehouse: 'SEDE',
        lines: [{ code: 'VR-BIA', quantity: 4, price: this.item('VR-BIA').salePrice }],
        deliveries: [
          { date: first, quantities: [4], undoOn: back },
          { date: again, quantities: [4] },
        ],
        notes: 'Prima spedizione annullata: colore sbagliato.',
        onShipped: deferred('bruni'),
      });
    });
    // The customer does not want the rest: 600 washers of 1000, the rest closed.
    const closed = workday(addDays(month(8), 6));
    on(closed, () => {
      if (this.stock.available('SEDE', 'RN-M6') < 1200) return;
      const ships = workday(addDays(closed, 1));
      const closes = workday(addDays(ships, 1));
      this.stock.move('SEDE', 'RN-M6', 0, 1000);
      this.stock.on(ships, () => this.stock.move('SEDE', 'RN-M6', -600, -600));
      this.stock.on(closes, () => this.stock.move('SEDE', 'RN-M6', 0, -400));
      this.order({
        kind: 'SALES',
        date: closed,
        party: 'bruni',
        warehouse: 'SEDE',
        lines: [{ code: 'RN-M6', quantity: 1000, price: this.item('RN-M6').salePrice }],
        deliveries: [{ date: ships, quantities: [600] }],
        closeOn: closes,
        notes: 'Il cliente non vuole il resto.',
        onShipped: deferred('bruni'),
      });
    });
    // Near today: a German order for more grinders than there are, already late.
    const late = workday(addDays(today, -9));
    on(late, () => {
      const free = Math.max(this.stock.available('SEDE', 'SM-125'), 0);
      this.stock.move('SEDE', 'SM-125', 0, free);
      this.order({
        kind: 'SALES',
        date: late,
        party: 'muller',
        warehouse: 'SEDE',
        lines: [
          {
            code: 'SM-125',
            quantity: free + 4,
            price: this.item('SM-125').salePrice,
            vat: 'N3.2',
          },
        ],
        requested: addDays(late, 5),
        ref: 'PO 77812',
        notes: 'Spedire tutto insieme quando arrivano le smerigliatrici.',
      });
      if (addDays(late, 5) < today) this.show('orders.salesUncoveredAndLate');
    });

    // Opening stock.
    this.document(this.start, 'OPENING', 'SEDE', Object.entries(ROSSI_STOCK));
    for (const [code, quantity] of Object.entries(ROSSI_STOCK)) {
      this.stock.move('SEDE', code, quantity);
    }
    this.document(this.start, 'OPENING', 'DEP', [
      ['CM-PORT', 300],
      ['VR-BIA', 20],
    ]);
    this.show('stock.opening');

    for (const day of this.days()) {
      this.stock.arrive(day);
      for (const plan of specials.get(day) ?? []) plan();
      this.planPurchases(
        day,
        'SEDE',
        'viteria',
        ROSSI_SUPPLIERS.viteria!,
        ROSSI_STOCK,
        2,
        incoming,
      );
      this.planPurchases(
        day,
        'SEDE',
        'edilnord',
        ROSSI_SUPPLIERS.edilnord!,
        ROSSI_STOCK,
        4,
        incoming,
      );
      this.planSales(
        day,
        'SEDE',
        ROSSI_CUSTOMERS,
        { bruni: 4, edilnord: 3, marino: 1, ferri: 2.5 },
        0.75,
        shipments,
      );
      this.planShelf(day);
    }
    this.planDeferred(ROSSI_CUSTOMERS, shipments);
    this.batchPayments('marino', 'MP05', { kind: 'batch', day: 10, lag: 15 });
    this.planServices(firsts);

    // A deferred invoice with a wrong price: credited for one piece of its first line.
    for (const n of [3, 9]) {
      this.timeline.add(lastOfMonth(month(n)), AT.credit, async () => {
        const last = (this.invoicesOf.get('bruni') ?? []).at(-1);
        if (last) this.credit(workday(addDays(last.date, 4)), last, { lines: [0], quantity: '1' });
      });
    }
    // A bank receipt (RIBA) of Edilnord that bounced: reversed, then paid again by transfer.
    const bounce = workday(addDays(month(6), 2));
    this.timeline.add(bounce, AT.undo, async () => {
      const { db, services, company } = this.input;
      for (const invoice of [...(this.invoicesOf.get('edilnord') ?? [])].reverse()) {
        const [first] = await this.open(invoice.id);
        if (!first || first.open !== '0.00') continue;
        const paid = await db.payment.findFirst({
          where: {
            companyId: company.companyId,
            reversesId: null,
            reversedBy: null,
            allocations: { some: { dueDateId: first.id } },
          },
          orderBy: { paymentDate: 'desc' },
        });
        if (!paid) continue;
        await services.invoicing.reversePayment(db, company, paid.id, bounce);
        this.show('invoicing.paymentReversed');
        const again = workday(addDays(bounce, 20));
        this.timeline.add(again, AT.pay, async () => {
          const [left] = await this.open(invoice.id);
          if (left && left.open !== '0.00') {
            await this.pay(again, 'edilnord', 'MP05', [{ dueDateId: left.id, amount: left.open }]);
          }
        });
        return;
      }
    });

    // Drafts left for tomorrow.
    this.order({
      kind: 'PURCHASE',
      date: addDays(today, -1),
      party: 'viteria',
      warehouse: 'SEDE',
      lines: [{ code: 'GU-NIT', quantity: 50, price: '3.20' }],
      draft: true,
    });
    this.show('orders.purchaseDraft');
    this.order({
      kind: 'SALES',
      date: today,
      party: 'bruni',
      warehouse: 'SEDE',
      lines: [
        { code: 'GU-NIT', quantity: 10, price: this.item('GU-NIT').salePrice },
        { code: 'MAN-INST', quantity: 2, price: this.item('MAN-INST').salePrice },
      ],
      draft: true,
    });
    this.show('orders.salesDraft');
    this.invoice({
      date: today,
      party: 'muller',
      terms: '30DF',
      method: 'MP05',
      pays: { kind: 'onTime', late: 0 },
      lines: [{ code: 'MDO-ORA', quantity: 8, vat: 'N2.1' }],
      draft: true,
    });
  }

  /** Goods sold over the counter, used in the workshop, moved to the depot, counted. */
  private planShelf(day: string): void {
    const dom = Number(day.slice(8, 10));
    if (dom === 15 && isWorkday(day) && this.stock.available('SEDE', 'TS-8') > 10) {
      const quantity = this.int(1, 3);
      this.document(day, 'SALE_ISSUE', 'SEDE', [['TS-8', quantity]], {
        party: 'bruni',
        notes: 'Vendita al banco',
      });
      this.stock.move('SEDE', 'TS-8', -quantity);
      this.show('stock.saleIssue');
    }
    if (dom === 27 && isWorkday(day) && this.stock.available('SEDE', 'GU-NIT') > 6) {
      this.document(day, 'INTERNAL_USE', 'SEDE', [['GU-NIT', 2]], { notes: 'Uso in officina' });
      this.stock.move('SEDE', 'GU-NIT', -2);
      this.show('stock.internalUse');
    }
    if (dom === 20 && isWorkday(day) && this.stock.available('SEDE', 'CM-PORT') > 400) {
      this.document(day, 'TRANSFER', 'SEDE', [['CM-PORT', 100]], { target: 'DEP' });
      this.stock.move('SEDE', 'CM-PORT', -100);
      this.show('stock.transfer');
    }
    // A count every three months, on the first Saturday: one box of plugs fewer than expected.
    if (weekday(day) === 6 && dom <= 7 && Number(day.slice(5, 7)) % 3 === 1) {
      if (this.stock.available('SEDE', 'TS-8') > 1) {
        const counted = this.stock.physicalOf('SEDE', 'TS-8') - 1;
        this.document(day, 'INVENTORY_ADJUSTMENT', 'SEDE', [['TS-8', counted]]);
        this.stock.move('SEDE', 'TS-8', -1);
        this.show('stock.inventoryCount');
      }
    }
  }

  /** Services invoiced by hand, every month. */
  private planServices(firsts: string[]): void {
    const mistaken = firsts[Math.min(6, firsts.length - 1)]!.slice(0, 7);
    for (const day of this.days()) {
      const dom = Number(day.slice(8, 10));
      if (dom === 10) {
        // A course on safety, exempt (N4): over 77.47 €, it carries the stamp duty.
        this.invoice({
          date: workday(day),
          party: 'lario',
          terms: '60DF',
          method: 'MP05',
          pays: { kind: 'slow', recent: 150, late: 40 },
          lines: [{ code: 'CORSO-SIC', quantity: this.int(4, 8) }],
          stampDuty: true,
          onIssued: (issued) => {
            this.show('invoicing.byHand');
            // One was issued by mistake: credited in full two days later.
            if (day.slice(0, 7) === mistaken) this.credit(workday(addDays(issued.date, 2)), issued);
          },
        });
      }
      if (dom === 18) {
        // Services to a German company: outside the scope of Italian VAT (art. 7-ter).
        this.invoice({
          date: workday(day),
          party: 'muller',
          terms: '30DF',
          method: 'MP05',
          pays: { kind: 'onTime', late: 2 },
          lines: [{ code: 'MDO-ORA', quantity: this.int(4, 12), vat: 'N2.1' }],
          stampDuty: true,
          notes: 'Operazione non soggetta, art. 7-ter DPR 633/72.',
          onIssued: () => this.show('invoicing.foreignCustomer'),
        });
      }
      if (dom === 24 && Number(day.slice(5, 7)) % 2 === 0) {
        this.invoice({
          date: workday(day),
          party: 'marino',
          terms: 'RD',
          method: 'MP05',
          pays: { kind: 'batch', day: 10, lag: 15 },
          lines: [{ code: 'MDO-ORA', quantity: this.int(2, 6) }],
        });
      }
    }
  }

  /** Rossi Logistica: one hub, cement and cable for builders, deferred invoices, paid on time. */
  private planRossiLogistica(): void {
    const customers: Record<string, Customer> = {
      edilnord: {
        terms: '30DF',
        method: 'MP05',
        pays: { kind: 'onTime', late: 5 },
        invoiced: 'deferred',
        transport: true,
        buys: [
          ['CM-PORT', 300, 1200, 100],
          ['CV-3G15', 100, 400, 50],
        ],
      },
      bruni: {
        terms: '30FM',
        method: 'MP05',
        pays: { kind: 'onTime', late: 2 },
        invoiced: 'deferred',
        buys: [['CV-3G15', 50, 200, 50]],
      },
    };
    const target = { 'CM-PORT': 6000, 'CV-3G15': 2500, 'GU-NIT': 100 };
    const incoming = new Map<string, number>();
    const shipments = new Map<string, { party: string; fulfilmentId: string; date: string }[]>();
    this.document(this.start, 'OPENING', 'HUB', Object.entries(target));
    for (const [code, quantity] of Object.entries(target)) this.stock.move('HUB', code, quantity);
    for (const day of this.days()) {
      this.stock.arrive(day);
      this.planPurchases(day, 'HUB', 'cementi', ['CM-PORT', 'CV-3G15'], target, 3, incoming);
      this.planSales(day, 'HUB', customers, { edilnord: 3, bruni: 1 }, 0.2, shipments);
    }
    this.planDeferred(customers, shipments);
    this.timeline.add(this.input.today, AT.undo, async () => {
      if (this.result.invoices > 0) this.show('invoicing.secondCompany');
    });
  }

  /** Bianchi: an accounting firm without orders, invoicing by hand. */
  private planBianchi(): void {
    for (const day of this.days()) {
      const dom = Number(day.slice(8, 10));
      if (dom === 5 || dom === 20) {
        this.invoice({
          date: workday(day),
          party: 'ferraro',
          terms: '30DF',
          method: 'MP05',
          pays: { kind: 'onTime', late: 4 },
          lines: [{ code: 'CONS-ORA', quantity: this.int(3, 10) }],
          onIssued: () => this.show('invoicing.withoutOrders'),
        });
      }
      if (dom === 14) {
        this.invoice({
          date: workday(day),
          party: 'gentile',
          terms: '30DF',
          method: 'MP05',
          pays: { kind: 'late', min: 10, max: 30 },
          lines: [{ code: 'CONS-ORA', quantity: this.int(6, 16) }],
        });
      }
      if (dom === 26) {
        this.invoice({
          date: workday(day),
          party: 'ferraro',
          terms: 'RD',
          method: 'MP05',
          pays: { kind: 'onTime', late: 2 },
          lines: [
            { code: 'CARTA-A4', quantity: this.int(1, 4) },
            { code: 'TONER-K', quantity: this.int(0, 2) },
          ].filter((line) => line.quantity > 0),
        });
      }
    }
  }
}
