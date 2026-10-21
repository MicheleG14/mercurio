import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { MembershipRole, PrismaClient } from '../src/generated/prisma/client.js';
import { italianCheckDigit } from '../src/shared/italian-identifiers.js';
import { activate, bearer, createTestApp } from './support/auth.js';
import {
  adminClient,
  createWorld,
  deleteTenantsAndUsers,
  uniqueSuffix,
  type World,
} from './support/database.js';

// The registry end to end: real application, real database, the API role subject to Row-Level
// Security. Parties and items of tenant A, people of every role in A, and V (admin of B) to
// prove that the other tenant sees nothing.
describe('registry (e2e)', () => {
  let app: NestExpressApplication;
  let admin: PrismaClient;
  let world: World;
  const token: Record<'admin' | 'other' | MembershipRole, string> = {} as never;
  const extraUsers: string[] = [];
  const http = () => request(app.getHttpServer());

  /** A made-up Italian VAT number with a valid check digit, different in every call. */
  let counter = 0;
  const suffix = uniqueSuffix();
  const newVat = () => {
    const first10 =
      (Number.parseInt(suffix, 16) % 1e6).toString().padStart(6, '1') +
      String(++counter).padStart(4, '0');
    return first10 + italianCheckDigit(first10);
  };

  beforeAll(async () => {
    admin = adminClient();
    world = await createWorld(admin);
    app = await createTestApp();
    token.admin = (await activate(app, admin, world.users.u)).accessToken;
    // U is in two tenants, so its first token has none chosen: choose A.
    const chosen = await http()
      .post('/api/auth/tenant')
      .set(bearer(token.admin))
      .send({ tenantId: world.tenants.a })
      .expect(200);
    token.admin = chosen.body.accessToken;
    token.ADMIN = token.admin;
    token.other = (await activate(app, admin, world.users.v)).accessToken;
    for (const role of ['WAREHOUSE_KEEPER', 'ACCOUNTANT', 'READ_ONLY'] as const) {
      const user = await admin.user.create({
        data: { email: `${role.toLowerCase()}-${suffix}@example.com`, name: role },
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

  const as = (who: keyof typeof token) => ({
    get: (url: string) => http().get(`/api${url}`).set(bearer(token[who])),
    post: (url: string, body: object = {}) =>
      http().post(`/api${url}`).set(bearer(token[who])).send(body),
    patch: (url: string, body: object) =>
      http().patch(`/api${url}`).set(bearer(token[who])).send(body),
  });

  const company = (extra: object = {}) => ({
    kind: 'COMPANY',
    isCustomer: true,
    isSupplier: false,
    legalName: `Ferramenta Bruni ${suffix} Srl`,
    vatNumber: newVat(),
    city: 'Milano',
    province: 'MI',
    postalCode: '20121',
    ...extra,
  });

  const item = (extra: object = {}) => ({
    code: `VT-${suffix}-${++counter}`,
    description: 'Vite a testa esagonale M6x20',
    unit: 'PZ',
    vatCode: '22',
    salePrice: '0.1',
    ...extra,
  });

  describe('parties', () => {
    it('creates, reads, changes, archives and restores a party', async () => {
      const created = await as('admin').post('/parties', company()).expect(201);
      expect(created.body).toMatchObject({ version: 1, archivedAt: null, country: 'IT' });
      const id = created.body.id as string;

      const read = await as('admin').get(`/parties/${id}`).expect(200);
      expect(read.body).toEqual(created.body);

      const changed = await as('admin')
        .patch(`/parties/${id}`, { version: 1, city: 'Bergamo', province: 'bg' })
        .expect(200);
      expect(changed.body).toMatchObject({ version: 2, city: 'Bergamo', province: 'BG' });
      expect(changed.body.legalName).toBe(created.body.legalName);

      const archived = await as('admin').post(`/parties/${id}/archive`, { version: 2 }).expect(200);
      expect(archived.body.archivedAt).not.toBeNull();
      await as('admin').patch(`/parties/${id}`, { version: 3, city: 'X' }).expect(409);
      await as('admin').post(`/parties/${id}/archive`, { version: 3 }).expect(409);

      const restored = await as('admin').post(`/parties/${id}/restore`, { version: 3 }).expect(200);
      expect(restored.body).toMatchObject({ version: 4, archivedAt: null });
      await as('admin').post(`/parties/${id}/restore`, { version: 4 }).expect(409);
    });

    it('names private people "Last First" and keeps their own fields', async () => {
      const res = await as('admin')
        .post('/parties', {
          kind: 'PRIVATE',
          isCustomer: true,
          isSupplier: false,
          firstName: 'Mario',
          lastName: 'Rossi',
          taxCode: 'rssmra80a01h501u',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Rossi Mario',
        legalName: null,
        taxCode: 'RSSMRA80A01H501U',
      });
    });

    it('reports each broken rule on its field', async () => {
      const res = await as('admin')
        .post('/parties', {
          kind: 'COMPANY',
          isCustomer: false,
          isSupplier: false,
          legalName: '',
          vatNumber: '12345678901',
          postalCode: '123',
          sdiCode: 'X',
        })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors).toEqual([
        { field: 'isCustomer', code: 'PARTY_NEEDS_ROLE' },
        { field: 'legalName', code: 'REQUIRED' },
        { field: 'vatNumber', code: 'VAT_NUMBER_INVALID' },
        { field: 'postalCode', code: 'POSTAL_CODE_INVALID' },
        { field: 'sdiCode', code: 'SDI_CODE_INVALID' },
      ]);
    });

    it('refuses shapes the DTO does not know', async () => {
      const res = await as('admin')
        .post('/parties', { ...company(), kind: 'ROBOT', email: 'not-an-email', tenantId: 'x' })
        .expect(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          { field: 'kind', code: 'IS_ENUM' },
          { field: 'email', code: 'IS_EMAIL' },
          { field: 'tenantId', code: 'UNKNOWN_FIELD' },
        ]),
      );
    });

    it('allows one active party per VAT number, and leads to the existing one', async () => {
      const vatNumber = newVat();
      const first = await as('admin').post('/parties', company({ vatNumber })).expect(201);

      const taken = await as('admin')
        .post('/parties', company({ vatNumber: `IT${vatNumber}` }))
        .expect(409);
      expect(taken.body).toMatchObject({ code: 'PARTY_VAT_TAKEN', existingId: first.body.id });
      expect(taken.body.errors).toEqual([{ field: 'vatNumber', code: 'PARTY_VAT_TAKEN' }]);

      // Archived, it no longer blocks; but it cannot come back while the new one is active.
      await as('admin').post(`/parties/${first.body.id}/archive`, { version: 1 }).expect(200);
      const second = await as('admin').post('/parties', company({ vatNumber })).expect(201);
      const back = await as('admin')
        .post(`/parties/${first.body.id}/restore`, { version: 2 })
        .expect(409);
      expect(back.body).toMatchObject({ code: 'PARTY_VAT_TAKEN', existingId: second.body.id });

      const lookup = await as('admin').get(`/parties/lookup?vatNumber=IT ${vatNumber}`).expect(200);
      expect(lookup.body.items.map((p: { id: string }) => p.id)).toEqual([
        second.body.id,
        first.body.id,
      ]);
      expect(lookup.body.items[1].archivedAt).not.toBeNull();
    });

    it('stops two concurrent creations with the same VAT number in the database', async () => {
      const vatNumber = newVat();
      const results = await Promise.all(
        [1, 2, 3].map(() => as('admin').post('/parties', company({ vatNumber }))),
      );
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409, 409]);
      expect(results.filter((r) => r.status === 409).map((r) => r.body.code)).toEqual([
        'PARTY_VAT_TAKEN',
        'PARTY_VAT_TAKEN',
      ]);
    });

    it('lets another tenant have the same VAT number', async () => {
      const vatNumber = newVat();
      await as('admin').post('/parties', company({ vatNumber })).expect(201);
      await as('other').post('/parties', company({ vatNumber })).expect(201);
    });

    it('detects a conflicting edit and moves the version by one per change', async () => {
      const { body } = await as('admin').post('/parties', company()).expect(201);
      await as('admin').patch(`/parties/${body.id}`, { version: 1, phone: '02 1234' }).expect(200);
      const late = await as('admin')
        .patch(`/parties/${body.id}`, { version: 1, phone: '02 9999' })
        .expect(409);
      expect(late.body.code).toBe('EDIT_CONFLICT');
      const now = await as('admin').get(`/parties/${body.id}`).expect(200);
      expect(now.body).toMatchObject({ version: 2, phone: '02 1234' });
    });

    it('lets only one of two simultaneous edits of the same version through', async () => {
      const { body } = await as('admin').post('/parties', company()).expect(201);
      const results = await Promise.all(
        ['A', 'B'].map((note) =>
          as('admin').patch(`/parties/${body.id}`, { version: 1, notes: note }),
        ),
      );
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
    });

    it('rechecks the whole party when one field changes', async () => {
      const { body } = await as('admin').post('/parties', company()).expect(201);
      // Turning a company into a private person: the VAT number is no longer allowed.
      const res = await as('admin')
        .patch(`/parties/${body.id}`, { version: 1, kind: 'PRIVATE' })
        .expect(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          { field: 'firstName', code: 'REQUIRED' },
          { field: 'vatNumber', code: 'NOT_ALLOWED' },
        ]),
      );
    });

    it('searches, filters, sorts and paginates', async () => {
      const tag = `Zeta${suffix}`;
      const vatNumber = newVat();
      await as('admin').post('/parties', company({ legalName: `${tag} Alfa Srl`, vatNumber }));
      await as('admin').post(
        '/parties',
        company({ legalName: `${tag} Beta Srl`, isCustomer: false, isSupplier: true }),
      );
      const gamma = await as('admin').post('/parties', company({ legalName: `${tag} Gamma Srl` }));
      await as('admin').post(`/parties/${gamma.body.id}/archive`, { version: 1 }).expect(200);

      const names = (res: request.Response) => res.body.items.map((p: { name: string }) => p.name);
      const all = await as('admin').get(`/parties?q=${tag.toLowerCase()}`).expect(200);
      expect(names(all)).toEqual([`${tag} Alfa Srl`, `${tag} Beta Srl`]);
      expect(all.body).toMatchObject({ total: 2, page: 1, pageSize: 25 });

      const suppliers = await as('admin').get(`/parties?q=${tag}&role=supplier`).expect(200);
      expect(names(suppliers)).toEqual([`${tag} Beta Srl`]);
      const archived = await as('admin').get(`/parties?q=${tag}&archived=true`).expect(200);
      expect(names(archived)).toEqual([`${tag} Gamma Srl`]);
      const desc = await as('admin').get(`/parties?q=${tag}&sort=name:desc`).expect(200);
      expect(names(desc)).toEqual([`${tag} Beta Srl`, `${tag} Alfa Srl`]);
      const second = await as('admin').get(`/parties?q=${tag}&pageSize=1&page=2`).expect(200);
      expect(names(second)).toEqual([`${tag} Beta Srl`]);
      // A field that is not sortable is ignored: the default order (name) applies.
      const unknown = await as('admin').get(`/parties?q=${tag}&sort=vatNumber:desc`).expect(200);
      expect(names(unknown)).toEqual(names(all));

      const byVat = await as('admin')
        .get(`/parties?q=${vatNumber.slice(4)}`)
        .expect(200);
      expect(names(byVat)).toEqual([`${tag} Alfa Srl`]);
      // LIKE wildcards are searched for literally, not as patterns.
      const wildcard = await as('admin')
        .get(`/parties?q=${encodeURIComponent('%')}`)
        .expect(200);
      expect(wildcard.body.total).toBe(0);
      const underscore = await as('admin').get(`/parties?q=${tag}_Alfa`).expect(200);
      expect(underscore.body.total).toBe(0);
    });
  });

  describe('items', () => {
    it('keeps decimals exact and the code as created', async () => {
      const created = await as('admin')
        .post('/items', item({ salePrice: '0.1' }))
        .expect(201);
      expect(created.body).toMatchObject({ salePrice: '0.1000', stockManaged: true, version: 1 });

      const changed = await as('admin')
        .patch(`/items/${created.body.id}`, { version: 1, salePrice: '9999999999.9999' })
        .expect(200);
      expect(changed.body.salePrice).toBe('9999999999.9999');
      // The same price written differently is no change: no new version.
      const same = await as('admin')
        .patch(`/items/${created.body.id}`, { version: 2, salePrice: '9999999999.99990' })
        .expect(400);
      expect(same.body.errors).toEqual([{ field: 'salePrice', code: 'IS_DECIMAL_STRING' }]);
      const unchanged = await as('admin')
        .patch(`/items/${created.body.id}`, { version: 2, salePrice: '9999999999.9999' })
        .expect(200);
      expect(unchanged.body.version).toBe(2);

      const code = await as('admin')
        .patch(`/items/${created.body.id}`, { version: 2, code: 'OTHER' })
        .expect(400);
      expect(code.body.errors).toEqual([{ field: 'code', code: 'UNKNOWN_FIELD' }]);
    });

    it.each([
      [{ salePrice: 12.5 }, 'salePrice', 'IS_DECIMAL_STRING'],
      [{ salePrice: '12,50' }, 'salePrice', 'IS_DECIMAL_STRING'],
      [{ salePrice: '-1' }, 'salePrice', 'IS_DECIMAL_STRING'],
      [{ unit: 'XX' }, 'unit', 'UNIT_UNKNOWN'],
      [{ vatCode: '21' }, 'vatCode', 'VAT_CODE_UNKNOWN'],
      [{ code: 'VT 1' }, 'code', 'ITEM_CODE_INVALID'],
    ])('refuses %j', async (extra, field, code) => {
      const res = await as('admin').post('/items', item(extra)).expect(400);
      expect(res.body.errors).toEqual([{ field, code }]);
    });

    it('never reuses a code, whatever the case and even when archived', async () => {
      const code = `Case-${suffix}`;
      const first = await as('admin').post('/items', item({ code })).expect(201);
      const taken = await as('admin')
        .post('/items', item({ code: code.toUpperCase() }))
        .expect(409);
      expect(taken.body).toMatchObject({ code: 'ITEM_CODE_TAKEN' });
      await as('admin').post(`/items/${first.body.id}/archive`, { version: 1 }).expect(200);
      await as('admin')
        .post('/items', item({ code: code.toLowerCase() }))
        .expect(409);
      // Codes are per tenant.
      await as('other').post('/items', item({ code })).expect(201);
    });

    it('stops two concurrent creations with the same code in the database', async () => {
      const code = `Race-${suffix}`;
      const results = await Promise.all(
        [1, 2].map(() => as('admin').post('/items', item({ code }))),
      );
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
    });

    it('filters goods and services, and searches code and description', async () => {
      const tag = `Kappa${suffix}`;
      await as('admin').post('/items', item({ code: `${tag}-1`, description: 'Trapano' }));
      await as('admin').post(
        '/items',
        item({
          code: `S-${suffix}`,
          description: `Montaggio ${tag}`,
          unit: 'H',
          stockManaged: false,
        }),
      );
      const codes = (res: request.Response) => res.body.items.map((i: { code: string }) => i.code);
      expect(codes(await as('admin').get(`/items?q=${tag}`))).toEqual([`${tag}-1`, `S-${suffix}`]);
      expect(codes(await as('admin').get(`/items?q=${tag}&stockManaged=false`))).toEqual([
        `S-${suffix}`,
      ]);
      expect(codes(await as('admin').get(`/items?q=${tag}&sort=description:asc`))).toEqual([
        `S-${suffix}`,
        `${tag}-1`,
      ]);
    });

    it('serves the catalogs', async () => {
      const res = await as('READ_ONLY').get('/registry/reference-data').expect(200);
      expect(res.body.vatCodes).toContainEqual({ code: '22', rate: '22.00', nature: null });
      expect(res.body.vatCodes).toContainEqual({ code: 'N6.3', rate: '0.00', nature: 'N6.3' });
      expect(res.body.units).toContain('PZ');
      expect(res.body.legalForms).toContainEqual({ code: 'SRL', category: 'CAPITAL' });
    });
  });

  describe('isolation', () => {
    it('answers 404 for another tenant’s party or item, whatever the operation', async () => {
      const party = await as('admin').post('/parties', company()).expect(201);
      const it = await as('admin').post('/items', item()).expect(201);
      for (const [base, id] of [
        ['/parties', party.body.id],
        ['/items', it.body.id],
      ] as const) {
        await as('other').get(`${base}/${id}`).expect(404);
        await as('other').patch(`${base}/${id}`, { version: 1, notes: 'x' }).expect(404);
        await as('other').post(`${base}/${id}/archive`, { version: 1 }).expect(404);
        await as('other').post(`${base}/${id}/restore`, { version: 1 }).expect(404);
      }
      const list = await as('other').get(`/parties?q=${suffix}`).expect(200);
      expect(list.body.items.map((p: { id: string }) => p.id)).not.toContain(party.body.id);
      const lookup = await as('other')
        .get(`/parties/lookup?vatNumber=${party.body.vatNumber}`)
        .expect(200);
      expect(lookup.body.items).toEqual([]);
    });

    it('answers 400 for an id that is not a UUID', async () => {
      await as('admin').get('/parties/not-an-id').expect(400);
    });
  });

  describe('permissions', () => {
    // The matrix of docs/adr/0014, as the API applies it.
    it.each([
      ['ADMIN', { parties: [200, 201], items: [200, 201] }],
      ['ACCOUNTANT', { parties: [200, 201], items: [200, 403] }],
      ['WAREHOUSE_KEEPER', { parties: [200, 403], items: [200, 201] }],
      ['READ_ONLY', { parties: [200, 403], items: [200, 403] }],
    ] as const)('%s reads and writes as the matrix says', async (role, expected) => {
      expect([
        (await as(role).get('/parties')).status,
        (await as(role).post('/parties', company())).status,
      ]).toEqual(expected.parties);
      expect([
        (await as(role).get('/items')).status,
        (await as(role).post('/items', item())).status,
      ]).toEqual(expected.items);
    });

    it('refuses archiving without the write permission', async () => {
      const { body } = await as('admin').post('/items', item()).expect(201);
      const res = await as('ACCOUNTANT').post(`/items/${body.id}/archive`, { version: 1 });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('audit', () => {
    it('records every change with the changed fields and no values', async () => {
      const email = `segreteria.${suffix}@example.com`;
      const { body } = await as('admin').post('/parties', company()).expect(201);
      await as('admin').patch(`/parties/${body.id}`, { version: 1, email, city: 'Como' });
      await as('admin').post(`/parties/${body.id}/archive`, { version: 2 });
      await as('admin').post(`/parties/${body.id}/restore`, { version: 3 });

      const events = await admin.auditEvent.findMany({
        where: { subjectId: body.id },
        orderBy: { at: 'asc' },
      });
      expect(events.map((e) => e.type)).toEqual([
        'PARTY_CREATED',
        'PARTY_UPDATED',
        'PARTY_ARCHIVED',
        'PARTY_RESTORED',
      ]);
      expect(
        events.every((e) => e.actorUserId === world.users.u && e.subjectType === 'party'),
      ).toBe(true);
      expect(events[1]!.details).toEqual({ fields: ['city', 'email'] });
      expect(JSON.stringify(events)).not.toContain(email);
    });

    it('records item changes too', async () => {
      const { body } = await as('admin').post('/items', item()).expect(201);
      await as('admin').patch(`/items/${body.id}`, { version: 1, description: 'Bullone' });
      const events = await admin.auditEvent.findMany({ where: { subjectId: body.id } });
      expect(events.map((e) => e.type).sort()).toEqual(['ITEM_CREATED', 'ITEM_UPDATED']);
    });
  });
});
