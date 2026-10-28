import { Prisma } from '../../generated/prisma/client.js';
import { isDecimalString, QUANTITY } from '../../shared/decimal.js';

/**
 * Pure rules of the warehouse: dates, quantities, and how a document turns into movements and
 * stock changes. No database here, so every rule is tested on its own (stock-rules.spec.ts).
 */

/** Italian stock documents are dated in Italian time: 00:30 in Rome is still "yesterday" in UTC. */
export const BUSINESS_TIME_ZONE = 'Europe/Rome';

/** How far back a document may be dated: late delivery notes and month ends. */
export const MAX_DAYS_BACK = 30;

/** Today in the business time zone, as YYYY-MM-DD. */
export function businessToday(now = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** YYYY-MM-DD plus some days (negative: back), in the calendar, without time zones. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** A valid calendar date as YYYY-MM-DD (2026-02-30 is not). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return addDays(value, 0) === value;
}

/** null when the document date is acceptable, otherwise the error code for the field. */
export function documentDateError(date: string, today: string): string | null {
  if (!isCalendarDate(date)) return 'DATE_INVALID';
  if (date > today) return 'DATE_IN_FUTURE';
  if (date < addDays(today, -MAX_DAYS_BACK)) return 'DATE_TOO_OLD';
  return null;
}

/** For the database: a YYYY-MM-DD date as the midnight UTC Prisma maps to a `date` column. */
export function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * null when the quantity is acceptable in this unit, otherwise the error code. `allowZero` is for
 * counted quantities (an empty shelf is a valid count).
 */
export function quantityError(value: string, decimals: number, allowZero = false): string | null {
  if (!isDecimalString(value, QUANTITY)) return 'IS_DECIMAL_STRING';
  const quantity = new Prisma.Decimal(value);
  if (quantity.isZero() && !allowZero) return 'QUANTITY_NOT_POSITIVE';
  if (quantity.decimalPlaces() > decimals) return 'QUANTITY_DECIMALS';
  return null;
}

/** A warehouse and an item: the unit of stock, and of locking. */
export interface StockKey {
  warehouseId: string;
  itemId: string;
}

export const keyOf = (key: StockKey) => `${key.warehouseId}:${key.itemId}`;

/**
 * Sorted by warehouse, then item, without duplicates: the fixed order in which a use case locks
 * balances (docs/conventions.md B34). Two documents touching the same rows lock them in the same
 * order, so one waits for the other instead of both waiting for each other (a deadlock).
 */
export function lockOrder(keys: readonly StockKey[]): StockKey[] {
  const unique = new Map(keys.map((key) => [keyOf(key), key]));
  return [...unique.values()].sort(
    (a, b) => a.warehouseId.localeCompare(b.warehouseId) || a.itemId.localeCompare(b.itemId),
  );
}

export interface PlannedLine {
  itemId: string;
  /** Positive amount moved; absent for an inventory adjustment. */
  quantity?: Prisma.Decimal;
  /** What was counted, for an inventory adjustment. */
  countedQuantity?: Prisma.Decimal;
}

export interface PlannedMovement {
  lineNo: number;
  warehouseId: string;
  itemId: string;
  /** Signed: positive in, negative out. */
  quantity: Prisma.Decimal;
  countedQuantity: Prisma.Decimal | null;
}

export type Direction = 'in' | 'out' | 'counted' | 'transfer';

/** The balances a document touches, before knowing the stock (an adjustment needs it). */
export function touchedKeys(
  direction: Direction,
  warehouses: { warehouseId: string; targetWarehouseId?: string | null },
  lines: readonly PlannedLine[],
): StockKey[] {
  return lockOrder(
    lines.flatMap((line) => {
      const origin = { warehouseId: warehouses.warehouseId, itemId: line.itemId };
      return direction === 'transfer'
        ? [origin, { warehouseId: warehouses.targetWarehouseId!, itemId: line.itemId }]
        : [origin];
    }),
  );
}

/**
 * The movements of a document. `stock` is the current stock of each touched balance, read after
 * locking it: an adjustment moves the difference between what was counted and what there is, so
 * it is right even if someone moved the same item a moment before. Lines numbered from 1.
 * An adjustment line whose count equals the stock moves nothing and is reported by the caller.
 */
export function planMovements(
  direction: Direction,
  warehouses: { warehouseId: string; targetWarehouseId?: string | null },
  lines: readonly PlannedLine[],
  stock: ReadonlyMap<string, Prisma.Decimal>,
): PlannedMovement[] {
  return lines.flatMap((line, index): PlannedMovement[] => {
    const lineNo = index + 1;
    const at = (warehouseId: string, quantity: Prisma.Decimal): PlannedMovement => ({
      lineNo,
      warehouseId,
      itemId: line.itemId,
      quantity,
      countedQuantity: null,
    });
    switch (direction) {
      case 'in':
        return [at(warehouses.warehouseId, line.quantity!)];
      case 'out':
        return [at(warehouses.warehouseId, line.quantity!.negated())];
      case 'transfer':
        return [
          at(warehouses.warehouseId, line.quantity!.negated()),
          at(warehouses.targetWarehouseId!, line.quantity!),
        ];
      case 'counted': {
        const current =
          stock.get(keyOf({ warehouseId: warehouses.warehouseId, itemId: line.itemId })) ??
          new Prisma.Decimal(0);
        const difference = line.countedQuantity!.minus(current);
        return [
          { ...at(warehouses.warehouseId, difference), countedQuantity: line.countedQuantity! },
        ];
      }
    }
  });
}

