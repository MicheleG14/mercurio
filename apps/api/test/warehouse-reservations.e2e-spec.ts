import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { type Origin, WarehouseService } from '../src/modules/warehouse/index.js';
import { TenantDatabase } from '../src/prisma/index.js';
import { DomainException } from '../src/shared/errors/index.js';
import { activate, bearer, createTestApp } from './support/auth.js';
import {
  adminClient,
  createWorld,
  deleteTenantsAndUsers,
  uniqueSuffix,
  uuidv7,
  type World,
} from './support/database.js';

// Reservations end to end (docs/adr/0025): goods promised to the lines of another module through
// the public service, and what that changes for the warehouse's own documents. The orders module
// does not exist yet, so the test plays it: an origin of type "order" with made-up lines, inside
// real tenant transactions of the API role. Parallel calls run in separate transactions.
describe('warehouse reservations (e2e)', () => {
  let app: NestExpressApplication;
  let admin: PrismaClient;
  let world: World;
  let warehouse: WarehouseService;
  let database: TenantDatabase;
  let token: string;
  let w1: string;
  const suffix = uniqueSuffix();
  const http = () => request(app.getHttpServer());
  let counter = 0;

  beforeAll(async () => {
    admin = adminClient();
    world = await createWorld(admin);
    await admin.tenantModule.create({
      data: { tenantId: world.tenants.a, moduleKey: 'warehouse' },
    });
    app = await createTestApp();
    warehouse = app.get(WarehouseService);
    database = app.get(TenantDatabase);
    token = (await activate(app, admin, world.users.u)).accessToken;
    token = (
      await http()
        .post('/api/auth/tenant')
        .set(bearer(token))
        .send({ tenantId: world.tenants.a })
        .expect(200)
    ).body.accessToken;
    w1 = (await api().post('/warehouses').send({ code: 'RES', name: 'Prenotazioni' }).expect(201))
      .body.id;
  });

  afterAll(async () => {
    await app?.close();
    if (world) {
      await deleteTenantsAndUsers(admin, Object.values(world.tenants), Object.values(world.users));
    }
    await admin.$disconnect();
  });

  const api = () => {
    const set = (r: request.Test) => r.set(bearer(token)).set('X-Company-Id', world.companies.a);
    return {
      get: (url: string) => set(http().get(`/api${url}`)),
      post: (url: string) => set(http().post(`/api${url}`)),
    };
  };
  const company = () => ({
    tenantId: world.tenants.a,
    companyId: world.companies.a,
    userId: world.users.u,
  });
  /** One transaction of the API role in tenant A, as a request of the orders module would be. */
  const inTenant = <T>(
    work: (tx: Parameters<Parameters<TenantDatabase['run']>[0]>[0]) => Promise<T>,
  ) => database.runAs({ tenantId: world.tenants.a, userId: world.users.u }, work);
  const newOrder = (): Origin => ({ type: 'order', id: uuidv7(), reference: `OC-T/${++counter}` });

  /** A new item with this much in stock in w1, received through the API. */
  const itemWith = async (quantity: string) => {
    const itemId = (
      await request(app.getHttpServer())
        .post('/api/items')
        .set(bearer(token))
        .send({
          code: `RS-${suffix}-${++counter}`,
          description: 'Articolo',
          unit: 'PZ',
          vatCode: '22',
        })
        .expect(201)
    ).body.id as string;
    if (quantity !== '0') {
      await api()
        .post('/stock-documents')
        .send({
          id: uuidv7(),
          reason: 'OPENING',
          warehouseId: w1,
          lines: [{ itemId, quantity }],
        })
        .expect(201);
    }
    return itemId;
  };
  const reserve = (origin: Origin, lines: [string, string, string][]) =>
    inTenant((tx) =>
      warehouse.reserve(
        tx,
        company(),
        origin,
        lines.map(([originLineId, itemId, wanted]) => ({
          originLineId,
          warehouseId: w1,
          itemId,
          wanted,
        })),
      ),
    );
  const balanceOf = async (itemId: string) => {
    const { body } = await api().get(`/stock/items/${itemId}`).expect(200);
    const row = body.warehouses.find((w: { warehouseId: string }) => w.warehouseId === w1);
    return {
      quantity: row.quantity as string,
      reserved: row.reservedQuantity as string,
      available: row.availableQuantity as string,
    };
  };
  const internalUse = (itemId: string, quantity: string) => ({
    id: uuidv7(),
    reason: 'INTERNAL_USE',
    warehouseId: w1,
    lines: [{ itemId, quantity }],
  });
  /** Balances of tenant A whose reserved quantity is not the sum of their reservations. */
  const inconsistent = async () =>
    (await warehouse.verifyStock(admin)).filter((d) => d.tenantId === world.tenants.a);

  it('reserves what is available and leaves the rest uncovered', async () => {
    const item = await itemWith('5');
    const line = uuidv7();
    const [held] = await reserve(newOrder(), [[line, item, '8']]);
    expect(held!.reserved.toString()).toBe('5');
    expect(await balanceOf(item)).toEqual({
      quantity: '5.000',
      reserved: '5.000',
      available: '0.000',
    });
    expect(await inconsistent()).toEqual([]);
  });

  it('shows who reserved an item, and available stock in lists and searches', async () => {
    const item = await itemWith('10');
    const order = newOrder();
    await reserve(order, [[uuidv7(), item, '4']]);
    const { body } = await api().get(`/stock/items/${item}`).expect(200);
    expect(body).toMatchObject({
      quantity: '10.000',
      reservedQuantity: '4.000',
      availableQuantity: '6.000',
    });
    expect(body.reservations).toEqual([
      {
        warehouseId: w1,
        warehouseCode: 'RES',
        originType: 'order',
        originId: order.id,
        originReference: order.reference,
        quantity: '4.000',
      },
    ]);
    const list = await api().get(`/stock?warehouseId=${w1}&q=RS-${suffix}`).expect(200);
    expect(list.body.items.find((r: { itemId: string }) => r.itemId === item)).toMatchObject({
      quantity: '10.000',
      reservedQuantity: '4.000',
      availableQuantity: '6.000',
    });
    const search = await api()
      .get(`/stock/items-search?warehouseId=${w1}&q=RS-${suffix}`)
      .expect(200);
    expect(search.body.find((o: { id: string }) => o.id === item)).toMatchObject({
      quantity: '10.000',
      availableQuantity: '6.000',
    });
  });

  it('compares the reorder point with available stock', async () => {
    const item = await itemWith('10');
    await request(app.getHttpServer())
      .put(`/api/stock/reorder-levels/${w1}/${item}`)
      .set(bearer(token))
      .set('X-Company-Id', world.companies.a)
      .send({ reorderPoint: '5' })
      .expect(200);
    expect(
      (await api().get(`/stock/items/${item}`).expect(200)).body.warehouses[0].belowReorder,
    ).toBe(false);
    await reserve(newOrder(), [[uuidv7(), item, '6']]);
    const { body } = await api().get(`/stock/items/${item}`).expect(200);
    expect(body.warehouses[0].belowReorder).toBe(true);
  });

  it('keeps promised goods from leaving with a free issue, a transfer or a reversal', async () => {
    const item = await itemWith('10');
    await reserve(newOrder(), [[uuidv7(), item, '8']]);
    const refused = await api().post('/stock-documents').send(internalUse(item, '3')).expect(409);
    expect(refused.body).toMatchObject({
      code: 'STOCK_INSUFFICIENT',
      errors: [{ field: 'lines[0].quantity', code: 'STOCK_INSUFFICIENT' }],
    });
    await api().post('/stock-documents').send(internalUse(item, '2')).expect(201);

    // A received document cannot be reversed once its goods are promised.
    const other = await itemWith('0');
    const receipt = await api()
      .post('/stock-documents')
      .send({
        id: uuidv7(),
        reason: 'OPENING',
        warehouseId: w1,
        lines: [{ itemId: other, quantity: '3' }],
      })
      .expect(201);
    await reserve(newOrder(), [[uuidv7(), other, '1']]);
    const reversal = await api().post(`/stock-documents/${receipt.body.id}/reverse`).expect(409);
    expect(reversal.body.code).toBe('STOCK_INSUFFICIENT');
    expect(await balanceOf(item)).toMatchObject({ quantity: '8.000', available: '0.000' });
  });

  it('refuses an inventory count below what is reserved', async () => {
    const item = await itemWith('10');
    await reserve(newOrder(), [[uuidv7(), item, '6']]);
    const count = (counted: string) => ({
      id: uuidv7(),
      reason: 'INVENTORY_ADJUSTMENT',
      warehouseId: w1,
      lines: [{ itemId: item, countedQuantity: counted }],
    });
    const refused = await api().post('/stock-documents').send(count('5')).expect(409);
    expect(refused.body).toMatchObject({
      code: 'STOCK_RESERVED',
      errors: [{ field: 'lines[0].countedQuantity', code: 'STOCK_RESERVED' }],
    });
    await api().post('/stock-documents').send(count('6')).expect(201);
    expect(await balanceOf(item)).toEqual({
      quantity: '6.000',
      reserved: '6.000',
      available: '0.000',
    });
  });

  it('shrinks and releases reservations, freed goods going to the next line', async () => {
    const item = await itemWith('5');
    const order = newOrder();
    const [first, second] = [uuidv7(), uuidv7()];
    await reserve(order, [[first, item, '5']]);
    const held = await reserve(order, [
      [second, item, '3'],
      [first, item, '2'],
    ]);
    expect(Object.fromEntries(held.map((h) => [h.originLineId, h.reserved.toString()]))).toEqual({
      [first]: '2',
      [second]: '3',
    });
    await inTenant((tx) => warehouse.release(tx, company(), order, [first, second]));
    expect(await balanceOf(item)).toMatchObject({ reserved: '0.000', available: '5.000' });
    const left = await inTenant((tx) => warehouse.reservedFor(tx, 'order', [first, second]));
    expect(left.size).toBe(0);
    expect(await inconsistent()).toEqual([]);
  });

  describe('documents made by another module', () => {
    it('take goods from their reservation first, then from free stock', async () => {
      const item = await itemWith('10');
      const order = newOrder();
      const line = uuidv7();
      await reserve(order, [[line, item, '4']]);
      await reserve(newOrder(), [[uuidv7(), item, '3']]);
      // 6 out: 4 from the reservation, 2 of the 3 free ones; the other order keeps its 3.
      const posted = await inTenant((tx) =>
        warehouse.postDocument(
          tx,
          company(),
          { ...internalUse(item, '6'), reason: 'SALE_ISSUE' } as never,
          { origin: order, reservations: [line] },
        ),
      );
      expect(posted.origin).toEqual(order);
      expect(await balanceOf(item)).toEqual({
        quantity: '4.000',
        reserved: '3.000',
        available: '1.000',
      });
      expect((await inTenant((tx) => warehouse.reservedFor(tx, 'order', [line]))).size).toBe(0);
      expect(await inconsistent()).toEqual([]);
    });

    it('cannot take what another order holds', async () => {
      const item = await itemWith('5');
      const order = newOrder();
      const line = uuidv7();
      await reserve(order, [[line, item, '2']]);
      await reserve(newOrder(), [[uuidv7(), item, '3']]);
      const failed = inTenant((tx) =>
        warehouse.postDocument(
          tx,
          company(),
          { ...internalUse(item, '3'), reason: 'SALE_ISSUE' } as never,
          { origin: order, reservations: [line] },
        ),
      );
      await expect(failed).rejects.toMatchObject({ code: 'STOCK_INSUFFICIENT' });
      // Nothing happened: the transaction rolled back the consumption too.
      expect(await balanceOf(item)).toEqual({
        quantity: '5.000',
        reserved: '5.000',
        available: '0.000',
      });
    });

    it('are reversed only by their origin, never through the API', async () => {
      const item = await itemWith('5');
      const order = newOrder();
      const posted = await inTenant((tx) =>
        warehouse.postDocument(
          tx,
          company(),
          { ...internalUse(item, '2'), reason: 'SALE_ISSUE' } as never,
          {
            origin: order,
          },
        ),
      );
      const refused = await api().post(`/stock-documents/${posted.id}/reverse`).expect(409);
      expect(refused.body.code).toBe('DOCUMENT_HAS_ORIGIN');
      const detail = await api().get(`/stock-documents/${posted.id}`).expect(200);
      expect(detail.body.origin).toEqual(order);

      const stranger = inTenant((tx) =>
        warehouse.reverseDocument(tx, company(), posted.id, { origin: newOrder() }),
      );
      await expect(stranger).rejects.toBeInstanceOf(DomainException);
      await expect(stranger).rejects.toMatchObject({ code: 'DOCUMENT_HAS_ORIGIN' });

      const reversal = await inTenant((tx) =>
        warehouse.reverseDocument(tx, company(), posted.id, { origin: order }),
      );
      expect(reversal.origin).toEqual(order);
      expect(await balanceOf(item)).toMatchObject({ quantity: '5.000' });
    });
  });

  describe('concurrency', () => {
    it('never reserves more than there is, with ten orders at once', async () => {
      const item = await itemWith('5');
      const held = await Promise.all(
        Array.from({ length: 10 }, () => reserve(newOrder(), [[uuidv7(), item, '1']])),
      );
      const total = held.flat().reduce((sum, h) => sum.plus(h.reserved), new Prisma.Decimal(0));
      expect(total.toString()).toBe('5');
      expect(await balanceOf(item)).toEqual({
        quantity: '5.000',
        reserved: '5.000',
        available: '0.000',
      });
      expect(await inconsistent()).toEqual([]);
    });

    it('lets free issues and reservations share the stock without promising goods that left', async () => {
      const item = await itemWith('5');
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          i % 2 === 0
            ? reserve(newOrder(), [[uuidv7(), item, '1']]).then((h) => h[0]!.reserved.toNumber())
            : api()
                .post('/stock-documents')
                .send(internalUse(item, '1'))
                .then((r) => (r.status === 201 ? 1 : 0)),
        ),
      );
      const taken = results.reduce(
        (sum, r) => sum + (r.status === 'fulfilled' ? r.value : Number.NaN),
        0,
      );
      expect(taken).toBe(5);
      const balance = await balanceOf(item);
      expect(balance.available).toBe('0.000');
      expect(await inconsistent()).toEqual([]);
    });
  });

  describe('database guards', () => {
    it('refuses, whatever the code does, more reserved than in stock', async () => {
      const item = await itemWith('2');
      await expect(
        admin.$executeRaw`UPDATE stock_balances SET reserved_quantity = 3
                          WHERE warehouse_id = ${w1}::uuid AND item_id = ${item}::uuid`,
      ).rejects.toThrow(/stock_balances_reserved_within_stock/);
    });

    it('reports a reserved quantity that differs from the reservations', async () => {
      const item = await itemWith('4');
      await reserve(newOrder(), [[uuidv7(), item, '1']]);
      await admin.$executeRaw`UPDATE stock_balances SET reserved_quantity = 2
                              WHERE warehouse_id = ${w1}::uuid AND item_id = ${item}::uuid`;
      expect(await inconsistent()).toMatchObject([{ itemId: item }]);
      await admin.$executeRaw`UPDATE stock_balances SET reserved_quantity = 1
                              WHERE warehouse_id = ${w1}::uuid AND item_id = ${item}::uuid`;
      expect(await inconsistent()).toEqual([]);
    });

    it('shows another tenant nothing through the published stock view', async () => {
      const item = await itemWith('3');
      const seen = await database.runAs(
        { tenantId: world.tenants.b },
        (tx) =>
          tx.$queryRaw<unknown[]>`SELECT 1 FROM warehouse_stock_refs WHERE item_id = ${item}::uuid`,
      );
      expect(seen).toEqual([]);
      const own = await inTenant(
        (tx) =>
          tx.$queryRaw<{ available: Prisma.Decimal }[]>`
          SELECT available_quantity AS available FROM warehouse_stock_refs
          WHERE item_id = ${item}::uuid`,
      );
      expect(own.map((r) => r.available.toString())).toEqual(['3']);
    });
  });
});
