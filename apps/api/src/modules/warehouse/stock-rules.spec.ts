import { Prisma } from '../../generated/prisma/client.js';
import {
  documentReference,
  NOTES_REQUIRED,
  parseDocumentReference,
  POSTABLE_REASONS,
  reasonsOfType,
  SERIES_OF_TYPE,
  STOCK_REASONS,
} from './reasons.js';
import {
  addDays,
  balanceChanges,
  businessToday,
  documentDateError,
  keyOf,
  lockOrder,
  planMovements,
  quantityError,
  reverseMovements,
  shortages,
  touchedKeys,
} from './stock-rules.js';

const d = (value: string | number) => new Prisma.Decimal(value);
const W1 = '0198a000-0000-7000-8000-00000000000a';
const W2 = '0198a000-0000-7000-8000-00000000000b';
const A = '0198a000-0000-7000-8000-0000000000a1';
const B = '0198a000-0000-7000-8000-0000000000b1';
const stockOf = (entries: [string, string, number][]) =>
  new Map(entries.map(([w, i, q]) => [keyOf({ warehouseId: w, itemId: i }), d(q)]));
const plain = (movements: { quantity: Prisma.Decimal; countedQuantity: Prisma.Decimal | null }[]) =>
  movements.map((m) => ({
    ...m,
    quantity: m.quantity.toString(),
    countedQuantity: m.countedQuantity?.toString() ?? null,
  }));

describe('stock reasons', () => {
  it('gives every reason the series of its type', () => {
    for (const reason of POSTABLE_REASONS) {
      expect(STOCK_REASONS[reason].series).toBe(SERIES_OF_TYPE[STOCK_REASONS[reason].type]);
    }
  });

  it('asks a party only of the reasons that name one', () => {
    for (const reason of POSTABLE_REASONS) {
      const rule = STOCK_REASONS[reason];
      if (rule.partyRequired) expect(rule.party).not.toBeNull();
    }
    expect(STOCK_REASONS.PURCHASE_RECEIPT.party).toBe('supplier');
    expect(STOCK_REASONS.CUSTOMER_RETURN.party).toBe('customer');
    expect(NOTES_REQUIRED).toEqual(['LOSS']);
  });

  it('groups reasons by type', () => {
    expect(reasonsOfType('issue')).toEqual(['SALE_ISSUE', 'INTERNAL_USE', 'LOSS']);
    expect(reasonsOfType('transfer')).toEqual(['TRANSFER']);
  });

  it('writes and reads document references', () => {
    expect(documentReference({ series: 'CA', year: 2026, number: 42 })).toBe('CA-2026/0042');
    expect(documentReference({ series: 'SC', year: 2026, number: 12345 })).toBe('SC-2026/12345');
    expect(parseDocumentReference(' ca-2026/42 ')).toEqual({
      series: 'CA',
      year: 2026,
      number: 42,
    });
    expect(parseDocumentReference('CA 2026 42')).toBeNull();
  });
});