/** The opposite movements: what a reversal records. Counts are not repeated. */
export function reverseMovements(movements: readonly PlannedMovement[]): PlannedMovement[] {
  return movements.map((movement) => ({
    ...movement,
    quantity: movement.quantity.negated(),
    countedQuantity: null,
  }));
}

/** Net change per balance, in lock order. Two lines of the same item add up. */
export function balanceChanges(
  movements: readonly PlannedMovement[],
): (StockKey & { change: Prisma.Decimal })[] {
  const changes = new Map<string, StockKey & { change: Prisma.Decimal }>();
  for (const movement of movements) {
    const key = keyOf(movement);
    const current = changes.get(key);
    changes.set(key, {
      warehouseId: movement.warehouseId,
      itemId: movement.itemId,
      change: (current?.change ?? new Prisma.Decimal(0)).plus(movement.quantity),
    });
  }
  return lockOrder([...changes.values()]).map((key) => changes.get(keyOf(key))!);
}

/**
 * The balances that would go below zero, with the lines responsible (those that take goods out of
 * that balance). Empty when the document can be recorded.
 */
export function shortages(
  movements: readonly PlannedMovement[],
  stock: ReadonlyMap<string, Prisma.Decimal>,
): { key: StockKey; available: Prisma.Decimal; lineNos: number[] }[] {
  return balanceChanges(movements)
    .map((change) => ({
      key: { warehouseId: change.warehouseId, itemId: change.itemId },
      available: stock.get(keyOf(change)) ?? new Prisma.Decimal(0),
      change: change.change,
    }))
    .filter(({ available, change }) => available.plus(change).isNegative())
    .map(({ key, available }) => ({
      key,
      available,
      lineNos: [
        ...new Set(
          movements
            .filter((m) => keyOf(m) === keyOf(key) && m.quantity.isNegative())
            .map((m) => m.lineNo),
        ),
      ],
    }));
}

/** A balance as locked: what is there and how much of it is promised (docs/adr/0025). */
export interface BalanceState {
  quantity: Prisma.Decimal;
  reserved: Prisma.Decimal;
}

/** Stock not promised to anyone: what a free issue may take. */
export function availableOf(balance: BalanceState | undefined): Prisma.Decimal {
  return balance ? balance.quantity.minus(balance.reserved) : new Prisma.Decimal(0);
}

export interface ReservationRequest extends StockKey {
  originLineId: string;
  /** What the line holds now (zero when it holds nothing). */
  current: Prisma.Decimal;
  /** What it should hold: more grows it as far as stock allows, less releases the difference. */
  wanted: Prisma.Decimal;
}

/**
 * What each reservation becomes. Releases come first, so goods freed by one line can serve
 * another in the same call; then growths in the order given (the caller's line order), each
 * taking what is still available on its balance. A growth that finds nothing keeps what it has.
 */
export function planReservations(
  requests: readonly ReservationRequest[],
  balances: ReadonlyMap<string, BalanceState>,
): (ReservationRequest & { reserved: Prisma.Decimal })[] {
  const available = new Map(
    [...balances].map(([key, balance]) => [key, availableOf(balance)] as const),
  );
  const result = new Map<string, Prisma.Decimal>();
  for (const request of requests.filter((r) => r.wanted.lessThan(r.current))) {
    const key = keyOf(request);
    available.set(
      key,
      (available.get(key) ?? new Prisma.Decimal(0)).plus(request.current.minus(request.wanted)),
    );
    result.set(request.originLineId, request.wanted);
  }
  for (const request of requests.filter((r) => r.wanted.greaterThanOrEqualTo(r.current))) {
    const key = keyOf(request);
    const free = available.get(key) ?? new Prisma.Decimal(0);
    const grown = Prisma.Decimal.min(request.wanted.minus(request.current), free);
    available.set(key, free.minus(grown));
    result.set(request.originLineId, request.current.plus(grown));
  }
  return requests.map((request) => ({ ...request, reserved: result.get(request.originLineId)! }));
}

/**
 * How much of its reservation each line of an issue takes: all of the line's quantity if the
 * reservation holds that much, otherwise the whole reservation (the rest comes from free stock).
 * `reserved` is per line, null for a line without a reservation.
 */
export function plannedConsumption(
  lines: readonly { quantity: Prisma.Decimal }[],
  reserved: readonly (Prisma.Decimal | null)[],
): Prisma.Decimal[] {
  return lines.map((line, index) => {
    const held = reserved[index];
    return held ? Prisma.Decimal.min(held, line.quantity) : new Prisma.Decimal(0);
  });
}

/**
 * Available stock per balance once this document's own reservations are consumed: the stock a
 * document may take out. Lines must already be in `stock` (locked).
 */
export function availableAfterConsumption(
  stock: ReadonlyMap<string, BalanceState>,
  consumed: readonly (StockKey & { quantity: Prisma.Decimal })[],
): Map<string, Prisma.Decimal> {
  const released = new Map<string, Prisma.Decimal>();
  for (const entry of consumed) {
    const key = keyOf(entry);
    released.set(key, (released.get(key) ?? new Prisma.Decimal(0)).plus(entry.quantity));
  }
  return new Map(
    [...stock].map(([key, balance]) => [
      key,
      availableOf(balance).plus(released.get(key) ?? new Prisma.Decimal(0)),
    ]),
  );
}
