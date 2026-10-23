import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { MembershipRole, PrismaClient } from '../src/generated/prisma/client.js';
import { italianCheckDigit } from '../src/shared/italian-identifiers.js';
import { businessToday } from '../src/modules/warehouse/index.js';
import { activate, bearer, createTestApp } from './support/auth.js';
import {
  adminClient,
  createWorld,
  deleteTenantsAndUsers,
  uniqueSuffix,
  uuidv7,
  type World,
} from './support/database.js';

// The warehouse end to end: real application, real database, the API role subject to Row-Level
// Security. Tenant A has the warehouse module and two companies (a, a2); B does not have the
// module. Concurrency is real: parallel requests go through the connection pool, each in its own
// transaction.
describe('warehouse (e2e)', () => {
  let app: NestExpressApplication;
  let admin: PrismaClient;
  let world: World;
  let companyA2: string;
  const token: Record<'admin' | 'other' | 'keeper' | MembershipRole, string> = {} as never;
  const extraUsers: string[] = [];
  const suffix = uniqueSuffix();
  const http = () => request(app.getHttpServer());
  const today = businessToday();
  const year = Number(today.slice(0, 4));

  let counter = 0;
  const newVat = () => {
    const first10 =
      (Number.parseInt(suffix, 16) % 1e6).toString().padStart(6, '2') +
      String(++counter).padStart(4, '0');
    return first10 + italianCheckDigit(first10);
  };

  beforeAll(async () => {
    admin = adminClient();
    world = await createWorld(admin);
    companyA2 = (
      await admin.company.create({
        data: { tenantId: world.tenants.a, legalName: 'A Logistica Srl', vatNumber: '00000000005' },
      })
    ).id;
    await admin.tenantModule.create({
      data: { tenantId: world.tenants.a, moduleKey: 'warehouse' },
    });
    app = await createTestApp();
    token.admin = (await activate(app, admin, world.users.u)).accessToken;
    const chosen = await http()
      .post('/api/auth/tenant')
      .set(bearer(token.admin))
      .send({ tenantId: world.tenants.a })
      .expect(200);
    token.admin = chosen.body.accessToken;
    token.ADMIN = token.admin;
    token.other = (await activate(app, admin, world.users.v)).accessToken;
    const people: [keyof typeof token, MembershipRole, boolean][] = [
      ['WAREHOUSE_KEEPER', 'WAREHOUSE_KEEPER', true],
      ['ACCOUNTANT', 'ACCOUNTANT', true],
      ['READ_ONLY', 'READ_ONLY', true],
      // A keeper who reaches only company a.
      ['keeper', 'WAREHOUSE_KEEPER', false],
    ];
    for (const [key, role, allCompanies] of people) {
      const user = await admin.user.create({
        data: { email: `${String(key).toLowerCase()}-wh-${suffix}@example.com`, name: String(key) },
      });
      extraUsers.push(user.id);
      const membership = await admin.membership.create({
        data: { tenantId: world.tenants.a, userId: user.id, role, allCompanies },
      });
      if (!allCompanies) {
        await admin.membershipCompany.create({
          data: {
            tenantId: world.tenants.a,
            membershipId: membership.id,
            companyId: world.companies.a,
          },
        });
      }
      token[key] = (await activate(app, admin, user.id)).accessToken;
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

  /** Requests on behalf of someone, in a company (a by default). */
  const as = (who: keyof typeof token, company: string | null = world.companies.a) => {
    const set = (r: request.Test) => {
      r.set(bearer(token[who]));
      return company ? r.set('X-Company-Id', company) : r;
    };
    return {
      get: (url: string) => set(http().get(`/api${url}`)),
      post: (url: string, body: object = {}) => set(http().post(`/api${url}`)).send(body),
      put: (url: string, body: object) => set(http().put(`/api${url}`)).send(body),
      patch: (url: string, body: object) => set(http().patch(`/api${url}`)).send(body),
      delete: (url: string) => set(http().delete(`/api${url}`)),
    };
  };

  // Registry and warehouses for the whole file, made through the API like a person would.
  const ids = {} as Record<
    'pz' | 'kg' | 'service' | 'supplier' | 'customer' | 'w1' | 'w2' | 'w3',
    string
  >;
  const newItem = async (unit = 'PZ', extra: object = {}) =>
    (
      await as('admin', null)
        .post('/items', {
          code: `WH-${suffix}-${++counter}`,
          description: `Articolo ${counter}`,
          unit,
          vatCode: '22',
          ...extra,
        })
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    ids.pz = await newItem();
    ids.kg = await newItem('KG');
    ids.service = await newItem('H', { stockManaged: false });
    const party = (isCustomer: boolean, isSupplier: boolean) =>
      as('admin', null)
        .post('/parties', {
          kind: 'COMPANY',
          isCustomer,
          isSupplier,
          legalName: `Soggetto ${suffix} ${++counter} Srl`,
          vatNumber: newVat(),
        })
        .expect(201);
    ids.supplier = (await party(false, true)).body.id;
    ids.customer = (await party(true, false)).body.id;
    ids.w1 = (
      await as('admin').post('/warehouses', { code: 'sede', name: 'Sede' }).expect(201)
    ).body.id;
    ids.w2 = (
      await as('admin').post('/warehouses', { code: 'DEP', name: 'Deposito' }).expect(201)
    ).body.id;
    ids.w3 = (
      await as('admin', companyA2).post('/warehouses', { code: 'HUB', name: 'Hub' }).expect(201)
    ).body.id;
  });

  const receipt = (lines: { itemId: string; quantity: string }[], extra: object = {}) => ({
    id: uuidv7(),
    reason: 'PURCHASE_RECEIPT',
    warehouseId: ids.w1,
    partyId: ids.supplier,
    partyDocumentRef: 'DDT 15',
    lines,
    ...extra,
  });
  const issue = (lines: { itemId: string; quantity: string }[], extra: object = {}) => ({
    id: uuidv7(),
    reason: 'INTERNAL_USE',
    warehouseId: ids.w1,
    lines,
    ...extra,
  });
  const stockOf = async (itemId: string) => {
    const { body } = await as('admin').get(`/stock/items/${itemId}`).expect(200);
    return Object.fromEntries(
      (body.warehouses as { warehouseCode: string; quantity: string }[]).map((w) => [
        w.warehouseCode,
        w.quantity,
      ]),
    );
  };
  /** Balances that differ from the sum of the movements, in tenant A. */
  const inconsistencies = () =>
    admin.$queryRaw<unknown[]>`
      SELECT b.warehouse_id, b.item_id FROM stock_balances b
      WHERE b.tenant_id = ${world.tenants.a}::uuid
        AND b.quantity <> (SELECT coalesce(sum(m.quantity), 0) FROM stock_movements m
                           WHERE m.warehouse_id = b.warehouse_id AND m.item_id = b.item_id)`;

  describe('warehouses', () => {
    it('stores codes uppercase, once per company, and renames with a version', async () => {
      const list = await as('READ_ONLY').get('/warehouses').expect(200);
      expect(list.body.items.map((w: { code: string }) => w.code)).toEqual(['DEP', 'SEDE']);
      const taken = await as('admin')
        .post('/warehouses', { code: ' Sede ', name: 'X' })
        .expect(409);
      expect(taken.body).toMatchObject({
        code: 'WAREHOUSE_CODE_TAKEN',
        errors: [{ field: 'code', code: 'WAREHOUSE_CODE_TAKEN' }],
      });
      // Another company may use the same code.
      await as('admin', companyA2)
        .post('/warehouses', { code: 'SEDE', name: 'Sede 2' })
        .expect(201);
      const invalid = await as('admin').post('/warehouses', { code: 'A B', name: '' }).expect(400);
      expect(invalid.body.errors).toEqual([
        { field: 'code', code: 'WAREHOUSE_CODE_INVALID' },
        { field: 'name', code: 'REQUIRED' },
      ]);

      const renamed = await as('admin')
        .patch(`/warehouses/${ids.w2}`, { version: 1, name: 'Deposito Nord' })
        .expect(200);
      expect(renamed.body).toMatchObject({ code: 'DEP', name: 'Deposito Nord', version: 2 });
      await as('admin').patch(`/warehouses/${ids.w2}`, { version: 1, name: 'X' }).expect(409);
    });

    it('lets only administrators set up warehouses', async () => {
      await as('WAREHOUSE_KEEPER').post('/warehouses', { code: 'K', name: 'K' }).expect(403);
      await as('ACCOUNTANT').get('/warehouses').expect(200);
    });

    it('archives a warehouse only when it is empty', async () => {
      const { body: w } = await as('admin')
        .post('/warehouses', { code: 'TMP', name: 'Tmp' })
        .expect(201);
      await as('admin')
        .post(
          '/stock-documents',
          receipt([{ itemId: ids.pz, quantity: '2' }], { warehouseId: w.id }),
        )
        .expect(201);
      const full = await as('admin')
        .post(`/warehouses/${w.id}/archive`, { version: 1 })
        .expect(409);
      expect(full.body.code).toBe('WAREHOUSE_NOT_EMPTY');
      await as('admin')
        .post('/stock-documents', issue([{ itemId: ids.pz, quantity: '2' }], { warehouseId: w.id }))
        .expect(201);
      await as('admin').post(`/warehouses/${w.id}/archive`, { version: 1 }).expect(200);
      const closed = await as('admin')
        .post(
          '/stock-documents',
          receipt([{ itemId: ids.pz, quantity: '1' }], { warehouseId: w.id }),
        )
        .expect(400);
      expect(closed.body.errors).toEqual([{ field: 'warehouseId', code: 'WAREHOUSE_ARCHIVED' }]);
    });
  });

  describe('documents', () => {
    it('records a receipt from a supplier, numbered in its series', async () => {
      const item = await newItem();
      const res = await as('WAREHOUSE_KEEPER')
        .post('/stock-documents', receipt([{ itemId: item, quantity: '10' }]))
        .expect(201);
      expect(res.body).toMatchObject({
        reason: 'PURCHASE_RECEIPT',
        type: 'receipt',
        documentDate: today,
        warehouseCode: 'SEDE',
        partyId: ids.supplier,
        partyDocumentRef: 'DDT 15',
        lineCount: 1,
        reversedBy: null,
        createdByName: 'WAREHOUSE_KEEPER',
      });
      expect(res.body.reference).toMatch(new RegExp(`^CA-${year}/\\d{4}$`));
      expect(res.body.lines).toEqual([
        expect.objectContaining({ lineNo: 1, itemId: item, quantity: '10.000', unit: 'PZ' }),
      ]);
      expect((await stockOf(item)).SEDE).toBe('10.000');
      const read = await as('READ_ONLY').get(`/stock-documents/${res.body.id}`).expect(200);
      expect(read.body).toEqual(res.body);
    });

    it('refuses to take out more than there is, on the right line', async () => {
      const item = await newItem();
      await as('admin')
        .post('/stock-documents', receipt([{ itemId: item, quantity: '3' }]))
        .expect(201);
      const res = await as('admin')
        .post(
          '/stock-documents',
          issue([
            { itemId: ids.kg, quantity: '0.001' },
            { itemId: item, quantity: '2' },
            { itemId: item, quantity: '2' },
          ]),
        )
        .expect(409);
      expect(res.body.code).toBe('STOCK_INSUFFICIENT');
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          { field: 'lines[1].quantity', code: 'STOCK_INSUFFICIENT' },
          { field: 'lines[2].quantity', code: 'STOCK_INSUFFICIENT' },
        ]),
      );
      expect((await stockOf(item)).SEDE).toBe('3.000');
      await as('admin')
        .post('/stock-documents', issue([{ itemId: item, quantity: '3' }]))
        .expect(201);
      expect((await stockOf(item)).SEDE).toBe('0.000');
    });

    it('moves goods between two warehouses of the company', async () => {
      const item = await newItem('KG');
      await as('admin')
        .post('/stock-documents', receipt([{ itemId: item, quantity: '5.5' }]))
        .expect(201);
      const res = await as('admin')
        .post('/stock-documents', {
          id: uuidv7(),
          reason: 'TRANSFER',
          warehouseId: ids.w1,
          targetWarehouseId: ids.w2,
          lines: [{ itemId: item, quantity: '2.25' }],
        })
        .expect(201);
      expect(res.body).toMatchObject({
        type: 'transfer',
        targetWarehouseCode: 'DEP',
        lineCount: 1,
      });
      expect(res.body.lines).toEqual([expect.objectContaining({ quantity: '2.250' })]);
      expect(await stockOf(item)).toMatchObject({ SEDE: '3.250', DEP: '2.250' });

      const same = await as('admin')
        .post('/stock-documents', {
          id: uuidv7(),
          reason: 'TRANSFER',
          warehouseId: ids.w1,
          targetWarehouseId: ids.w1,
          lines: [{ itemId: item, quantity: '1' }],
        })
        .expect(400);
      expect(same.body.errors).toEqual([{ field: 'targetWarehouseId', code: 'SAME_WAREHOUSE' }]);
      const otherCompany = await as('admin')
        .post('/stock-documents', {
          id: uuidv7(),
          reason: 'TRANSFER',
          warehouseId: ids.w1,
          targetWarehouseId: ids.w3,
          lines: [{ itemId: item, quantity: '1' }],
        })
        .expect(400);
      expect(otherCompany.body.errors).toEqual([
        { field: 'targetWarehouseId', code: 'WAREHOUSE_NOT_FOUND' },
      ]);
    });

    it('adjusts to what was counted, moving the difference', async () => {
      const item = await newItem();
      await as('admin')
        .post('/stock-documents', receipt([{ itemId: item, quantity: '7' }]))
        .expect(201);
      const res = await as('admin')
        .post('/stock-documents', {
          id: uuidv7(),
          reason: 'INVENTORY_ADJUSTMENT',
          warehouseId: ids.w1,
          lines: [{ itemId: item, countedQuantity: '4' }],
        })
        .expect(201);
      expect(res.body.reference).toMatch(/^RE-/);
      expect(res.body.lines).toEqual([
        expect.objectContaining({ quantity: '-3.000', countedQuantity: '4.000' }),
      ]);
      expect((await stockOf(item)).SEDE).toBe('4.000');
      const nothing = await as('admin')
        .post('/stock-documents', {
          id: uuidv7(),
          reason: 'INVENTORY_ADJUSTMENT',
          warehouseId: ids.w1,
          lines: [{ itemId: item, countedQuantity: '4' }],
        })
        .expect(400);
      expect(nothing.body.errors).toEqual([
        { field: 'lines[0].countedQuantity', code: 'NO_DIFFERENCE' },
      ]);
    });

    it('reports every broken rule on its field', async () => {
      const archived = await newItem();
      await as('admin').post(`/items/${archived}/archive`, { version: 1 }).expect(200);
      const res = await as('admin')
        .post('/stock-documents', {
          id: uuidv7(),
          reason: 'PURCHASE_RECEIPT',
          documentDate: '2000-01-01',
          warehouseId: ids.w1,
          partyId: ids.customer,
          lines: [
            { itemId: ids.pz, quantity: '1.5' },
            { itemId: ids.service, quantity: '1' },
            { itemId: archived, quantity: '1' },
            { itemId: ids.kg, quantity: '0' },
            { itemId: ids.kg, countedQuantity: '1' },
            { itemId: '0198a000-0000-7000-8000-000000000099', quantity: '1' },
          ],
        })
        .expect(400);
      expect(res.body.errors).toEqual([
        { field: 'documentDate', code: 'DATE_TOO_OLD' },
        { field: 'partyId', code: 'PARTY_WRONG_ROLE' },
        { field: 'lines[0].quantity', code: 'QUANTITY_DECIMALS' },
        { field: 'lines[1].itemId', code: 'ITEM_NOT_STOCK_MANAGED' },
        { field: 'lines[2].itemId', code: 'ITEM_ARCHIVED' },
        { field: 'lines[3].quantity', code: 'QUANTITY_NOT_POSITIVE' },
        { field: 'lines[4].countedQuantity', code: 'NOT_ALLOWED' },
        { field: 'lines[4].quantity', code: 'REQUIRED' },
        { field: 'lines[5].itemId', code: 'ITEM_NOT_FOUND' },
      ]);

      const loss = await as('admin')
        .post('/stock-documents', { ...issue([{ itemId: ids.pz, quantity: '1' }]), reason: 'LOSS' })
        .expect(400);
      expect(loss.body.errors).toEqual([{ field: 'notes', code: 'REQUIRED' }]);
      const future = await as('admin')
        .post(
          '/stock-documents',
          receipt([{ itemId: ids.pz, quantity: '1' }], {
            partyId: null,
            documentDate: '2999-01-01',
          }),
        )
        .expect(400);
      expect(future.body.errors).toEqual([
        { field: 'documentDate', code: 'DATE_IN_FUTURE' },
        { field: 'partyId', code: 'REQUIRED' },
      ]);
      const shape = await as('admin')
        .post('/stock-documents', {
          id: 'not-v7',
          reason: 'REVERSAL',
          warehouseId: ids.w1,
          lines: [],
        })
        .expect(400);
      expect(shape.body.errors).toEqual(
        expect.arrayContaining([
          { field: 'id', code: 'MATCHES' },
          { field: 'reason', code: 'IS_IN' },
          { field: 'lines', code: 'ARRAY_MIN_SIZE' },
        ]),
      );
    });

    it('lets an archived item only go out, to clear what is left', async () => {
      const item = await newItem();
      await as('admin')
        .post('/stock-documents', receipt([{ itemId: item, quantity: '2' }]))
        .expect(201);
      await as('admin').post(`/items/${item}/archive`, { version: 1 }).expect(200);
      await as('admin')
        .post('/stock-documents', issue([{ itemId: item, quantity: '2' }]))
        .expect(201);
      const search = await as('admin')
        .get(`/stock/items-search?warehouseId=${ids.w1}&q=${suffix}`)
        .expect(200);
      expect(search.body.some((o: { id: string }) => o.id === item)).toBe(false);
    });
  });

  describe('concurrency', () => {
    it('never takes out more than there is, whatever the timing', async () => {
      const item = await newItem();
      await as('admin')
        .post('/stock-documents', receipt([{ itemId: item, quantity: '5' }]))
        .expect(201);
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          as('admin').post('/stock-documents', issue([{ itemId: item, quantity: '1' }])),
        ),
      );
      const statuses = results.map((r) => r.status).sort((a, b) => a - b);
      expect(statuses).toEqual([201, 201, 201, 201, 201, 409, 409, 409, 409, 409]);
      expect(
        results.filter((r) => r.status === 409).every((r) => r.body.code === 'STOCK_INSUFFICIENT'),
      ).toBe(true);
      expect((await stockOf(item)).SEDE).toBe('0.000');
      expect(await inconsistencies()).toEqual([]);
    });

    it('does not deadlock when two documents touch the same items in opposite orders', async () => {
      const [x, y] = [await newItem(), await newItem()];
      await as('admin')
        .post(
          '/stock-documents',
          receipt([
            { itemId: x, quantity: '100' },
            { itemId: y, quantity: '100' },
          ]),
        )
        .expect(201);
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          as('admin').post(
            '/stock-documents',
            issue(
              i % 2
                ? [
                    { itemId: x, quantity: '1' },
                    { itemId: y, quantity: '1' },
                  ]
                : [
                    { itemId: y, quantity: '1' },
                    { itemId: x, quantity: '1' },
                  ],
            ),
          ),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
      expect(await stockOf(x)).toMatchObject({ SEDE: '92.000' });
      expect(await stockOf(y)).toMatchObject({ SEDE: '92.000' });
    });

    it('numbers simultaneous documents without gaps, and a failed one takes no number', async () => {
      const { body: w } = await as('admin', companyA2)
        .post('/warehouses', { code: 'NUM', name: 'Num' })
        .expect(201);
      const post = (lines: object[]) =>
        as('admin', companyA2).post('/stock-documents', {
          id: uuidv7(),
          reason: 'OPENING',
          warehouseId: w.id,
          lines,
        });
      await post([{ itemId: ids.service, quantity: '1' }]).expect(400);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => post([{ itemId: ids.pz, quantity: '1' }])),
      );
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
      const numbers = results
        .map((r) => Number(r.body.reference.split('/')[1]))
        .sort((a, b) => a - b);
      expect(numbers[numbers.length - 1]! - numbers[0]!).toBe(5);
      expect(new Set(numbers).size).toBe(6);
    });
  });

  describe('reversal', () => {
    it('moves the goods back once, and only once', async () => {
      const item = await newItem();
      const { body: original } = await as('admin')
        .post('/stock-documents', receipt([{ itemId: item, quantity: '4' }]))
        .expect(201);
      const results = await Promise.all(
        [1, 2, 3].map(() => as('admin').post(`/stock-documents/${original.id}/reverse`)),
      );
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409, 409]);
      expect(results.filter((r) => r.status === 409).map((r) => r.body.code)).toEqual([
        'ALREADY_REVERSED',
        'ALREADY_REVERSED',
      ]);
      const reversal = results.find((r) => r.status === 201)!.body;
      expect(reversal).toMatchObject({
        reason: 'REVERSAL',
        type: 'receipt',
        reversedReason: 'PURCHASE_RECEIPT',
        reverses: { id: original.id, reference: original.reference },
        documentDate: today,
      });
      expect((await stockOf(item)).SEDE).toBe('0.000');
      const read = await as('admin').get(`/stock-documents/${original.id}`).expect(200);
      expect(read.body.reversedBy).toEqual({ id: reversal.id, reference: reversal.reference });
      const again = await as('admin').post(`/stock-documents/${reversal.id}/reverse`).expect(409);
      expect(again.body.code).toBe('CANNOT_REVERSE_REVERSAL');
    });

    it('cannot reverse a receipt whose goods already left', async () => {
      const item = await newItem();
      const { body: original } = await as('admin')
        .post('/stock-documents', receipt([{ itemId: item, quantity: '4' }]))
        .expect(201);
      await as('admin')
        .post('/stock-documents', issue([{ itemId: item, quantity: '1' }]))
        .expect(201);
      const res = await as('admin').post(`/stock-documents/${original.id}/reverse`).expect(409);
      expect(res.body.code).toBe('STOCK_INSUFFICIENT');
    });
  });

  describe('sending the same document twice', () => {
    it('records it once and answers with what was recorded', async () => {
      const item = await newItem();
      const body = receipt([{ itemId: item, quantity: '3' }]);
      const results = await Promise.all(
        [1, 2, 3].map(() => as('admin').post('/stock-documents', body)),
      );
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 200, 201]);
      expect(new Set(results.map((r) => r.body.id))).toEqual(new Set([body.id]));
      expect((await stockOf(item)).SEDE).toBe('3.000');
      // "3" and "3.000" are the same quantity.
      await as('admin')
        .post('/stock-documents', { ...body, lines: [{ itemId: item, quantity: '3.000' }] })
        .expect(200);
      const changed = await as('admin')
        .post('/stock-documents', { ...body, lines: [{ itemId: item, quantity: '4' }] })
        .expect(409);
      expect(changed.body.code).toBe('DOCUMENT_ID_REUSED');
    });
  });

  describe('stock', () => {
    it('lists stock with reorder levels, below reorder first to know what to order', async () => {
      const item = await newItem();
      await as('admin')
        .post('/stock-documents', receipt([{ itemId: item, quantity: '3' }]))
        .expect(201);
      const set = await as('WAREHOUSE_KEEPER')
        .put(`/stock/reorder-levels/${ids.w1}/${item}`, {
          reorderPoint: '5',
          reorderQuantity: '20',
        })
        .expect(200);
      expect(set.body).toMatchObject({
        reorderPoint: '5.000',
        reorderQuantity: '20.000',
        version: 1,
      });
      await as('admin')
        .put(`/stock/reorder-levels/${ids.w1}/${item}`, { reorderPoint: '6' })
        .expect(409);

      const below = await as('READ_ONLY').get(`/stock?belowReorder=true&q=${suffix}`).expect(200);
      expect(below.body.items).toContainEqual(
        expect.objectContaining({
          itemId: item,
          quantity: '3.000',
          reorderPoint: '5.000',
          belowReorder: true,
        }),
      );
      const summary = await as('READ_ONLY').get('/stock/summary').expect(200);
      expect(summary.body.belowReorder).toBeGreaterThanOrEqual(1);
      expect(summary.body.documentsToday).toBeGreaterThanOrEqual(1);

      // A level with no movement yet counts as stock zero.
      const fresh = await newItem();
      await as('admin')
        .put(`/stock/reorder-levels/${ids.w2}/${fresh}`, { reorderPoint: '1' })
        .expect(200);
      const freshRows = await as('admin')
        .get(`/stock?warehouseId=${ids.w2}&belowReorder=true`)
        .expect(200);
      expect(freshRows.body.items.map((r: { itemId: string }) => r.itemId)).toContain(fresh);

      await as('admin').delete(`/stock/reorder-levels/${ids.w1}/${item}?version=1`).expect(204);
      const card = await as('admin').get(`/stock/items/${item}`).expect(200);
      expect(
        card.body.warehouses.find((w: { warehouseCode: string }) => w.warehouseCode === 'SEDE'),
      ).toMatchObject({ reorderPoint: null, belowReorder: false, quantity: '3.000' });
      await as('ACCOUNTANT')
        .put(`/stock/reorder-levels/${ids.w1}/${item}`, { reorderPoint: '1' })
        .expect(403);
    });

    it('tells the stock at a date and the history with the running stock', async () => {
      const item = await newItem();
      const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000)
        .toISOString()
        .slice(0, 10);
      await as('admin')
        .post(
          '/stock-documents',
          receipt([{ itemId: item, quantity: '10' }], { documentDate: yesterday }),
        )
        .expect(201);
      await as('admin')
        .post('/stock-documents', issue([{ itemId: item, quantity: '4' }]))
        .expect(201);

      const atYesterday = await as('admin').get(`/stock?asOf=${yesterday}&q=${suffix}`).expect(200);
      expect(atYesterday.body.items).toContainEqual(
        expect.objectContaining({ itemId: item, quantity: '10.000' }),
      );
      const history = await as('admin').get(`/stock/items/${item}/movements`).expect(200);
      expect(
        history.body.items.map((m: { quantity: string; balance: string }) => [
          m.quantity,
          m.balance,
        ]),
      ).toEqual([
        ['-4.000', '6.000'],
        ['10.000', '10.000'],
      ]);
      const todayOnly = await as('admin')
        .get(`/stock/items/${item}/movements?from=${today}`)
        .expect(200);
      expect(todayOnly.body).toMatchObject({
        total: 1,
        items: [expect.objectContaining({ balance: '6.000' })],
      });
    });

    it('offers items and parties for the lines and the header of a document', async () => {
      const items = await as('admin')
        .get(`/stock/items-search?q=${suffix}&warehouseId=${ids.w1}`)
        .expect(200);
      expect(
        items.body.every((o: { unit: string; unitDecimals: number }) => o.unitDecimals >= 0),
      ).toBe(true);
      expect(items.body.some((o: { id: string }) => o.id === ids.service)).toBe(false);
      const suppliers = await as('admin')
        .get(`/stock/parties-search?role=supplier&q=${suffix}`)
        .expect(200);
      expect(suppliers.body.map((p: { id: string }) => p.id)).toEqual([ids.supplier]);
      // A warehouse of another company does not reveal its stock.
      await as('admin').get(`/stock/items-search?warehouseId=${ids.w3}`).expect(404);
    });
  });

  describe('company, module and permissions', () => {
    it('needs a company the person can reach', async () => {
      const none = await as('admin', null).get('/stock').expect(400);
      expect(none.body.code).toBe('COMPANY_REQUIRED');
      const far = await as('keeper', companyA2).get('/stock').expect(403);
      expect(far.body.code).toBe('COMPANY_NOT_ACCESSIBLE');
      await as('keeper').get('/stock').expect(200);
    });

    it('keeps each company to its own documents', async () => {
      const { body } = await as('admin', companyA2)
        .post('/stock-documents', {
          id: uuidv7(),
          reason: 'OPENING',
          warehouseId: ids.w3,
          lines: [{ itemId: ids.pz, quantity: '1' }],
        })
        .expect(201);
      await as('admin').get(`/stock-documents/${body.id}`).expect(404);
      await as('admin').post(`/stock-documents/${body.id}/reverse`).expect(404);
      const wrong = await as('admin')
        .post('/stock-documents', {
          id: uuidv7(),
          reason: 'OPENING',
          warehouseId: ids.w3,
          lines: [{ itemId: ids.pz, quantity: '1' }],
        })
        .expect(400);
      expect(wrong.body.errors).toEqual([{ field: 'warehouseId', code: 'WAREHOUSE_NOT_FOUND' }]);
      const list = await as('admin').get('/stock-documents?pageSize=100').expect(200);
      expect(list.body.items.some((d: { id: string }) => d.id === body.id)).toBe(false);
    });

    it('is closed to tenants without the module', async () => {
      const res = await as('other', world.companies.b).get('/stock').expect(403);
      expect(res.body.code).toBe('MODULE_NOT_ENABLED');
    });

    it('follows the permission matrix', async () => {
      const body = () => issue([{ itemId: ids.pz, quantity: '1' }]);
      await as('READ_ONLY').post('/stock-documents', body()).expect(403);
      await as('ACCOUNTANT').post('/stock-documents', body()).expect(403);
      await as('ACCOUNTANT').get('/stock-documents').expect(200);
      await as('READ_ONLY').get('/stock').expect(200);
    });
  });

  describe('database', () => {
    it('keeps documents and movements append-only and stock never below zero', async () => {
      const privileges = await admin.$queryRaw<{ update: boolean; delete: boolean }[]>`
        SELECT has_table_privilege('mercurio_app', 'stock_documents', 'UPDATE') OR
               has_table_privilege('mercurio_app', 'stock_movements', 'UPDATE') AS update,
               has_table_privilege('mercurio_app', 'stock_documents', 'DELETE') OR
               has_table_privilege('mercurio_app', 'stock_movements', 'DELETE') AS delete`;
      expect(privileges).toEqual([{ update: false, delete: false }]);
      await expect(
        admin.$executeRaw`UPDATE stock_balances SET quantity = -1 WHERE tenant_id = ${world.tenants.a}::uuid`,
      ).rejects.toThrow(/stock_balances_not_negative/);
      expect(await inconsistencies()).toEqual([]);
    });

    it('writes an audit event for each document', async () => {
      const events = await admin.auditEvent.groupBy({
        by: ['type'],
        where: { tenantId: world.tenants.a, type: { startsWith: 'STOCK_' } },
        _count: true,
      });
      expect(events.map((e) => e.type).sort()).toEqual([
        'STOCK_DOCUMENT_POSTED',
        'STOCK_DOCUMENT_REVERSED',
      ]);
    });
  });
});
