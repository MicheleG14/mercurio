import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { addDays, businessToday } from '../src/shared/dates.js';
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

// Statistics of the overview (docs/adr/0032): sums of documents with amounts worked out by hand,
// per company, with the permissions of the pages the data comes from.
describe('overview statistics (e2e)', () => {
  let app: NestExpressApplication;
  let admin: PrismaClient;
  let world: World;
  let emptyCompany: string;
  const token = {} as Record<'admin' | 'keeper' | 'other', string>;
  const extraUsers: string[] = [];
  const suffix = uniqueSuffix();
  const http = () => request(app.getHttpServer());
  const today = businessToday();
  const tenDaysAgo = addDays(today, -10);
  const yearOf = (date: string) => Number(date.slice(0, 4));
  const monthOf = (date: string) => Number(date.slice(5, 7));

  const as = (who: keyof typeof token, company: string | null = world.companies.a) => {
    const set = (r: request.Test) => {
      r.set(bearer(token[who]));
      return company ? r.set('X-Company-Id', company) : r;
    };
    return {
      get: (url: string) => set(http().get(`/api${url}`)),
      post: (url: string, body: object = {}) => set(http().post(`/api${url}`)).send(body),
      put: (url: string, body: object) => set(http().put(`/api${url}`)).send(body),
    };
  };

  const ids = {} as Record<'customer' | 'warehouse', string>;
  const invoices = {} as Record<'old' | 'credited', { id: string; dueDates: { id: string }[] }>;

  beforeAll(async () => {
    admin = adminClient();
    world = await createWorld(admin);
    await admin.tenantModule.createMany({
      data: ['warehouse', 'orders', 'invoicing'].map((moduleKey) => ({
        tenantId: world.tenants.a,
        moduleKey,
      })),
    });
    emptyCompany = (
      await admin.company.create({
        data: { tenantId: world.tenants.a, legalName: 'A Vuota Srl', vatNumber: '00000000009' },
      })
    ).id;
    app = await createTestApp();
    const signedIn = (await activate(app, admin, world.users.u)).accessToken;
    token.admin = (
      await http()
        .post('/api/auth/tenant')
        .set(bearer(signedIn))
        .send({ tenantId: world.tenants.a })
        .expect(200)
    ).body.accessToken;
    token.other = (await activate(app, admin, world.users.v)).accessToken;
    const keeper = await admin.user.create({
      data: { email: `keeper-stats-${suffix}@example.com`, name: 'Keeper' },
    });
    extraUsers.push(keeper.id);
    await admin.membership.create({
      data: {
        tenantId: world.tenants.a,
        userId: keeper.id,
        role: 'WAREHOUSE_KEEPER',
        allCompanies: true,
      },
    });
    token.keeper = (await activate(app, admin, keeper.id)).accessToken;

    // The company can issue invoices; one customer with complete data.
    const company = (await as('admin').get('/companies/current').expect(200)).body;
    await as('admin')
      .put('/companies/current', {
        version: company.version,
        address: 'Via Roma 1',
        postalCode: '20121',
        city: 'Milano',
        province: 'MI',
        iban: 'IT60X0542811101000000123456',
      })
      .expect(200);
    const first10 = (Number.parseInt(suffix, 16) % 1e6).toString().padStart(6, '7') + '0001';
    ids.customer = (
      await as('admin', null)
        .post('/parties', {
          kind: 'COMPANY',
          isCustomer: true,
          isSupplier: false,
          legalName: `Cliente statistiche ${suffix} Srl`,
          vatNumber: first10 + italianCheckDigit(first10),
          address: 'Via Torino 12',
          postalCode: '20123',
          city: 'Milano',
          province: 'MI',
          sdiCode: 'ABC1234',
        })
        .expect(201)
    ).body.id;
    ids.warehouse = (
      await as('admin').post('/warehouses', { code: 'STA', name: 'Statistiche' }).expect(201)
    ).body.id;

    // Invoicing. 10 days ago, due at once: 100.00 + 22% = 122.00, then 22.00 paid.
    const issued = async (lines: object[], paymentTerms: string, issueDate: string) => {
      const draft = (
        await as('admin')
          .post('/invoice-drafts', { id: uuidv7(), partyId: ids.customer, lines, paymentTerms })
          .expect(201)
      ).body;
      const res = await as('admin').post(`/invoice-drafts/${draft.id}/issue`, {
        version: draft.version,
        issueDate,
      });
      expect(res.body, JSON.stringify(res.body)).toMatchObject({ id: draft.id });
      return res.body;
    };
    invoices.old = await issued(
      [{ description: 'Consulenza', quantity: '1', unitPrice: '100', vatCode: '22' }],
      'RD',
      tenDaysAgo,
    );
    // Today, then credited in full: 50.00 + 10% = 55.00 and back to nothing.
    invoices.credited = await issued(
      [{ description: 'Corso', quantity: '2', unitPrice: '25', vatCode: '10' }],
      '30DF',
      today,
    );
    const note = (
      await as('admin')
        .post(`/invoices/${invoices.credited.id}/credit-note`, { id: uuidv7() })
        .expect(201)
    ).body;
    await as('admin')
      .post(`/invoice-drafts/${note.id}/issue`, { version: note.version, issueDate: today })
      .expect(201);
    const pay = (amount: string) =>
      as('admin')
        .post('/payments', {
          id: uuidv7(),
          partyId: ids.customer,
          amount,
          method: 'MP05',
          allocations: [{ dueDateId: invoices.old.dueDates[0]!.id, amount }],
        })
        .expect(201);
    await pay('22.00');
    // Paid and undone: counts for nothing.
    const undone = (await pay('10.00')).body;
    await as('admin').post(`/payments/${undone.id}/reverse`).expect(200);

    // Warehouse and orders. Two openings stay, a third is reversed: neither it nor its reversal
    // counts. The shipment is the only issue.
    const item = async (code: string, quantity: string) => {
      const id = (
        await as('admin', null)
          .post('/items', {
            code: `${code}-${suffix}`,
            description: code,
            unit: 'PZ',
            vatCode: '22',
          })
          .expect(201)
      ).body.id as string;
      await as('admin')
        .post('/stock-documents', {
          id: uuidv7(),
          reason: 'OPENING',
          warehouseId: ids.warehouse,
          lines: [{ itemId: id, quantity }],
        })
        .expect(201);
      return id;
    };
    const drill = await item('ST-TRAP', '10');
    const screw = await item('ST-VITE', '10');
    const reversed = (
      await as('admin')
        .post('/stock-documents', {
          id: uuidv7(),
          reason: 'OPENING',
          warehouseId: ids.warehouse,
          lines: [{ itemId: drill, quantity: '1' }],
        })
        .expect(201)
    ).body;
    await as('admin').post(`/stock-documents/${reversed.id}/reverse`).expect(201);

    // 4 × 12.50 less 10% = 45.00; 3 × 0.3333 = 0.9999 → 1.00. Ordered 46.00.
    const created = (
      await as('admin')
        .post('/orders', {
          id: uuidv7(),
          kind: 'SALES',
          partyId: ids.customer,
          warehouseId: ids.warehouse,
          lines: [
            { itemId: drill, quantity: '4', unitPrice: '12.5', discountPercent: '10' },
            { itemId: screw, quantity: '3', unitPrice: '0.3333' },
          ],
        })
        .expect(201)
    ).body;
    const order = (
      await as('admin').post(`/orders/${created.id}/confirm`, { version: 1 }).expect(200)
    ).body;
    // One drill shipped: 1 × 12.50 less 10% = 11.25. Left: 3 drills (33.75) and the screws (1.00).
    await as('admin')
      .post(`/orders/${order.id}/fulfilments`, {
        id: uuidv7(),
        lines: [{ orderLineId: order.lines[0].id, quantity: '1' }],
      })
      .expect(201);
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

  type Month = { month: number; taxable: string; vat: string; total: string; collected: string };

  it('sums invoices less credit notes, and payments less reversals, month by month', async () => {
    const expected = new Map<number, Map<number, Partial<Month>>>();
    const put = (date: string, values: Partial<Month>) => {
      const months = expected.get(yearOf(date)) ?? new Map<number, Partial<Month>>();
      months.set(monthOf(date), { ...months.get(monthOf(date)), ...values });
      expected.set(yearOf(date), months);
    };
    put(tenDaysAgo, { taxable: '100.00', vat: '22.00', total: '122.00' });
    // The credited invoice and its note are both of today: they cancel out.
    put(today, { collected: '22.00' });
    if (monthOf(today) !== monthOf(tenDaysAgo) || yearOf(today) !== yearOf(tenDaysAgo)) {
      put(today, { taxable: '0.00', vat: '0.00', total: '0.00' });
    }

    for (const [year, months] of expected) {
      const stats = (await as('admin').get(`/invoicing/stats?year=${year}`).expect(200)).body;
      expect(stats.year).toBe(year);
      expect(stats.months).toHaveLength(12);
      for (const row of stats.months as Month[]) {
        expect(row).toEqual({
          month: row.month,
          taxable: '0.00',
          vat: '0.00',
          total: '0.00',
          collected: '0.00',
          ...months.get(row.month),
        });
      }
      expect(stats.years).toEqual([...expected.keys()].sort((a, b) => b - a));
    }
  });

  it('ranks the customers of the year with what they still owe', async () => {
    const stats = (await as('admin').get('/invoicing/stats').expect(200)).body;
    expect(stats.year).toBe(yearOf(today));
    const invoicedThisYear = yearOf(tenDaysAgo) === yearOf(today);
    expect(stats.topCustomers).toEqual(
      invoicedThisYear
        ? [{ partyId: ids.customer, name: expect.any(String), taxable: '100.00', open: '100.00' }]
        : [],
    );
  });

  it('puts what is owed in the bucket of its delay', async () => {
    const aging = (await as('admin').get('/invoicing/aging').expect(200)).body;
    expect(aging.asOf).toBe(today);
    expect(aging.total).toBe('100.00');
    expect(aging.buckets).toEqual([
      { bucket: 'NOT_DUE', amount: '0.00', count: 0 },
      // Due 10 days ago, 122.00 less 22.00 paid.
      { bucket: 'DAYS_1_30', amount: '100.00', count: 1 },
      { bucket: 'DAYS_31_60', amount: '0.00', count: 0 },
      { bucket: 'DAYS_61_90', amount: '0.00', count: 0 },
      { bucket: 'OVER_90', amount: '0.00', count: 0 },
    ]);
  });

  it('values sales ordered, shipped and still to ship', async () => {
    const stats = (await as('admin').get('/orders/stats').expect(200)).body;
    const month = stats.months[monthOf(today) - 1];
    expect(month).toEqual({ month: monthOf(today), ordered: '46.00', shipped: '11.25' });
    expect(stats.months.filter((m: { ordered: string }) => m.ordered !== '0.00')).toHaveLength(1);
    expect(stats.backlog).toBe('34.75');
    expect(stats.backlogCustomers).toEqual([
      { partyId: ids.customer, name: expect.any(String), amount: '34.75' },
    ]);
    expect(stats.years).toEqual([yearOf(today)]);
  });

  it('counts stock documents by type, leaving out a reversed one and its reversal', async () => {
    const stats = (await as('admin').get('/stock/stats').expect(200)).body;
    expect(stats.months[monthOf(today) - 1]).toEqual({
      month: monthOf(today),
      receipt: 2,
      issue: 1,
      adjustment: 0,
      transfer: 0,
    });
    expect(stats.years).toEqual([yearOf(today)]);
  });

  it('shows each company its own figures only', async () => {
    const invoicing = (await as('admin', emptyCompany).get('/invoicing/stats').expect(200)).body;
    expect(invoicing.years).toEqual([]);
    expect(invoicing.topCustomers).toEqual([]);
    expect(invoicing.months.every((m: Month) => m.taxable === '0.00')).toBe(true);
    const aging = (await as('admin', emptyCompany).get('/invoicing/aging').expect(200)).body;
    expect(aging.total).toBe('0.00');
    const orders = (await as('admin', emptyCompany).get('/orders/stats').expect(200)).body;
    expect(orders.backlog).toBe('0.00');
    const stock = (await as('admin', emptyCompany).get('/stock/stats').expect(200)).body;
    expect(stock.years).toEqual([]);
  });

  it('asks for the permission of the page the figures come from', async () => {
    await as('keeper').get('/invoicing/stats').expect(403);
    await as('keeper').get('/invoicing/aging').expect(403);
    await as('keeper').get('/stock/stats').expect(200);
    // Another tenant without the modules.
    const other = await as('other', world.companies.b).get('/invoicing/stats').expect(403);
    expect(other.body.code).toBe('MODULE_NOT_ENABLED');
  });

  it('refuses a year out of range', async () => {
    const res = await as('admin').get('/invoicing/stats?year=1999').expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors).toEqual([{ field: 'year', code: 'MIN' }]);
  });
});
