import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { newActivationCode } from '../src/modules/identity/activation-code.js';
import { DEMO_PASSWORD, DEMO_TOTP_SECRET } from '../src/cli/seed-demo.js';
import { AuthService } from '../src/modules/auth/index.js';
import { totpCode } from '../src/modules/auth/totp.js';
import {
  activate,
  type Activated,
  bearer,
  cookieHeader,
  createTestApp,
  issueCode,
  PASSWORD,
  refreshCookie,
  signIn,
} from './support/auth.js';
import { AuthProbeController } from './support/auth-probe.controller.js';
import { adminClient, createWorld, deleteWorld, type World } from './support/database.js';

// Signing in end to end, against a real database and the real application: activation,
// two-factor enrolment, login, sessions, tenants, permissions and companies.
describe('authentication (e2e)', () => {
  let app: NestExpressApplication;
  let admin: PrismaClient;
  let world: World;
  const email: Record<'u' | 'v' | 'w', string> = { u: '', v: '', w: '' };
  const person: Record<'u' | 'v' | 'w', Activated> = {} as never;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    admin = adminClient();
    world = await createWorld(admin);
    app = await createTestApp([AuthProbeController]);
    for (const key of ['u', 'v', 'w'] as const) {
      email[key] = (await admin.user.findUniqueOrThrow({ where: { id: world.users[key] } })).email;
    }
    // U belongs to A (ADMIN) and B (READ_ONLY, only company B); V to B (ADMIN); W to C (ADMIN).
    for (const key of ['u', 'v', 'w'] as const) {
      person[key] = await activate(app, admin, world.users[key]);
    }
  });

  afterAll(async () => {
    await app?.close();
    if (world) await deleteWorld(admin, world);
    await admin.$disconnect();
  });

  /** A fresh signed-in session of U with tenant A or B already chosen. */
  async function sessionOf(key: 'u' | 'v' | 'w', tenantId?: string) {
    const s = await signIn(app, admin, world.users[key], email[key], person[key].secret);
    if (!tenantId || s.body.tenantId === tenantId) return s;
    const res = await http()
      .post('/api/auth/tenant')
      .set(bearer(s.accessToken))
      .send({ tenantId })
      .expect(200);
    return { ...s, accessToken: res.body.accessToken as string };
  }

  describe('activation and two-factor enrolment', () => {
    it('enrols with a secret that is stored encrypted, and issues ten recovery codes once', async () => {
      const credential = await admin.credential.findUniqueOrThrow({
        where: { userId: world.users.u },
      });

      expect(credential.passwordHash).toMatch(/^\$argon2id\$/);
      expect(credential.totpSecretEnc).toMatch(/^v1:/);
      expect(credential.totpSecretEnc).not.toContain(person.u.secret);
      expect(credential.totpConfirmedAt).not.toBeNull();
      expect(person.u.recoveryCodes).toHaveLength(10);
      const stored = await admin.recoveryCode.findMany({ where: { userId: world.users.u } });
      expect(stored).toHaveLength(10);
      expect(JSON.stringify(stored)).not.toContain(person.u.recoveryCodes[0]!);
    });

    it('sets the refresh cookie with the protective attributes', async () => {
      const code = await issueCode(admin, world.users.w);
      const { body } = await http().post('/api/auth/activate').send({ code, password: PASSWORD });
      const started = await http()
        .post('/api/auth/mfa/enroll/start')
        .send({ enrollToken: body.enrollToken });
      const res = await http()
        .post('/api/auth/mfa/enroll/confirm')
        .send({ enrollToken: body.enrollToken, code: totpCode(started.body.secret) })
        .expect(200);

      const cookie = ([] as string[])
        .concat(res.headers['set-cookie'] ?? [])
        .find((c) => c.startsWith('mercurio_refresh='))!;
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/api/auth');
      // The tests do not run in production, where the cookie is also Secure (see the config tests).
      person.w = { ...person.w, secret: started.body.secret };
    });

    it('refuses invalid, used, expired and replaced codes', async () => {
      await http()
        .post('/api/auth/activate')
        .send({ code: 'x'.repeat(43), password: PASSWORD })
        .expect(400)
        .expect((res) => expect(res.body.code).toBe('ACTIVATION_CODE_INVALID'));

      const code = await issueCode(admin, world.users.v);
      await http().post('/api/auth/activate').send({ code, password: PASSWORD }).expect(201);
      await http().post('/api/auth/activate').send({ code, password: PASSWORD }).expect(400);

      const expired = newActivationCode(new Date(Date.now() - 8 * 86_400_000));
      await admin.activationToken.create({
        data: { userId: world.users.v, tokenHash: expired.hash, expiresAt: expired.expiresAt },
      });
      await http()
        .post('/api/auth/activate')
        .send({ code: expired.code, password: PASSWORD })
        .expect(400);

      const older = await issueCode(admin, world.users.v);
      await issueCode(admin, world.users.v); // a newer code replaces the older one
      await http().post('/api/auth/activate').send({ code: older, password: PASSWORD }).expect(400);
      // Leave V able to sign in with the password it had after its first activation.
      person.v = await activate(app, admin, world.users.v);
    });

    it('rejects a weak password with the broken rule', async () => {
      const code = await issueCode(admin, world.users.v);
      const res = await http()
        .post('/api/auth/activate')
        .send({ code, password: 'short' })
        .expect(400);

      expect(res.body).toMatchObject({
        code: 'PASSWORD_TOO_WEAK',
        errors: [{ field: 'password', code: 'TOO_SHORT' }],
      });
      // The code was not spent by the refused attempt.
      await http().post('/api/auth/activate').send({ code, password: PASSWORD }).expect(201);
      person.v = await activate(app, admin, world.users.v);
    });

    it('rejects a wrong enrolment code and leaves the setup unfinished', async () => {
      const code = await issueCode(admin, world.users.v);
      const { body } = await http().post('/api/auth/activate').send({ code, password: PASSWORD });
      const started = await http()
        .post('/api/auth/mfa/enroll/start')
        .send({ enrollToken: body.enrollToken });
      await http()
        .post('/api/auth/mfa/enroll/confirm')
        .send({ enrollToken: body.enrollToken, code: '000000' })
        .expect(401)
        .expect((res) => expect(res.body.code).toBe('INVALID_MFA_CODE'));

      // Logging in now resumes the unfinished enrolment instead of asking for a code.
      const login = await http()
        .post('/api/auth/login')
        .send({ email: email.v, password: PASSWORD })
        .expect(200);
      expect(login.body.status).toBe('ENROLLMENT_REQUIRED');
      person.v = { ...person.v, secret: started.body.secret };
      await http()
        .post('/api/auth/mfa/enroll/confirm')
        .send({ enrollToken: login.body.token, code: totpCode(started.body.secret) })
        .expect(200);
    });
  });

  describe('login', () => {
    it('signs in with a password and a code, and offers the tenants', async () => {
      const s = await signIn(app, admin, world.users.u, email.u, person.u.secret);

      // U belongs to two tenants: the person chooses.
      expect(s.body.tenantId).toBeNull();
      expect(s.body.tenants.map((t) => t.id).sort()).toEqual(
        [world.tenants.a, world.tenants.b].sort(),
      );
      expect(s.refresh).toBeTruthy();
    });

    it('picks the only tenant for a person who has one', async () => {
      const s = await signIn(app, admin, world.users.v, email.v, person.v.secret);

      expect(s.body.tenantId).toBe(world.tenants.b);
    });

    it('answers every refusal the same way', async () => {
      await admin.user.update({ where: { id: world.users.w }, data: { status: 'DISABLED' } });
      const attempts = [
        { email: 'nobody@example.com', password: PASSWORD }, // unknown
        { email: email.v, password: 'wrong-password-here' }, // wrong password
        { email: email.w, password: PASSWORD }, // disabled
      ];
      const bodies = [];
      for (const attempt of attempts) {
        const res = await http().post('/api/auth/login').send(attempt).expect(401);
        bodies.push(res.body);
      }
      await admin.user.update({ where: { id: world.users.w }, data: { status: 'ACTIVE' } });

      for (const body of bodies) expect(body).toEqual(bodies[0]);
      expect(bodies[0].code).toBe('INVALID_CREDENTIALS');
      // The email of an unknown person is not kept anywhere.
      const events = await admin.authEvent.findMany({ where: { userId: null } });
      expect(JSON.stringify(events)).not.toContain('nobody@example.com');
      await admin.authEvent.deleteMany({ where: { userId: null } }).catch(() => undefined);
    });

    it('locks the account after five wrong passwords, silently, and unlocks it later', async () => {
      for (let i = 0; i < 5; i += 1) {
        await http()
          .post('/api/auth/login')
          .send({ email: email.v, password: 'wrong-wrong-wrong' })
          .expect(401);
      }
      // Even the right password is refused while the account is locked, with the same answer.
      const locked = await http()
        .post('/api/auth/login')
        .send({ email: email.v, password: PASSWORD })
        .expect(401);
      expect(locked.body.code).toBe('INVALID_CREDENTIALS');
      const types = (await admin.authEvent.findMany({ where: { userId: world.users.v } })).map(
        (e) => e.type,
      );
      expect(types).toContain('ACCOUNT_LOCKED');

      await admin.credential.update({
        where: { userId: world.users.v },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      await http().post('/api/auth/login').send({ email: email.v, password: PASSWORD }).expect(200);
    });

    it('counts wrong codes towards the lock too', async () => {
      await admin.credential.update({
        where: { userId: world.users.v },
        data: { failedAttempts: 0, lockedUntil: null },
      });
      const login = await http()
        .post('/api/auth/login')
        .send({ email: email.v, password: PASSWORD });
      for (let i = 0; i < 5; i += 1) {
        await http()
          .post('/api/auth/mfa/verify')
          .send({ challengeToken: login.body.token, code: '000000' })
          .expect(401);
      }
      const credential = await admin.credential.findUniqueOrThrow({
        where: { userId: world.users.v },
      });
      expect(credential.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
      await admin.credential.update({
        where: { userId: world.users.v },
        data: { failedAttempts: 0, lockedUntil: null },
      });
    });

    it('accepts a code only once', async () => {
      await admin.credential.update({
        where: { userId: world.users.u },
        data: { totpLastStep: null },
      });
      const first = await http()
        .post('/api/auth/login')
        .send({ email: email.u, password: PASSWORD });
      const code = totpCode(person.u.secret);
      await http()
        .post('/api/auth/mfa/verify')
        .send({ challengeToken: first.body.token, code })
        .expect(200);
      await http()
        .post('/api/auth/mfa/verify')
        .send({ challengeToken: first.body.token, code })
        .expect(401)
        .expect((res) => expect(res.body.code).toBe('INVALID_MFA_CODE'));
    });

    it('accepts a recovery code once', async () => {
      const code = person.u.recoveryCodes[0]!;
      const verify = async () => {
        const login = await http()
          .post('/api/auth/login')
          .send({ email: email.u, password: PASSWORD });
        return http()
          .post('/api/auth/mfa/verify')
          .send({ challengeToken: login.body.token, code: code.toLowerCase().replace(/-/g, ' ') });
      };

      await verify().then((res) => expect(res.status).toBe(200));
      await verify().then((res) => expect(res.status).toBe(401));
    });

    it('keeps tokens of one purpose from working as another', async () => {
      const login = await http()
        .post('/api/auth/login')
        .send({ email: email.u, password: PASSWORD });
      await http().get('/api/auth/me').set(bearer(login.body.token)).expect(401);

      const s = await sessionOf('u');
      await http()
        .post('/api/auth/mfa/verify')
        .send({ challengeToken: s.accessToken, code: '123456' })
        .expect(401)
        .expect((res) => expect(res.body.code).toBe('CHALLENGE_EXPIRED'));
    });
  });

  describe('every route is closed unless marked public', () => {
    it('refuses requests without a token, and with a bad one', async () => {
      await http().get('/api/probe-auth/any').expect(401);
      await http().get('/api/auth/me').expect(401);
      await http().get('/api/probe-auth/any').set(bearer('not.a.token')).expect(401);
      await http().get('/api/probe-auth/open').expect(200);
      // A stale token on a public route changes nothing.
      await http().get('/api/probe-auth/open').set(bearer('not.a.token')).expect(200);
    });
  });

  describe('tenants, permissions and companies', () => {
    it('describes the person for the interface', async () => {
      const a = await sessionOf('u', world.tenants.a);
      const me = await http().get('/api/auth/me').set(bearer(a.accessToken)).expect(200);

      expect(me.body.tenant.id).toBe(world.tenants.a);
      expect(me.body.role).toBe('ADMIN');
      expect(me.body.permissions).toContain('audit:read');
      expect(me.body.modules).toContain('registry');
      expect(me.body.companies.map((c: { id: string }) => c.id)).toEqual([world.companies.a]);
      expect(me.body.tenants).toHaveLength(2);
    });

    it('shows a limited role only the companies it may reach', async () => {
      const b = await sessionOf('u', world.tenants.b);
      const me = await http().get('/api/auth/me').set(bearer(b.accessToken)).expect(200);

      expect(me.body.role).toBe('READ_ONLY');
      expect(me.body.permissions).not.toContain('audit:read');
      expect(me.body.companies.map((c: { id: string }) => c.id)).toEqual([world.companies.b]);
    });

    it('refuses a tenant the person does not belong to', async () => {
      const s = await sessionOf('u');
      await http()
        .post('/api/auth/tenant')
        .set(bearer(s.accessToken))
        .send({ tenantId: world.tenants.c })
        .expect(403)
        .expect((res) => expect(res.body.code).toBe('NO_ACTIVE_MEMBERSHIP'));
    });

    it('takes the tenant from the token only', async () => {
      const a = await sessionOf('u', world.tenants.a);
      const res = await http()
        .get('/api/probe-auth/whoami')
        .query({ tenantId: world.tenants.b })
        .set(bearer(a.accessToken))
        .set('x-tenant-id', world.tenants.b)
        .expect(200);

      expect(res.body.tenantId).toBe(world.tenants.a);
    });

    it('enforces permissions from the role', async () => {
      const a = await sessionOf('u', world.tenants.a);
      const b = await sessionOf('u', world.tenants.b);
      const nothing = await sessionOf('u');

      await http().get('/api/probe-auth/audit').set(bearer(a.accessToken)).expect(200);
      await http()
        .get('/api/probe-auth/audit')
        .set(bearer(b.accessToken))
        .expect(403)
        .expect((res) => expect(res.body.code).toBe('PERMISSION_DENIED'));
      await http().get('/api/probe-auth/stock').set(bearer(b.accessToken)).expect(403);
      await http()
        .get('/api/probe-auth/audit')
        .set(bearer(nothing.accessToken))
        .expect(403)
        .expect((res) => expect(res.body.code).toBe('TENANT_NOT_SELECTED'));
    });

    it('verifies the company header on every request', async () => {
      const a = await sessionOf('u', world.tenants.a);
      const b = await sessionOf('u', world.tenants.b);
      const ask = (token: string, company?: string) => {
        const r = http().get('/api/probe-auth/company').set(bearer(token));
        return company ? r.set('X-Company-Id', company) : r;
      };

      await ask(a.accessToken, world.companies.a)
        .expect(200)
        .expect((res) => expect(res.body.companyId).toBe(world.companies.a));
      await ask(a.accessToken)
        .expect(400)
        .expect((res) => expect(res.body.code).toBe('COMPANY_REQUIRED'));
      // A company of another tenant, one the membership does not include, and garbage.
      for (const [token, company] of [
        [a.accessToken, world.companies.b],
        [b.accessToken, world.companies.b2],
        [a.accessToken, 'not-a-company'],
      ] as const) {
        await ask(token, company)
          .expect(403)
          .expect((res) => expect(res.body.code).toBe('COMPANY_NOT_ACCESSIBLE'));
      }
      await ask(b.accessToken, world.companies.b).expect(200);
    });

    it('takes effect at once when the membership, tenant, person or session changes', async () => {
      const s = await sessionOf('v', world.tenants.b);
      const get = () => http().get('/api/probe-auth/any').set(bearer(s.accessToken));
      await get().expect(200);

      await admin.membership.update({
        where: { tenantId_userId: { tenantId: world.tenants.b, userId: world.users.v } },
        data: { status: 'REMOVED' },
      });
      await get()
        .expect(403)
        .expect((res) => expect(res.body.code).toBe('NO_ACTIVE_MEMBERSHIP'));
      await admin.membership.update({
        where: { tenantId_userId: { tenantId: world.tenants.b, userId: world.users.v } },
        data: { status: 'ACTIVE' },
      });

      await admin.tenant.update({ where: { id: world.tenants.b }, data: { status: 'SUSPENDED' } });
      await get()
        .expect(403)
        .expect((res) => expect(res.body.code).toBe('TENANT_SUSPENDED'));
      await admin.tenant.update({ where: { id: world.tenants.b }, data: { status: 'ACTIVE' } });

      await admin.user.update({ where: { id: world.users.v }, data: { status: 'DISABLED' } });
      await get().expect(401);
      await admin.user.update({ where: { id: world.users.v }, data: { status: 'ACTIVE' } });
      await get().expect(200);

      await admin.session.updateMany({
        where: { userId: world.users.v },
        data: { revokedAt: new Date() },
      });
      await get()
        .expect(401)
        .expect((res) => expect(res.body.code).toBe('SESSION_EXPIRED'));
    });
  });

  describe('sessions', () => {
    it('rotates the refresh token on every use', async () => {
      const s = await sessionOf('u', world.tenants.a);
      const res = await http()
        .post('/api/auth/refresh')
        .set('Cookie', cookieHeader(s.refresh))
        .expect(200);
      const next = refreshCookie(res)!;

      expect(next).not.toBe(s.refresh);
      expect(res.body.tenantId).toBe(world.tenants.a);
      await http().get('/api/auth/me').set(bearer(res.body.accessToken)).expect(200);
    });

    it('closes the whole session when an old refresh token comes back', async () => {
      const s = await sessionOf('u', world.tenants.a);
      const first = await http()
        .post('/api/auth/refresh')
        .set('Cookie', cookieHeader(s.refresh))
        .expect(200);
      const second = refreshCookie(first)!;

      // The first token is used again (a copy was stolen): refused, and the session is closed...
      await http().post('/api/auth/refresh').set('Cookie', cookieHeader(s.refresh)).expect(401);
      // ...so the legitimate newest token no longer works either.
      await http().post('/api/auth/refresh').set('Cookie', cookieHeader(second)).expect(401);
      await http().get('/api/auth/me').set(bearer(first.body.accessToken)).expect(401);
      const types = (await admin.authEvent.findMany({ where: { userId: world.users.u } })).map(
        (e) => e.type,
      );
      expect(types).toContain('SESSION_REFRESH_REUSED');
    });

    it('expires after too long without use, or after the absolute limit', async () => {
      const idle = await sessionOf('u', world.tenants.a);
      await admin.session.updateMany({
        where: { userId: world.users.u, revokedAt: null, previousRefreshHash: null },
        data: { lastUsedAt: new Date(Date.now() - 9 * 3600_000) },
      });
      await http().post('/api/auth/refresh').set('Cookie', cookieHeader(idle.refresh)).expect(401);

      const old = await sessionOf('u', world.tenants.a);
      await admin.session.updateMany({
        where: { userId: world.users.u, revokedAt: null, previousRefreshHash: null },
        data: { absoluteExpiresAt: new Date(Date.now() - 1000) },
      });
      await http().post('/api/auth/refresh').set('Cookie', cookieHeader(old.refresh)).expect(401);
    });

    it('refuses a refresh without a cookie or with an unknown one, and clears it', async () => {
      await http().post('/api/auth/refresh').expect(401);
      const res = await http()
        .post('/api/auth/refresh')
        .set('Cookie', cookieHeader('unknown'))
        .expect(401);

      expect(([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';')).toContain(
        'mercurio_refresh=;',
      );
    });

    it('signs out one session or all of them', async () => {
      const one = await sessionOf('w');
      const two = await sessionOf('w');

      await http().post('/api/auth/logout').set(bearer(one.accessToken)).expect(204);
      await http().get('/api/auth/me').set(bearer(one.accessToken)).expect(401);
      await http().post('/api/auth/refresh').set('Cookie', cookieHeader(one.refresh)).expect(401);
      await http().get('/api/auth/me').set(bearer(two.accessToken)).expect(200);

      await http().post('/api/auth/logout-all').set(bearer(two.accessToken)).expect(204);
      await http().get('/api/auth/me').set(bearer(two.accessToken)).expect(401);
    });

    it('changes the password, closing the other sessions', async () => {
      const here = await sessionOf('w');
      const other = await sessionOf('w');
      const newPassword = 'another-long-password-2026';

      await http()
        .post('/api/auth/password')
        .set(bearer(here.accessToken))
        .send({ currentPassword: 'not-my-password', newPassword })
        .expect(401);
      await http()
        .post('/api/auth/password')
        .set(bearer(here.accessToken))
        .send({ currentPassword: PASSWORD, newPassword: 'short' })
        .expect(400);
      await http()
        .post('/api/auth/password')
        .set(bearer(here.accessToken))
        .send({ currentPassword: PASSWORD, newPassword })
        .expect(204);

      await http().get('/api/auth/me').set(bearer(here.accessToken)).expect(200);
      await http().get('/api/auth/me').set(bearer(other.accessToken)).expect(401);
      await http().post('/api/auth/login').send({ email: email.w, password: PASSWORD }).expect(401);
      await http()
        .post('/api/auth/login')
        .send({ email: email.w, password: newPassword })
        .expect(200);
    });

    it('replaces the recovery codes only for someone who proves both factors', async () => {
      const s = await sessionOf('u', world.tenants.a);
      const oldCode = person.u.recoveryCodes[1]!;
      await admin.credential.update({
        where: { userId: world.users.u },
        data: { totpLastStep: null },
      });

      await http()
        .post('/api/auth/recovery-codes')
        .set(bearer(s.accessToken))
        .send({ password: 'not-my-password', code: totpCode(person.u.secret) })
        .expect(401);
      await admin.credential.update({
        where: { userId: world.users.u },
        data: { totpLastStep: null, failedAttempts: 0, lockedUntil: null },
      });
      const res = await http()
        .post('/api/auth/recovery-codes')
        .set(bearer(s.accessToken))
        .send({ password: PASSWORD, code: totpCode(person.u.secret) })
        .expect(200);

      expect(res.body.recoveryCodes).toHaveLength(10);
      const login = await http()
        .post('/api/auth/login')
        .send({ email: email.u, password: PASSWORD });
      await http()
        .post('/api/auth/mfa/verify')
        .send({ challengeToken: login.body.token, code: oldCode })
        .expect(401);
    });
  });

  describe('audit', () => {
    it('records sign-ins for the person and tenant selection for the tenant', async () => {
      const a = await sessionOf('u', world.tenants.a);

      const own = await http().get('/api/auth/events').set(bearer(a.accessToken)).expect(200);
      expect(own.body.items.map((e: { type: string }) => e.type)).toContain('LOGIN_SUCCEEDED');

      const tenant = await http().get('/api/audit-events').set(bearer(a.accessToken)).expect(200);
      expect(tenant.body.items.map((e: { type: string }) => e.type)).toContain('TENANT_SELECTED');
    });

    it('lets only administrators read the tenant audit, and only their own tenant', async () => {
      const b = await sessionOf('u', world.tenants.b);
      await http().get('/api/audit-events').set(bearer(b.accessToken)).expect(403);

      const admins = await sessionOf('v', world.tenants.b);
      const res = await http().get('/api/audit-events').set(bearer(admins.accessToken)).expect(200);
      // Tenant B's administrator sees B's events, none of A's.
      const tenants = await admin.auditEvent.findMany({
        where: { id: { in: res.body.items.map((e: { id: string }) => e.id) } },
      });
      expect(tenants.every((e) => e.tenantId === world.tenants.b)).toBe(true);
    });

    it('filters and paginates the tenant audit', async () => {
      const a = await sessionOf('u', world.tenants.a);
      const res = await http()
        .get('/api/audit-events')
        .query({ type: 'TENANT_SELECTED', page: 1, pageSize: 1 })
        .set(bearer(a.accessToken))
        .expect(200);

      expect(res.body).toMatchObject({ page: 1, pageSize: 1 });
      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBeGreaterThan(1);
      await http()
        .get('/api/audit-events')
        .query({ type: 'NOT_A_TYPE' })
        .set(bearer(a.accessToken))
        .expect(400);
    });
  });

  describe('recovery and demo accounts', () => {
    it('lets an operator-issued code start over: new password, new two-factor setup, no old sessions', async () => {
      const old = await sessionOf('u', world.tenants.a);
      const oldSecret = person.u.secret;
      const newPassword = 'a-brand-new-password-2026';

      const code = await issueCode(admin, world.users.u);
      const activated = await http()
        .post('/api/auth/activate')
        .send({ code, password: newPassword })
        .expect(201);

      // The old session is closed, the old password and the old authenticator are worthless.
      await http().get('/api/auth/me').set(bearer(old.accessToken)).expect(401);
      await http().post('/api/auth/login').send({ email: email.u, password: PASSWORD }).expect(401);
      const login = await http()
        .post('/api/auth/login')
        .send({ email: email.u, password: newPassword })
        .expect(200);
      expect(login.body.status).toBe('ENROLLMENT_REQUIRED');

      const started = await http()
        .post('/api/auth/mfa/enroll/start')
        .send({ enrollToken: activated.body.enrollToken });
      expect(started.body.secret).not.toBe(oldSecret);
      await http()
        .post('/api/auth/mfa/enroll/confirm')
        .send({ enrollToken: activated.body.enrollToken, code: totpCode(started.body.secret) })
        .expect(200);
      person.u = { ...person.u, secret: started.body.secret, recoveryCodes: [] };
    });

    it('lets a demo person sign in with the known password and authenticator secret', async () => {
      const service = app.get(AuthService);
      await admin.$transaction((tx) =>
        service.setDemoCredentials(tx, world.users.v, {
          password: DEMO_PASSWORD,
          totpSecret: DEMO_TOTP_SECRET,
        }),
      );

      const s = await signIn(app, admin, world.users.v, email.v, DEMO_TOTP_SECRET, DEMO_PASSWORD);
      expect(s.body.tenantId).toBe(world.tenants.b);
    });
  });
});