describe('stock dates', () => {
  it('takes today in Italian time', () => {
    // 23:30 UTC on 31 December is already New Year's Day in Rome.
    expect(businessToday(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(businessToday(new Date('2026-07-15T21:59:00Z'))).toBe('2026-07-15');
    expect(businessToday(new Date('2026-07-15T22:00:00Z'))).toBe('2026-07-16');
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('accepts today and up to 30 days back, nothing in the future', () => {
    const today = '2026-10-23';
    expect(documentDateError(today, today)).toBeNull();
    expect(documentDateError('2026-09-23', today)).toBeNull();
    expect(documentDateError('2026-09-22', today)).toBe('DATE_TOO_OLD');
    expect(documentDateError('2026-10-24', today)).toBe('DATE_IN_FUTURE');
    expect(documentDateError('2026-02-30', today)).toBe('DATE_INVALID');
    expect(documentDateError('23/10/2026', today)).toBe('DATE_INVALID');
  });
});

describe('quantities', () => {
  it('allows as many decimals as the unit', () => {
    expect(quantityError('3', 0)).toBeNull();
    expect(quantityError('1.5', 0)).toBe('QUANTITY_DECIMALS');
    expect(quantityError('1.250', 3)).toBeNull();
    expect(quantityError('1.2500', 3)).toBe('IS_DECIMAL_STRING');
    // Trailing zeros are not decimals that matter: 2.0 pieces are two pieces.
    expect(quantityError('2.0', 0)).toBeNull();
  });

  it('refuses zero, signs and anything that is not a decimal string', () => {
    expect(quantityError('0', 3)).toBe('QUANTITY_NOT_POSITIVE');
    expect(quantityError('0', 3, true)).toBeNull();
    expect(quantityError('-1', 3)).toBe('IS_DECIMAL_STRING');
    expect(quantityError('1,5', 3)).toBe('IS_DECIMAL_STRING');
  });
});

describe('movements', () => {
  it('locks balances in one order, whatever the order of the lines', () => {
    const order = lockOrder([
      { warehouseId: W2, itemId: A },
      { warehouseId: W1, itemId: B },
      { warehouseId: W1, itemId: A },
      { warehouseId: W1, itemId: B },
    ]);
    expect(order).toEqual([
      { warehouseId: W1, itemId: A },
      { warehouseId: W1, itemId: B },
      { warehouseId: W2, itemId: A },
    ]);
  });

  it('turns receipts, issues and transfers into signed movements', () => {
    const lines = [{ itemId: A, quantity: d(5) }];
    const none = new Map();
    expect(plain(planMovements('in', { warehouseId: W1 }, lines, none))).toEqual([
      { lineNo: 1, warehouseId: W1, itemId: A, quantity: '5', countedQuantity: null },
    ]);
    expect(plain(planMovements('out', { warehouseId: W1 }, lines, none))[0]!.quantity).toBe('-5');
    expect(
      plain(planMovements('transfer', { warehouseId: W1, targetWarehouseId: W2 }, lines, none)),
    ).toEqual([
      { lineNo: 1, warehouseId: W1, itemId: A, quantity: '-5', countedQuantity: null },
      { lineNo: 1, warehouseId: W2, itemId: A, quantity: '5', countedQuantity: null },
    ]);
    expect(
      touchedKeys('transfer', { warehouseId: W2, targetWarehouseId: W1 }, lines).map(
        (k) => k.warehouseId,
      ),
    ).toEqual([W1, W2]);
  });

  it('moves the difference between what was counted and what there is', () => {
    const stock = stockOf([[W1, A, 7]]);
    const lines = [
      { itemId: A, countedQuantity: d('4.5') },
      { itemId: B, countedQuantity: d(2) },
    ];
    expect(plain(planMovements('counted', { warehouseId: W1 }, lines, stock))).toEqual([
      { lineNo: 1, warehouseId: W1, itemId: A, quantity: '-2.5', countedQuantity: '4.5' },
      { lineNo: 2, warehouseId: W1, itemId: B, quantity: '2', countedQuantity: '2' },
    ]);
  });

  it('adds up lines of the same item and reverses movements', () => {
    const movements = planMovements(
      'out',
      { warehouseId: W1 },
      [
        { itemId: B, quantity: d(2) },
        { itemId: A, quantity: d(1) },
        { itemId: B, quantity: d('0.5') },
      ],
      new Map(),
    );
    expect(balanceChanges(movements).map((c) => [c.itemId, c.change.toString()])).toEqual([
      [A, '-1'],
      [B, '-2.5'],
    ]);
    expect(plain(reverseMovements(movements)).map((m) => m.quantity)).toEqual(['2', '1', '0.5']);
  });

  it('finds the balances that would go below zero, and the lines to blame', () => {
    const movements = planMovements(
      'out',
      { warehouseId: W1 },
      [
        { itemId: A, quantity: d(2) },
        { itemId: B, quantity: d(1) },
        { itemId: A, quantity: d(2) },
      ],
      new Map(),
    );
    const found = shortages(
      movements,
      stockOf([
        [W1, A, 3],
        [W1, B, 1],
      ]),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: { warehouseId: W1, itemId: A }, lineNos: [1, 3] });
    expect(found[0]!.available.toString()).toBe('3');
    expect(
      shortages(
        movements,
        stockOf([
          [W1, A, 4],
          [W1, B, 1],
        ]),
      ),
    ).toEqual([]);
  });
});
