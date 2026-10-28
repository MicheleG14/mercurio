import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { MembershipRole, PrismaClient } from '../src/generated/prisma/client.js';
import { businessToday, WarehouseService } from '../src/modules/warehouse/index.js';
import { italianCheckDigit } from '../src/shared/italian-identifiers.js';
import { activate, bearer, createTestApp } from './support/auth.js';
import {
  adminClient,
  createWorld,
  deleteTenantsAndUsers,
  uniqueSuffix,
  uuidv7,
  type World,
} from './support/database.js';

// Orders end to end (docs/adr/0024, 0025): real application, real database, the API role subject
// to Row-Level Security. Tenant A has the warehouse and orders modules; B has neither. Goods move
// only through the warehouse, so every check of stock reads it back through the warehouse's API.
// Concurrency is real: parallel requests go through the connection pool.
describe('orders (e2e)', () => {
  let app: NestExpressApplication;
  let admin: PrismaClient;
  let world: World;
  const token: Record<'admin' | 'other' | MembershipRole, string> = {} as never;
  const extraUsers: string[] = [];
  const suffix = uniqueSuffix();
  const http = () => request(app.getHttpServer());
  const today = businessToday();
  const year = Number(today.slice(0, 4));
  let counter = 0;

  const newVat = () => {
    const first10 =
      (Number.parseInt(suffix, 16) % 1e6).toString().padStart(6, '3') +
      String(++counter).padStart(4, '0');
    return first10 + italianCheckDigit(first10);
  };

  beforeAll(async () => {
    admin = adminClient();
    world = await createWorld(admin);
    await admin.tenantModule.createMany({
      data: [
        { tenantId: world.tenants.a, moduleKey: 'warehouse' },
        { tenantId: world.tenants.a, moduleKey: 'orders' },
      ],
    });
    app = await createTestApp();
    token.admin = (await activate(app, admin, world.users.u)).accessToken;
    token.admin = (
      await http()
        .post('/api/auth/tenant')
        .set(bearer(token.admin))
        .send({ tenantId: world.tenants.a })
        .expect(200)
    ).body.accessToken;
    token.ADMIN = token.admin;
    token.other = (await activate(app, admin, world.users.v)).accessToken;
    for (const role of ['WAREHOUSE_KEEPER', 'ACCOUNTANT', 'READ_ONLY'] as const) {
      const user = await admin.user.create({
        data: { email: `${role.toLowerCase()}-or-${suffix}@example.com`, name: role },
      });
      extraUsers.push(user.id);
      await admin.membership.create({
        data: { tenantId: world.tenants.a, userId: user.id, role, allCompanies: true },
      });
      token[role] = (await activate(app, admin, user.id)).accessToken;
    }
  });

  afterAll(async () => {
    await app?.close();
    if (world) {
      await deleteTenantsAndUsers(admin, Object.values(world.tenants), [
        ...Object.values(world.users),
        ...extraUsers,
      ]);
    }
    await admin.$disconnect();
  });

  const as = (who: keyof typeof token, company: string | null = world.companies.a) => {
    const set = (r: request.Test) => {
      r.set(bearer(token[who]));
      return company ? r.set('X-Company-Id', company) : r;
    };
    return {
      get: (url: string) => set(http().get(`/api${url}`)),
      post: (url: string, body: object = {}) => set(http().post(`/api${url}`)).send(body),
      put: (url: string, body: object) => set(http().put(`/api${url}`)).send(body),
      delete: (url: string) => set(http().delete(`/api${url}`)),
    };
  };

  const ids = {} as Record<'supplier' | 'customer' | 'warehouse' | 'service', string>;
  beforeAll(async () => {
    const party = (isCustomer: boolean, isSupplier: boolean) =>
      as('admin', null)
        .post('/parties', {
          kind: 'COMPANY',
          isCustomer,
          isSupplier,
          legalName: `Soggetto ordini ${suffix} ${++counter} Srl`,
          vatNumber: newVat(),
        })
        .expect(201);
    ids.supplier = (await party(false, true)).body.id;
    ids.customer = (await party(true, false)).body.id;
    ids.warehouse = (
      await as('admin').post('/warehouses', { code: 'ORD', name: 'Ordini' }).expect(201)
    ).body.id;
    ids.service = (
      await as('admin', null)
        .post('/items', {
          code: `OS-${suffix}`,
          description: 'Ore di posa',
          unit: 'H',
          vatCode: '22',
          stockManaged: false,
        })
        .expect(201)
    ).body.id;
  });

  /** A new item, with this much in stock in the orders' warehouse. */
  const itemWith = async (stock: string, extra: object = {}) => {
    const itemId = (
      await as('admin', null)
        .post('/items', {
          code: `OI-${suffix}-${++counter}`,
          description: `Articolo ${counter}`,
          unit: 'PZ',
          vatCode: '22',
          salePrice: '10',
          ...extra,
        })
        .expect(201)
    ).body.id as string;
    if (stock !== '0') await addStock(itemId, stock);
    return itemId;
  };
  const addStock = (itemId: string, quantity: string) =>
    as('admin')
      .post('/stock-documents', {
        id: uuidv7(),
        reason: 'OPENING',
        warehouseId: ids.warehouse,
        lines: [{ itemId, quantity }],
      })
      .expect(201);
  const stockOf = async (itemId: string) => {
    const { body } = await as('admin').get(`/stock/items/${itemId}`).expect(200);
    const row = body.warehouses.find(
      (w: { warehouseId: string }) => w.warehouseId === ids.warehouse,
    );
    return {
      quantity: row?.quantity ?? '0.000',
      reserved: row?.reservedQuantity ?? '0.000',
      available: row?.availableQuantity ?? '0.000',
    };
  };
  const draft = (kind: 'PURCHASE' | 'SALES', lines: object[], extra: object = {}) => ({
    id: uuidv7(),
    kind,
    partyId: kind === 'PURCHASE' ? ids.supplier : ids.customer,
    warehouseId: ids.warehouse,
    lines,
    ...extra,
  });
  /** A confirmed order, through the API like a person would. */
  const confirmed = async (
    kind: 'PURCHASE' | 'SALES',
    lines: object[],
    who: keyof typeof token = 'admin',
  ) => {
    const created = await as(who).post('/orders', draft(kind, lines)).expect(201);
    return (await as(who).post(`/orders/${created.body.id}/confirm`, { version: 1 }).expect(200))
      .body;
  };
  const fulfil = (
    orderId: string,
    lines: { orderLineId: string; quantity: string }[],
    extra: object = {},
  ) => as('admin').post(`/orders/${orderId}/fulfilments`, { id: uuidv7(), lines, ...extra });
  type Line = {
    id: string;
    reservedQuantity: string;
    doneQuantity: string;
    remainingQuantity: string;
  };

  describe('drafts', () => {
    it('creates a draft once, with amounts and totals computed by the API', async () => {
      const item = await itemWith('0');
      const body = draft('SALES', [
        { itemId: item, quantity: '3', unitPrice: '1.3333', discountPercent: '10' },
        { itemId: item, quantity: '2', unitPrice: '10', vatCode: '4', description: 'Altro' },
      ]);
      const created = await as('ACCOUNTANT').post('/orders', body).expect(201);
      expect(created.body).toMatchObject({
        status: 'DRAFT',
        reference: null,
        taxableTotal: '23.60',
        vatTotal: '1.59', // 22% of 3.60 = 0.79, 4% of 20 = 0.80
        total: '25.19',
      });
      expect(created.body.lines[0]).toMatchObject({
        description: `Articolo ${counter}`,
        lineAmount: '3.60',
        vatRate: '22.00',
      });
      expect(created.body.vatSummary.map((r: { vatCode: string }) => r.vatCode)).toEqual([
        '22',
        '4',
      ]);
      // The same request again (a double click): the same draft. Different content: refused.
      await as('ACCOUNTANT').post('/orders', body).expect(200);
      const reused = await as('ACCOUNTANT')
        .post('/orders', { ...body, notes: 'altro' })
        .expect(409);
      expect(reused.body.code).toBe('DOCUMENT_ID_REUSED');
    });

    it('saves a draft with its version, and deletes only drafts', async () => {
      const item = await itemWith('0');
      const created = await as('admin').post('/orders', draft('PURCHASE', [])).expect(201);
      const id = created.body.id;
      const saved = await as('admin')
        .put(`/orders/${id}`, {
          version: 1,
          partyId: ids.supplier,
          warehouseId: ids.warehouse,
          lines: [{ itemId: item, quantity: '4' }],
        })
        .expect(200);
      expect(saved.body).toMatchObject({ version: 2, lineCount: 1, total: '0.00' });
      const stale = await as('admin')
        .put(`/orders/${id}`, { version: 1, partyId: ids.supplier, lines: [] })
        .expect(409);
      expect(stale.body.code).toBe('EDIT_CONFLICT');
      await as('admin').delete(`/orders/${id}?version=2`).expect(204);
      await as('admin').get(`/orders/${id}`).expect(404);

      const order = await confirmed('PURCHASE', [{ itemId: item, quantity: '1' }]);
      const refused = await as('admin')
        .delete(`/orders/${order.id}?version=${order.version}`)
        .expect(409);
      expect(refused.body.code).toBe('ORDER_NOT_DRAFT');
      const put = await as('admin')
        .put(`/orders/${order.id}`, { version: order.version, partyId: ids.supplier, lines: [] })
        .expect(409);
      expect(put.body.code).toBe('ORDER_NOT_DRAFT');
    });

    it('checks the party, the items and the dates', async () => {
      const service = await as('admin')
        .post(
          '/orders',
          draft('SALES', [{ itemId: ids.service, quantity: '1.5' }], {
            partyId: ids.supplier,
            orderDate: '2999-01-01',
          }),
        )
        .expect(400);
      expect(service.body.errors).toEqual(
        expect.arrayContaining([
          { field: 'partyId', code: 'PARTY_WRONG_ROLE' },
          { field: 'orderDate', code: 'DATE_IN_FUTURE' },
          { field: 'lines[0].itemId', code: 'ITEM_NOT_STOCK_MANAGED' },
        ]),
      );
      const item = await itemWith('0');
      const bad = await as('admin')
        .post(
          '/orders',
          draft(
            'SALES',
            [{ itemId: item, quantity: '1.5', discountPercent: '120', vatCode: 'X' }],
            {
              orderDate: '2026-01-10',
              requestedDate: '2026-01-09',
            },
          ),
        )
        .expect(400);
      expect(bad.body.errors).toEqual(
        expect.arrayContaining([
          { field: 'requestedDate', code: 'REQUESTED_BEFORE_ORDER' },
          { field: 'lines[0].quantity', code: 'QUANTITY_DECIMALS' },
          { field: 'lines[0].discountPercent', code: 'DISCOUNT_INVALID' },
          { field: 'lines[0].vatCode', code: 'VAT_CODE_UNKNOWN' },
        ]),
      );
    });
  });

  describe('purchase orders', () => {
    it('are numbered at confirmation and received in parts', async () => {
      const [a, b] = [await itemWith('0'), await itemWith('0')];
      const order = await confirmed('PURCHASE', [
        { itemId: a, quantity: '5', unitPrice: '2' },
        { itemId: b, quantity: '3' },
      ]);
      expect(order.reference).toMatch(new RegExp(`^OF-${year}/\\d{4}$`));
      expect(order.status).toBe('CONFIRMED');
      const [lineA, lineB] = order.lines as Line[];

      const first = await fulfil(
        order.id,
        [
          { orderLineId: lineA!.id, quantity: '2' },
          { orderLineId: lineB!.id, quantity: '0' },
        ],
        { partyDocumentRef: 'DDT 7' },
      ).expect(201);
      expect(first.body.status).toBe('PARTIAL');
      expect(first.body.lines[0]).toMatchObject({
        doneQuantity: '2.000',
        remainingQuantity: '3.000',
      });
      expect(await stockOf(a)).toMatchObject({ quantity: '2.000' });
      const document = first.body.fulfilments[0];
      expect(document.stockDocumentReference).toMatch(new RegExp(`^CA-${year}/`));
      const stock = await as('admin')
        .get(`/stock-documents/${document.stockDocumentId}`)
        .expect(200);
      expect(stock.body).toMatchObject({
        reason: 'PURCHASE_RECEIPT',
        partyId: ids.supplier,
        partyDocumentRef: 'DDT 7',
        origin: { type: 'order', id: order.id, reference: order.reference },
      });

      const over = await fulfil(order.id, [{ orderLineId: lineA!.id, quantity: '4' }]).expect(400);
      expect(over.body.errors).toEqual([
        { field: 'lines[0].quantity', code: 'QUANTITY_OVER_REMAINING' },
      ]);
      const done = await fulfil(order.id, [
        { orderLineId: lineA!.id, quantity: '3' },
        { orderLineId: lineB!.id, quantity: '3' },
      ]).expect(201);
      expect(done.body.status).toBe('COMPLETED');
      const after = await fulfil(order.id, [{ orderLineId: lineA!.id, quantity: '1' }]).expect(409);
      expect(after.body.code).toBe('ORDER_NOT_OPEN');
    });

    it('show what is incoming and what to order', async () => {
      const item = await itemWith('2');
      await as('admin')
        .put(`/stock/reorder-levels/${ids.warehouse}/${item}`, {
          reorderPoint: '5',
          reorderQuantity: '20',
        })
        .expect(200);
      let proposal = await as('admin')
        .get(`/orders/reorder-proposal?warehouseId=${ids.warehouse}`)
        .expect(200);
      expect(proposal.body.find((p: { itemId: string }) => p.itemId === item)).toMatchObject({
        availableQuantity: '2.000',
        incomingQuantity: '0.000',
        proposedQuantity: '20.000',
      });
      const order = await confirmed('PURCHASE', [{ itemId: item, quantity: '12' }]);
      const incoming = await as('READ_ONLY').get(`/orders/incoming?itemId=${item}`).expect(200);
      expect(incoming.body).toMatchObject({
        quantity: '12.000',
        orders: [{ orderId: order.id, reference: order.reference, remainingQuantity: '12.000' }],
      });
      proposal = await as('admin')
        .get(`/orders/reorder-proposal?warehouseId=${ids.warehouse}`)
        .expect(200);
      expect(proposal.body.find((p: { itemId: string }) => p.itemId === item)).toMatchObject({
        proposedQuantity: '8.000',
      });
    });
  });

  describe('sales orders', () => {
    it('require prices to be confirmed', async () => {
      const item = await itemWith('5');
      const created = await as('admin')
        .post('/orders', draft('SALES', [{ itemId: item, quantity: '1' }]))
        .expect(201);
      const refused = await as('admin')
        .post(`/orders/${created.body.id}/confirm`, { version: 1 })
        .expect(400);
      expect(refused.body.errors).toEqual([{ field: 'lines[0].unitPrice', code: 'REQUIRED' }]);
      expect(await stockOf(item)).toMatchObject({ reserved: '0.000' });
    });

    it('reserve what is available, stay uncovered for the rest, and reserve more later', async () => {
      const item = await itemWith('5');
      const order = await confirmed('SALES', [{ itemId: item, quantity: '8', unitPrice: '10' }]);
      expect(order).toMatchObject({ status: 'CONFIRMED', uncovered: true });
      expect(order.lines[0]).toMatchObject({
        reservedQuantity: '5.000',
        availableQuantity: '0.000',
      });
      expect(await stockOf(item)).toEqual({
        quantity: '5.000',
        reserved: '5.000',
        available: '0.000',
      });

      // Promised goods do not leave with a free issue.
      const issue = await as('admin')
        .post('/stock-documents', {
          id: uuidv7(),
          reason: 'INTERNAL_USE',
          warehouseId: ids.warehouse,
          lines: [{ itemId: item, quantity: '1' }],
        })
        .expect(409);
      expect(issue.body.code).toBe('STOCK_INSUFFICIENT');

      const uncovered = await as('admin')
        .get(`/orders?kind=SALES&uncovered=true&pageSize=100`)
        .expect(200);
      expect(uncovered.body.items.map((o: { id: string }) => o.id)).toContain(order.id);
      await addStock(item, '4');
      const reserved = await as('admin').post(`/orders/${order.id}/reserve`).expect(200);
      expect(reserved.body).toMatchObject({ uncovered: false });
      expect(reserved.body.lines[0].reservedQuantity).toBe('8.000');
      expect(await stockOf(item)).toEqual({
        quantity: '9.000',
        reserved: '8.000',
        available: '1.000',
      });
    });

    it('ship from their reservation, then from free stock, and are undone from the order only', async () => {
      const item = await itemWith('10');
      const order = await confirmed('SALES', [{ itemId: item, quantity: '4', unitPrice: '10' }]);
      const line = order.lines[0] as Line;
      const shipped = await fulfil(order.id, [{ orderLineId: line.id, quantity: '3' }]).expect(201);
      expect(shipped.body.lines[0]).toMatchObject({
        doneQuantity: '3.000',
        reservedQuantity: '1.000',
      });
      expect(await stockOf(item)).toEqual({
        quantity: '7.000',
        reserved: '1.000',
        available: '6.000',
      });

      const fulfilment = shipped.body.fulfilments[0];
      const fromWarehouse = await as('admin')
        .post(`/stock-documents/${fulfilment.stockDocumentId}/reverse`)
        .expect(409);
      expect(fromWarehouse.body.code).toBe('DOCUMENT_HAS_ORIGIN');

      const undone = await as('WAREHOUSE_KEEPER')
        .post(`/orders/${order.id}/fulfilments/${fulfilment.id}/reverse`)
        .expect(200);
      expect(undone.body).toMatchObject({ status: 'CONFIRMED' });
      expect(undone.body.lines[0]).toMatchObject({
        doneQuantity: '0.000',
        reservedQuantity: '4.000',
      });
      expect(undone.body.fulfilments[0].reversalDocumentReference).toMatch(
        new RegExp(`^SC-${year}/`),
      );
      expect(await stockOf(item)).toEqual({
        quantity: '10.000',
        reserved: '4.000',
        available: '6.000',
      });
      const again = await as('admin')
        .post(`/orders/${order.id}/fulfilments/${fulfilment.id}/reverse`)
        .expect(409);
      expect(again.body.code).toBe('FULFILMENT_ALREADY_REVERSED');
    });

    it('report a stock shortage on the line of the request that caused it', async () => {
      const [a, b] = [await itemWith('5'), await itemWith('5')];
      const order = await confirmed('SALES', [
        { itemId: a, quantity: '2', unitPrice: '1' },
        { itemId: b, quantity: '9', unitPrice: '1' },
      ]);
      // Line b holds all 5 pieces of b and wants 9: shipping 6 needs one free piece, and none is.
      const [lineA, lineB] = order.lines as Line[];
      const refused = await fulfil(order.id, [
        { orderLineId: lineA!.id, quantity: '0' },
        { orderLineId: lineB!.id, quantity: '6' },
      ]).expect(409);
      expect(refused.body).toMatchObject({
        code: 'STOCK_INSUFFICIENT',
        errors: [{ field: 'lines[1].quantity', code: 'STOCK_INSUFFICIENT' }],
      });
      expect(await stockOf(b)).toEqual({
        quantity: '5.000',
        reserved: '5.000',
        available: '0.000',
      });
    });

    it('close what is left, releasing it, and cancel only when nothing moved', async () => {
      const item = await itemWith('10');
      const order = await confirmed('SALES', [{ itemId: item, quantity: '6', unitPrice: '1' }]);
      const line = order.lines[0] as Line;
      await fulfil(order.id, [{ orderLineId: line.id, quantity: '2' }]).expect(201);
      const current = (await as('admin').get(`/orders/${order.id}`).expect(200)).body;
      const cancel = await as('admin')
        .post(`/orders/${order.id}/cancel`, { version: current.version })
        .expect(409);
      expect(cancel.body.code).toBe('ORDER_HAS_FULFILMENTS');
      const closed = await as('ACCOUNTANT')
        .post(`/orders/${order.id}/close`, { version: current.version })
        .expect(200);
      expect(closed.body).toMatchObject({ status: 'COMPLETED' });
      expect(closed.body.lines[0]).toMatchObject({
        closedQuantity: '4.000',
        reservedQuantity: '0.000',
      });
      expect(await stockOf(item)).toEqual({
        quantity: '8.000',
        reserved: '0.000',
        available: '8.000',
      });

      const other = await confirmed('SALES', [{ itemId: item, quantity: '3', unitPrice: '1' }]);
      const cancelled = await as('admin')
        .post(`/orders/${other.id}/cancel`, { version: other.version })
        .expect(200);
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED', reference: other.reference });
      expect(await stockOf(item)).toMatchObject({ reserved: '0.000' });
    });

    it('are duplicated as a draft with the same prices', async () => {
      const item = await itemWith('0');
      const order = await confirmed('SALES', [{ itemId: item, quantity: '2', unitPrice: '7.5' }]);
      const id = uuidv7();
      const copy = await as('admin').post(`/orders/${order.id}/duplicate`, { id }).expect(201);
      expect(copy.body).toMatchObject({ id, status: 'DRAFT', reference: null, total: order.total });
      await as('admin').post(`/orders/${order.id}/duplicate`, { id }).expect(200);
    });
  });

  describe('concurrency', () => {
    it('never ships more than ordered, with ten fulfilments at once', async () => {
      const item = await itemWith('20');
      const order = await confirmed('SALES', [{ itemId: item, quantity: '5', unitPrice: '1' }]);
      const line = order.lines[0] as Line;
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          fulfil(order.id, [{ orderLineId: line.id, quantity: '1' }]),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(5);
      expect(
        results.filter((r) => r.status === 409).every((r) => r.body.code === 'ORDER_NOT_OPEN'),
      ).toBe(true);
      const after = (await as('admin').get(`/orders/${order.id}`).expect(200)).body;
      expect(after).toMatchObject({ status: 'COMPLETED' });
      expect(after.lines[0].doneQuantity).toBe('5.000');
      expect(await stockOf(item)).toEqual({
        quantity: '15.000',
        reserved: '0.000',
        available: '15.000',
      });
    });

    it('never reserves the same goods twice, and numbers orders without gaps', async () => {
      const item = await itemWith('5');
      const drafts = await Promise.all(
        Array.from({ length: 4 }, () =>
          as('admin')
            .post('/orders', draft('SALES', [{ itemId: item, quantity: '3', unitPrice: '1' }]))
            .expect(201),
        ),
      );
      const orders = await Promise.all(
        drafts.map((d) =>
          as('admin').post(`/orders/${d.body.id}/confirm`, { version: 1 }).expect(200),
        ),
      );
      const reserved = orders.reduce((sum, o) => sum + Number(o.body.lines[0].reservedQuantity), 0);
      expect(reserved).toBe(5);
      const numbers = orders
        .map((o) => Number(o.body.reference.split('/')[1]))
        .sort((x, y) => x - y);
      expect(numbers).toEqual([numbers[0], numbers[0]! + 1, numbers[0]! + 2, numbers[0]! + 3]);
    });

    it('records a fulfilment once when the same request comes twice at once', async () => {
      const item = await itemWith('5');
      const order = await confirmed('SALES', [{ itemId: item, quantity: '3', unitPrice: '1' }]);
      const body = { id: uuidv7(), lines: [{ orderLineId: order.lines[0].id, quantity: '2' }] };
      const both = await Promise.all([
        as('admin').post(`/orders/${order.id}/fulfilments`, body),
        as('admin').post(`/orders/${order.id}/fulfilments`, body),
      ]);
      expect(both.map((r) => r.status).sort((x, y) => x - y)).toEqual([200, 201]);
      expect(await stockOf(item)).toMatchObject({ quantity: '3.000' });
      const reused = await as('admin')
        .post(`/orders/${order.id}/fulfilments`, {
          ...body,
          lines: [{ ...body.lines[0], quantity: '1' }],
        })
        .expect(409);
      expect(reused.body.code).toBe('DOCUMENT_ID_REUSED');
    });
  });

  describe('lists', () => {
    it('finds orders by number, status and lateness, and counts them', async () => {
      const item = await itemWith('0');
      const late = await as('admin')
        .post(
          '/orders',
          draft('PURCHASE', [{ itemId: item, quantity: '1' }], {
            orderDate: '2026-01-05',
            requestedDate: '2026-01-10',
          }),
        )
        .expect(201);
      const order = (
        await as('admin').post(`/orders/${late.body.id}/confirm`, { version: 1 }).expect(200)
      ).body;
      expect(order.reference).toMatch(/^OF-2026\//);
      const byNumber = await as('READ_ONLY')
        .get(`/orders?kind=PURCHASE&q=${encodeURIComponent(order.reference.toLowerCase())}`)
        .expect(200);
      expect(byNumber.body.items.map((o: { id: string }) => o.id)).toEqual([order.id]);
      const lateOnes = await as('admin')
        .get('/orders?kind=PURCHASE&late=true&status=OPEN&pageSize=100')
        .expect(200);
      expect(lateOnes.body.items.find((o: { id: string }) => o.id === order.id)).toMatchObject({
        late: true,
      });
      const summary = await as('admin').get('/orders/summary').expect(200);
      expect(summary.body.purchaseLate).toBeGreaterThanOrEqual(1);
      expect(summary.body.salesUncovered).toBeGreaterThanOrEqual(0);
    });
  });

  describe('access', () => {
    it('is closed to tenants without the module', async () => {
      const res = await as('other', world.companies.b).get('/orders?kind=SALES').expect(403);
      expect(res.body.code).toBe('MODULE_NOT_ENABLED');
    });

    it('follows the permission matrix', async () => {
      const item = await itemWith('5');
      await as('READ_ONLY').get('/orders?kind=SALES').expect(200);
      await as('READ_ONLY').post('/orders', draft('SALES', [])).expect(403);
      const order = await confirmed(
        'SALES',
        [{ itemId: item, quantity: '1', unitPrice: '1' }],
        'ACCOUNTANT',
      );
      await as('ACCOUNTANT')
        .post(`/orders/${order.id}/fulfilments`, {
          id: uuidv7(),
          lines: [{ orderLineId: order.lines[0].id, quantity: '1' }],
        })
        .expect(403);
      await as('WAREHOUSE_KEEPER')
        .post(`/orders/${order.id}/fulfilments`, {
          id: uuidv7(),
          lines: [{ orderLineId: order.lines[0].id, quantity: '1' }],
        })
        .expect(201);
    });

    it('keeps an order inside its tenant', async () => {
      const created = await as('admin').post('/orders', draft('SALES', [])).expect(201);
      await as('other', world.companies.b).get(`/orders/${created.body.id}`).expect(403);
      const inB = await admin.order.findMany({
        where: { id: created.body.id, tenantId: world.tenants.b },
      });
      expect(inB).toEqual([]);
    });

    it('leaves every projection equal to what it sums, after all the scenarios above', async () => {
      const lines = await admin.$queryRaw<unknown[]>`
        SELECT l.id FROM order_lines l
        WHERE l.tenant_id = ${world.tenants.a}::uuid
          AND l.done_quantity <> (
            SELECT coalesce(sum(fl.quantity), 0) FROM order_fulfilment_lines fl
            JOIN order_fulfilments f ON f.id = fl.fulfilment_id
            WHERE fl.order_line_id = l.id AND f.reversal_document_id IS NULL)`;
      expect(lines).toEqual([]);
      const stock = (await app.get(WarehouseService).verifyStock(admin)).filter(
        (d) => d.tenantId === world.tenants.a,
      );
      expect(stock).toEqual([]);
    });

    it('writes an audit event for each action', async () => {
      const events = await admin.auditEvent.groupBy({
        by: ['type'],
        where: { tenantId: world.tenants.a, type: { startsWith: 'ORDER_' } },
        _count: true,
      });
      expect(events.map((e) => e.type).sort()).toEqual([
        'ORDER_CANCELLED',
        'ORDER_CLOSED',
        'ORDER_CONFIRMED',
        'ORDER_CREATED',
        'ORDER_DELETED',
        'ORDER_FULFILLED',
        'ORDER_FULFILMENT_REVERSED',
        'ORDER_RESERVED',
        'ORDER_UPDATED',
      ]);
    });
  });
});
