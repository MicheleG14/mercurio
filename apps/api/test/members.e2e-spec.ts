import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { IdentityService } from '../src/modules/identity/index.js';
import { TenantDatabase } from '../src/prisma/index.js';
import { italianCheckDigit } from '../src/shared/italian-identifiers.js';
import { activate, activateWithCode, bearer, createTestApp, PASSWORD } from './support/auth.js';
import {
  adminClient,
  createWorld,
  deleteTenantsAndUsers,
  uniqueSuffix,
  uuidv7,
  type World,
} from './support/database.js';

// People, roles and companies administered from the interface (phase 7, docs/adr/0036, 0037).
// U is ADMIN of A (all companies) and READ_ONLY in B; V is ADMIN of B; W is ADMIN of C.
describe('members and roles (e2e)', () => {
  let app: NestExpressApplication;
  let admin: PrismaClient;
  let world: World;
  const suffix = uniqueSuffix();
  const extraUsers: string[] = [];
  const extraTenants: string[] = [];
  const token: { a: string; b: string; readOnlyB: string } = {} as never;
  const http = () => request(app.getHttpServer());

  let counter = 0;
  const newVat = () => {
    const first10 =
      (Number.parseInt(suffix, 16) % 1e6).toString().padStart(6, '2') +
      String(++counter).padStart(4, '0');
    return first10 + italianCheckDigit(first10);
  };
  const email = (name: string) => `${name}-${suffix}@example.com`;

  const as = (who: string) => ({
    get: (url: string) => http().get(`/api${url}`).set(bearer(who)),
    post: (url: string, body: object = {}) => http().post(`/api${url}`).set(bearer(who)).send(body),
    patch: (url: string, body: object) => http().patch(`/api${url}`).set(bearer(who)).send(body),
    put: (url: string, body: object) => http().put(`/api${url}`).set(bearer(who)).send(body),
  });

  /** Chooses a tenant with a token that has none (or another one). */
  const choose = async (accessToken: string, tenantId: string) =>
    (await http().post('/api/auth/tenant').set(bearer(accessToken)).send({ tenantId }).expect(200))
      .body.accessToken as string;

  /** Records the users created through the API, so the cleanup finds them. */
  const track = async (address: string) => {
    const user = await admin.user.findUnique({ where: { email: address } });
    if (user && !extraUsers.includes(user.id)) extraUsers.push(user.id);
    return user;
  };

  beforeAll(async () => {
    admin = adminClient();
    world = await createWorld(admin);
    app = await createTestApp();
    const u = await activate(app, admin, world.users.u);
    token.a = await choose(u.accessToken, world.tenants.a);
    token.readOnlyB = await choose(u.accessToken, world.tenants.b);
    token.b = (await activate(app, admin, world.users.v)).accessToken;
  });

  afterAll(async () => {
    await app?.close();
    if (world) {
      await deleteTenantsAndUsers(
        admin,
        [...Object.values(world.tenants), ...extraTenants],
        [...Object.values(world.users), ...extraUsers],
      );
    }
    await admin.$disconnect();
  });

  const membershipOf = (tenantId: string, userId: string) =>
    admin.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId, userId } } });

  describe('the whole cycle', () => {
    it('a role, a colleague with it, who activates and can do only what the role allows', async () => {
      const role = await as(token.a)
        .post('/roles', {
          name: `Commerciale ${suffix}`,
          description: 'Clienti e fornitori',
          permissions: ['parties:write', 'parties:read'],
        })
        .expect(201);
      expect(role.body).toMatchObject({
        permissions: ['parties:read', 'parties:write'],
        members: 0,
        version: 1,
      });

      const added = await as(token.a)
        .post('/members', {
          email: email('sales'),
          name: 'Sara Vendite',
          role: { customRoleId: role.body.id },
          allCompanies: true,
          companyIds: [],
        })
        .expect(201);
      await track(email('sales'));
      expect(added.body).toMatchObject({
        existingAccount: false,
        member: {
          email: email('sales'),
          role: { kind: 'custom', id: role.body.id, name: `Commerciale ${suffix}` },
          status: 'PENDING_ACTIVATION',
          canIssueCode: true,
          isSelf: false,
        },
      });
      expect(added.body.activation.code).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const sales = await activateWithCode(app, added.body.activation.code);
      const salesToken = sales.accessToken;
      const me = await as(salesToken).get('/auth/me').expect(200);
      expect(me.body.role).toEqual({
        kind: 'custom',
        key: null,
        id: role.body.id,
        name: `Commerciale ${suffix}`,
      });
      expect(me.body.permissions).toEqual(['parties:read', 'parties:write']);
      await as(salesToken).get('/parties').expect(200);
      expect((await as(salesToken).get('/items').expect(403)).body.code).toBe('PERMISSION_DENIED');
      await as(salesToken).get('/members').expect(403);
      await as(salesToken).get('/audit-events').expect(403);

      // A change of the role's permissions counts from the next request.
      await as(token.a)
        .put(`/roles/${role.body.id}`, {
          version: 1,
          name: `Commerciale ${suffix}`,
          description: 'Clienti, fornitori e articoli',
          permissions: ['parties:read', 'parties:write', 'items:read'],
        })
        .expect(200);
      await as(salesToken).get('/items').expect(200);

      const list = await as(token.a).get(`/members?q=sara`).expect(200);
      expect(list.body.items).toEqual([
        expect.objectContaining({ email: email('sales'), status: 'ACTIVE', canIssueCode: false }),
      ]);
      const roles = await as(token.a).get('/roles').expect(200);
      expect(roles.body.custom).toEqual([
        expect.objectContaining({ id: role.body.id, members: 1, version: 2 }),
      ]);
      expect(roles.body.builtin.map((r: { key: string }) => r.key)).toEqual([
        'ADMIN',
        'WAREHOUSE_KEEPER',
        'ACCOUNTANT',
        'READ_ONLY',
      ]);

      // Archiving a role in use is refused; after moving the person it is allowed.
      const sara = list.body.items[0];
      expect(
        (await as(token.a).post(`/roles/${role.body.id}/archive`, { version: 2 }).expect(409)).body
          .code,
      ).toBe('ROLE_IN_USE');
      await as(token.a)
        .patch(`/members/${sara.id}`, { version: sara.version, role: { builtin: 'READ_ONLY' } })
        .expect(200);
      await as(salesToken).get('/items').expect(200);
      expect((await as(salesToken).get('/auth/me').expect(200)).body.role.key).toBe('READ_ONLY');
      await as(token.a).post(`/roles/${role.body.id}/archive`, { version: 2 }).expect(201);

      const events = await admin.auditEvent.findMany({
        where: { tenantId: world.tenants.a, actorUserId: world.users.u },
        orderBy: { at: 'asc' },
      });
      expect(events.map((e) => e.type)).toEqual(
        expect.arrayContaining([
          'ROLE_CREATED',
          'MEMBER_ADDED',
          'ACTIVATION_CODE_ISSUED',
          'ROLE_UPDATED',
          'MEMBER_UPDATED',
          'ROLE_ARCHIVED',
        ]),
      );
      // The code itself is never in the log.
      expect(JSON.stringify(events)).not.toContain(added.body.activation.code);
    });
  });

  describe('roles', () => {
    it('refuse reserved and incomplete permissions, reserved and taken names', async () => {
      const post = (body: object) =>
        as(token.a).post('/roles', { name: `R ${suffix}`, permissions: ['parties:read'], ...body });
      expect(
        (await post({ permissions: ['members:read', 'members:manage'] }).expect(400)).body,
      ).toMatchObject({ errors: [{ field: 'permissions', code: 'PERMISSION_RESERVED' }] });
      expect((await post({ permissions: ['invoicing:issue'] }).expect(400)).body).toMatchObject({
        errors: [{ field: 'permissions', code: 'ROLE_PERMISSIONS_INCOMPLETE' }],
      });
      expect((await post({ name: 'Contabile' }).expect(400)).body).toMatchObject({
        errors: [{ field: 'name', code: 'ROLE_NAME_RESERVED' }],
      });
      await post({ name: `Dup ${suffix}` }).expect(201);
      expect((await post({ name: `DUP ${suffix}` }).expect(409)).body.code).toBe('ROLE_NAME_TAKEN');
    });

    it('show the catalog with modules and requirements', async () => {
      const { body } = await as(token.a).get('/roles/catalog').expect(200);
      expect(body.permissions).toContainEqual({
        key: 'invoicing:issue',
        module: 'invoicing',
        moduleEnabled: false,
        requires: ['invoicing:write'],
        reserved: false,
      });
      expect(body.permissions).toContainEqual(
        expect.objectContaining({ key: 'members:manage', reserved: true, moduleEnabled: true }),
      );
    });

    it('stay inside their tenant', async () => {
      const mine = await as(token.a)
        .post('/roles', { name: `Solo A ${suffix}`, permissions: ['parties:read'] })
        .expect(201);
      await as(token.b).get(`/roles/${mine.body.id}`).expect(404);
      const roles = await as(token.b).get('/roles').expect(200);
      expect(roles.body.custom.map((r: { id: string }) => r.id)).not.toContain(mine.body.id);
      // Nor can B give A's role to someone.
      const res = await as(token.b)
        .post('/members', {
          email: email('cross'),
          name: 'Cross',
          role: { customRoleId: mine.body.id },
          allCompanies: true,
          companyIds: [],
        })
        .expect(400);
      expect(res.body.code).toBe('ROLE_NOT_FOUND');
      expect(await track(email('cross'))).toBeNull();
    });
  });

  describe('limits of the administrator', () => {
    it('never changes or removes themselves', async () => {
      const me = await membershipOf(world.tenants.a, world.users.u);
      const patch = await as(token.a)
        .patch(`/members/${me.id}`, { version: me.version, role: { builtin: 'READ_ONLY' } })
        .expect(409);
      expect(patch.body.code).toBe('MEMBER_SELF_CHANGE');
      const remove = await as(token.a)
        .post(`/members/${me.id}/remove`, { version: me.version })
        .expect(409);
      expect(remove.body.code).toBe('MEMBER_SELF_CHANGE');
      const list = await as(token.a).get('/members').expect(200);
      expect(list.body.items).toContainEqual(expect.objectContaining({ id: me.id, isSelf: true }));
    });

    it('never leaves the tenant without an administrator, even with two changes at once', async () => {
      // Tenant C with two administrators, W and X, who remove each other at the same time.
      const x = await admin.user.create({ data: { email: email('x'), name: 'X' } });
      extraUsers.push(x.id);
      await admin.membership.create({
        data: { tenantId: world.tenants.c, userId: x.id, role: 'ADMIN', allCompanies: true },
      });
      const w = await activate(app, admin, world.users.w);
      const xs = await activate(app, admin, x.id);
      const mw = await membershipOf(world.tenants.c, world.users.w);
      const mx = await membershipOf(world.tenants.c, x.id);
      const results = await Promise.all([
        as(w.accessToken).post(`/members/${mx.id}/remove`, { version: mx.version }),
        as(xs.accessToken).post(`/members/${mw.id}/remove`, { version: mw.version }),
      ]);
      // One succeeds. The other is refused either by the check (LAST_ADMIN, when both ran side by
      // side) or before it, if it started after the first had removed its author.
      const refused = results.filter((r) => r.status !== 204);
      expect(results.filter((r) => r.status === 204)).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(['LAST_ADMIN', 'NO_ACTIVE_MEMBERSHIP']).toContain(refused[0]!.body.code);
      const admins = await admin.membership.count({
        where: { tenantId: world.tenants.c, role: 'ADMIN', status: 'ACTIVE' },
      });
      expect(admins).toBe(1);

      // Nor from the terminal: removing the one left is refused, always.
      const left = await admin.membership.findFirstOrThrow({
        where: { tenantId: world.tenants.c, role: 'ADMIN', status: 'ACTIVE' },
        include: { user: true },
      });
      const identity = app.get(IdentityService);
      await expect(
        admin.$transaction((tx) =>
          identity.removeMember(tx, { tenantId: world.tenants.c, email: left.user.email }),
        ),
      ).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    });

    it('is the only one who manages people', async () => {
      await as(token.readOnlyB).get('/members').expect(403);
      await as(token.readOnlyB)
        .post('/roles', { name: 'X', permissions: ['parties:read'] })
        .expect(403);
    });

    it('sees only the people of their tenant', async () => {
      const { body } = await as(token.b).get('/members').expect(200);
      const emails = body.items.map((m: { email: string }) => m.email);
      expect(emails).not.toContain(email('sales'));
      const inA = await membershipOf(world.tenants.a, world.users.u);
      await as(token.b).get(`/members/${inA.id}`).expect(404);
    });
  });

  describe('activation codes', () => {
    it('an existing account gets no code, and none can be issued for it', async () => {
      // V is active in B: added to A, they sign in with their own credentials.
      const added = await as(token.a)
        .post('/members', {
          email: (await admin.user.findUniqueOrThrow({ where: { id: world.users.v } })).email,
          name: 'Ignored',
          role: { builtin: 'READ_ONLY' },
          allCompanies: true,
          companyIds: [],
        })
        .expect(201);
      expect(added.body).toMatchObject({ existingAccount: true, activation: null });
      expect(added.body.member.name).toBe('V');
      const code = await as(token.a).post(`/members/${added.body.member.id}/activation-code`);
      expect(code.status).toBe(409);
      expect(code.body).toMatchObject({
        code: 'ACTIVATION_NOT_ALLOWED',
        detail: 'ALREADY_ACTIVATED',
      });
    });

    it('nor for someone not activated who belongs to another tenant', async () => {
      const y = await admin.user.create({ data: { email: email('y'), name: 'Y' } });
      extraUsers.push(y.id);
      await admin.membership.create({
        data: { tenantId: world.tenants.b, userId: y.id, role: 'READ_ONLY', allCompanies: true },
      });
      const added = await as(token.a)
        .post('/members', {
          email: email('y'),
          name: 'Y',
          role: { builtin: 'READ_ONLY' },
          allCompanies: true,
          companyIds: [],
        })
        .expect(201);
      expect(added.body.member).toMatchObject({
        status: 'PENDING_ACTIVATION',
        canIssueCode: false,
      });
      const code = await as(token.a)
        .post(`/members/${added.body.member.id}/activation-code`)
        .expect(409);
      expect(code.body.detail).toBe('OTHER_TENANTS');
    });

    it('a new code replaces the old one for a pending colleague', async () => {
      const added = await as(token.a)
        .post('/members', {
          email: email('z'),
          name: 'Zeno',
          role: { builtin: 'WAREHOUSE_KEEPER' },
          allCompanies: true,
          companyIds: [],
        })
        .expect(201);
      await track(email('z'));
      const fresh = await as(token.a)
        .post(`/members/${added.body.member.id}/activation-code`)
        .expect(201);
      await http()
        .post('/api/auth/activate')
        .send({ code: added.body.activation.code, password: PASSWORD })
        .expect(400);
      await activateWithCode(app, fresh.body.code);
    });

    it('the database refuses a code for a member of another tenant, whatever the API asks', async () => {
      const db = app.get(TenantDatabase);
      const outcome = await db.runAs(
        { tenantId: world.tenants.c, userId: world.users.w },
        (tx) =>
          tx.$queryRaw<{ outcome: string }[]>`
          SELECT app_issue_activation_code(${uuidv7()}::uuid, ${world.users.v}::uuid, 'h', now())
            AS outcome`,
      );
      expect(outcome[0]!.outcome).toBe('NOT_MEMBER');
      expect(await admin.activationToken.count({ where: { tokenHash: 'h' } })).toBe(0);
    });
  });

  describe('companies', () => {
    it('an administrator adds a company once, and whoever adds it can open it', async () => {
      const id = uuidv7();
      const vat = newVat();
      const body = { id, legalName: 'A Logistica Srl', vatNumber: vat };
      const created = await as(token.a).post('/companies', body).expect(201);
      expect(created.body).toMatchObject({ id, legalName: 'A Logistica Srl', vatNumber: vat });
      // The same request again returns the same company (B33); another one with that id is refused.
      await as(token.a).post('/companies', body).expect(201);
      expect(
        (
          await as(token.a)
            .post('/companies', { ...body, legalName: 'Altro' })
            .expect(409)
        ).body.code,
      ).toBe('COMPANY_ID_REUSED');
      expect(
        (
          await as(token.a)
            .post('/companies', { ...body, id: uuidv7() })
            .expect(409)
        ).body.code,
      ).toBe('COMPANY_VAT_TAKEN');
      const list = await as(token.a).get('/companies').expect(200);
      // By legal name, as everywhere: "A Logistica Srl" before "A Srl".
      expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([id, world.companies.a]);
      expect(
        await admin.auditEvent.count({ where: { subjectId: id, type: 'COMPANY_ADDED' } }),
      ).toBe(1);
    });

    it('someone with a list of companies gets the one they create; colleagues with a list do not', async () => {
      // A role with companies:manage, for a person who reaches only B's first company.
      const role = await as(token.b)
        .post('/roles', { name: `Societario ${suffix}`, permissions: ['companies:manage'] })
        .expect(201);
      const added = await as(token.b)
        .post('/members', {
          email: email('corp'),
          name: 'Corp',
          role: { customRoleId: role.body.id },
          allCompanies: false,
          companyIds: [world.companies.b],
        })
        .expect(201);
      await track(email('corp'));
      const corp = await activateWithCode(app, added.body.activation.code);
      const id = uuidv7();
      await as(corp.accessToken)
        .post('/companies', { id, legalName: 'B Nuova Srl', vatNumber: newVat() })
        .expect(201);
      const mine = await as(corp.accessToken).get('/companies').expect(200);
      expect(mine.body.items.map((c: { id: string }) => c.id)).toEqual([id, world.companies.b]);
      // U is READ_ONLY in B with only B's first company: the new one stays out of reach.
      const u = await membershipOf(world.tenants.b, world.users.u);
      expect(
        await admin.membershipCompany.count({ where: { membershipId: u.id, companyId: id } }),
      ).toBe(0);
    });

    it('no company is created in another tenant', async () => {
      const id = uuidv7();
      await as(token.readOnlyB)
        .post('/companies', { id, legalName: 'Nope Srl', vatNumber: newVat() })
        .expect(403);
      expect(await admin.company.count({ where: { id } })).toBe(0);
    });
  });
});
