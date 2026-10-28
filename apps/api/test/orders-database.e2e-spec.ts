import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { TenantDatabase } from '../src/prisma/index.js';
import { createTestApp } from './support/auth.js';
import {
  adminClient,
  createWorld,
  deleteTenantsAndUsers,
  uniqueSuffix,
  uuidv7,
  type World,
} from './support/database.js';

// The tables of the orders module, before any code writes them (docs/adr/0024): what the
// database refuses whatever the code does. Rows are written by the owner role, which bypasses
// Row-Level Security; the API role is used where its privileges or isolation are the point.
describe('orders tables (e2e)', () => {
  let admin: PrismaClient;
  let world: World;
  let database: TenantDatabase;
  let close: () => Promise<void>;
  const suffix = uniqueSuffix();
  const ids = {} as Record<'party' | 'item' | 'warehouse' | 'document', string>;

  beforeAll(async () => {
    admin = adminClient();
    world = await createWorld(admin);
    const app = await createTestApp();
    database = app.get(TenantDatabase);
    close = () => app.close();
    const tenantId = world.tenants.a;
    ids.party = (
      await admin.party.create({
        data: {
          tenantId,
          kind: 'COMPANY',
          isCustomer: true,
          isSupplier: true,
          name: `Cliente ${suffix}`,
        },
      })
    ).id;
    ids.item = (
      await admin.item.create({
        data: { tenantId, code: `OR-${suffix}`, description: 'Vite', unit: 'PZ', vatCode: '22' },
      })
    ).id;
    ids.warehouse = (
      await admin.warehouse.create({
        data: { tenantId, companyId: world.companies.a, code: 'ORD', name: 'Ordini' },
      })
    ).id;
    ids.document = (
      await admin.stockDocument.create({
        data: {
          tenantId,
          companyId: world.companies.a,
          reason: 'SALE_ISSUE',
          series: 'SC',
          year: 2026,
          number: 1,
          documentDate: new Date('2026-10-28'),
          warehouseId: ids.warehouse,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await close?.();
    if (world) {
      await deleteTenantsAndUsers(admin, Object.values(world.tenants), Object.values(world.users));
    }
    await admin.$disconnect();
  });

  let number = 0;
  const order = (data: Partial<Prisma.OrderUncheckedCreateInput> = {}) =>
    admin.order.create({
      data: {
        tenantId: world.tenants.a,
        companyId: world.companies.a,
        kind: 'SALES',
        orderDate: new Date('2026-10-28'),
        partyId: ids.party,
        ...data,
      },
    });
  const confirmed = (data: Partial<Prisma.OrderUncheckedCreateInput> = {}) =>
    order({
      status: 'CONFIRMED',
      series: 'OC',
      year: 2026,
      number: ++number,
      confirmedAt: new Date(),
      warehouseId: ids.warehouse,
      ...data,
    });
  const line = (orderId: string, data: Partial<Prisma.OrderLineUncheckedCreateInput> = {}) =>
    admin.orderLine.create({
      data: {
        tenantId: world.tenants.a,
        companyId: world.companies.a,
        orderId,
        lineNo: 1,
        itemId: ids.item,
        description: 'Vite',
        unit: 'PZ',
        quantity: new Prisma.Decimal('10'),
        vatCode: '22',
        vatRate: new Prisma.Decimal('22'),
        ...data,
      },
    });

  it('numbers an order only once confirmed, in the series of its kind, with a warehouse', async () => {
    await expect(order({ series: 'OC', year: 2026, number: 99 })).rejects.toThrow(
      /orders_number_when_confirmed/,
    );
    await expect(confirmed({ warehouseId: null })).rejects.toThrow(/orders_number_when_confirmed/);
    await expect(confirmed({ kind: 'PURCHASE' })).rejects.toThrow(/orders_series_of_kind/);
    await expect(confirmed({ status: 'CANCELLED' })).rejects.toThrow(/orders_cancelled_at/);
    await expect(order({ requestedDate: new Date('2026-10-27') })).rejects.toThrow(
      /orders_requested_after_order/,
    );
    const first = await confirmed();
    await expect(confirmed({ number: first.number })).rejects.toThrow(/Unique constraint/);
    await expect(order()).resolves.toMatchObject({ status: 'DRAFT', number: null });
  });

  it('never moves or closes more of a line than was ordered', async () => {
    const { id } = await confirmed();
    await expect(
      line(id, { doneQuantity: new Prisma.Decimal('7'), closedQuantity: new Prisma.Decimal('4') }),
    ).rejects.toThrow(/order_lines_progress_within_quantity/);
    await expect(line(id, { unitPrice: new Prisma.Decimal('1') })).rejects.toThrow(
      /order_lines_amount_with_price/,
    );
    await expect(line(id, { discountPercent: new Prisma.Decimal('101') })).rejects.toThrow(
      /order_lines_discount_percentage/,
    );
    await expect(
      line(id, { doneQuantity: new Prisma.Decimal('6'), closedQuantity: new Prisma.Decimal('4') }),
    ).resolves.toBeDefined();
  });

  it('keeps a fulfilment to the lines of its own order', async () => {
    const mine = await confirmed();
    const other = await confirmed();
    const otherLine = await line(other.id);
    const fulfilment = await admin.orderFulfilment.create({
      data: {
        id: uuidv7(),
        tenantId: world.tenants.a,
        companyId: world.companies.a,
        orderId: mine.id,
        stockDocumentId: ids.document,
        fulfilmentDate: new Date('2026-10-28'),
      },
    });
    await expect(
      admin.orderFulfilmentLine.create({
        data: {
          tenantId: world.tenants.a,
          orderId: mine.id,
          fulfilmentId: fulfilment.id,
          orderLineId: otherLine.id,
          quantity: new Prisma.Decimal('1'),
        },
      }),
    ).rejects.toThrow(/Foreign key constraint/);
    // One stock document records one fulfilment.
    await expect(
      admin.orderFulfilment.create({
        data: {
          id: uuidv7(),
          tenantId: world.tenants.a,
          companyId: world.companies.a,
          orderId: other.id,
          stockDocumentId: ids.document,
          fulfilmentDate: new Date('2026-10-28'),
        },
      }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it('lets the API role change neither the kind of an order nor a recorded fulfilment line', async () => {
    const { id } = await confirmed();
    const asApi = (sql: Prisma.Sql) =>
      database.runAs({ tenantId: world.tenants.a }, (tx) => tx.$executeRaw(sql));
    await expect(
      asApi(Prisma.sql`UPDATE orders SET kind = 'PURCHASE' WHERE id = ${id}::uuid`),
    ).rejects.toThrow(/permission denied/);
    await expect(asApi(Prisma.sql`UPDATE order_fulfilment_lines SET quantity = 1`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(asApi(Prisma.sql`DELETE FROM order_fulfilments`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it('shows another tenant none of these orders', async () => {
    const { id } = await confirmed();
    const seen = await database.runAs({ tenantId: world.tenants.b }, (tx) =>
      tx.order.findMany({ where: { id } }),
    );
    expect(seen).toEqual([]);
    const own = await database.runAs({ tenantId: world.tenants.a }, (tx) =>
      tx.order.findMany({ where: { id } }),
    );
    expect(own).toHaveLength(1);
  });
});
