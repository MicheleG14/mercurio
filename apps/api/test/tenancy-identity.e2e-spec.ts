import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { APP_CONFIG, type AppConfig } from '../src/config/app-config.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { hashActivationCode } from '../src/modules/identity/activation-code.js';
import { IdentityService } from '../src/modules/identity/index.js';
import { TenancyService } from '../src/modules/tenancy/index.js';
import { TenantContextService } from '../src/prisma/index.js';
import { adminClient, deleteTenantsAndUsers, uniqueSuffix } from './support/database.js';
import { ProbeController } from './support/probe.controller.js';

/** An Italian VAT number with a valid check digit, built from 10 digits. */
function italianVat(first10: string): string {
  let sum = 0;
  first10.split('').forEach((char, i) => {
    const digit = Number(char) * (i % 2 === 0 ? 1 : 2);
    sum += digit > 9 ? digit - 9 : digit;
  });
  return first10 + String((10 - (sum % 10)) % 10);
}

// The tenancy and identity services as terminal commands use them: with the owner connection,
// inside a transaction. Plus the @RequiresModule guard through HTTP.
describe('tenancy and identity (e2e)', () => {
  let app: NestExpressApplication;
  let admin: PrismaClient;
  let tenancy: TenancyService;
  let identity: IdentityService;
  const suffix = uniqueSuffix();
  const tenantIds: string[] = [];
  const userIds: string[] = [];

  const newTenant = async (key: string, modules: string[] = ['registry']) => {
    const created = await admin.$transaction((tx) =>
      tenancy.createTenant(tx, {
        name: `Svc ${key}`,
        slug: `svc-${key}-${suffix}`,
        modules,
        company: { legalName: `${key} Srl`, vatNumber: italianVat('1234567890') },
      }),
    );
    tenantIds.push(created.tenant.id);
    return created;
  };
  const addMember = async (input: Parameters<IdentityService['addMember']>[1]) => {
    const result = await admin.$transaction((tx) => identity.addMember(tx, input));
    userIds.push(result.userId);
    return result;
  };

  beforeAll(async () => {
    admin = adminClient();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app, app.get<AppConfig>(APP_CONFIG));
    // Test-only stand-in for the session of phase 1b: the tenant comes from a header.
    const contexts = app.get(TenantContextService);
    app.use(
      (req: { header(name: string): string | undefined }, _res: unknown, next: () => void) => {
        const tenantId = req.header('x-test-tenant');
        if (tenantId) contexts.run({ tenantId }, next);
        else next();
      },
    );
    await app.init();
    tenancy = app.get(TenancyService);
    identity = app.get(IdentityService);
  });

  afterAll(async () => {
    await app?.close();
    await deleteTenantsAndUsers(admin, tenantIds, [...new Set(userIds)]);
    await admin.$disconnect();
  });

  describe('tenants and companies', () => {
    it('creates a tenant with its first company and the chosen modules', async () => {
      const { tenant, company, modules } = await newTenant('alpha', ['invoicing']);

      expect(tenant).toMatchObject({ slug: `svc-alpha-${suffix}`, status: 'ACTIVE' });
      expect(company).toMatchObject({
        tenantId: tenant.id,
        vatNumber: '12345678903',
        country: 'IT',
      });
      // registry is always added; nothing else implicitly.
      expect(modules).toEqual(['registry', 'invoicing']);
    });

    it('refuses a slug already taken, and leaves nothing behind', async () => {
      await newTenant('beta');

      await expect(newTenant('beta')).rejects.toMatchObject({ code: 'TENANT_SLUG_TAKEN' });
      expect(await admin.tenant.count({ where: { slug: `svc-beta-${suffix}` } })).toBe(1);
    });

    it('refuses a module without its requirements, rolling back the whole tenant', async () => {
      await expect(newTenant('gamma', ['orders'])).rejects.toMatchObject({
        code: 'MODULE_DEPENDENCY_MISSING',
      });
      expect(await admin.tenant.count({ where: { slug: `svc-gamma-${suffix}` } })).toBe(0);
    });

    it('adds companies, unique by VAT number within the tenant', async () => {
      const { tenant } = await newTenant('delta');
      const slug = tenant.slug;

      const second = await tenancy.addCompany(admin, slug, {
        legalName: 'Delta Logistica Srl',
        vatNumber: italianVat('0000000001'),
      });
      expect(second.tenantId).toBe(tenant.id);
      await expect(
        tenancy.addCompany(admin, slug, { legalName: 'Copy', vatNumber: '12345678903' }),
      ).rejects.toMatchObject({ code: 'COMPANY_VAT_TAKEN' });
      await expect(
        tenancy.addCompany(admin, slug, { legalName: 'Bad', vatNumber: '12345678901' }),
      ).rejects.toMatchObject({ code: 'VAT_NUMBER_INVALID' });
    });

    it('enables and disables modules respecting dependencies', async () => {
      const { tenant } = await newTenant('epsilon');

      expect(
        await tenancy.setModules(admin, tenant.slug, { enable: ['warehouse', 'orders'] }),
      ).toEqual(['registry', 'warehouse', 'orders']);
      await expect(
        tenancy.setModules(admin, tenant.slug, { disable: ['warehouse'] }),
      ).rejects.toMatchObject({ code: 'MODULE_REQUIRED_BY_OTHER' });
      expect(await tenancy.enabledModules(admin, tenant.id)).toEqual([
        'registry',
        'warehouse',
        'orders',
      ]);
    });

    it('reports an unknown tenant', async () => {
      await expect(tenancy.requireTenant(admin, `nobody-${suffix}`)).rejects.toMatchObject({
        code: 'TENANT_NOT_FOUND',
      });
    });
  });

  describe('members', () => {
    it('creates an identity with a one-time code stored only as a hash', async () => {
      const { tenant } = await newTenant('zeta');

      const added = await addMember({
        tenantId: tenant.id,
        email: ` Anna.${suffix}@Example.com `,
        name: 'Anna Rossi',
        role: 'admin',
        companies: 'all',
      });

      expect(added).toMatchObject({ identityCreated: true, reactivated: false });
      expect(added.activationCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const tokens = await admin.activationToken.findMany({ where: { userId: added.userId } });
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.tokenHash).toBe(hashActivationCode(added.activationCode!));
      const user = await admin.user.findUniqueOrThrow({ where: { id: added.userId } });
      expect(user.email).toBe(`anna.${suffix}@example.com`);
    });

    it('reuses the identity in another tenant, without a new code', async () => {
      const first = await newTenant('eta');
      const second = await newTenant('theta');
      const email = `consultant.${suffix}@example.com`;

      const inFirst = await addMember({
        tenantId: first.tenant.id,
        email,
        name: 'Consultant',
        role: 'ACCOUNTANT',
        companies: 'all',
      });
      const inSecond = await addMember({
        tenantId: second.tenant.id,
        email,
        name: 'Ignored, the identity exists',
        role: 'READ_ONLY',
        companies: [second.company.id],
      });

      expect(inSecond.userId).toBe(inFirst.userId);
      expect(inSecond).toMatchObject({ identityCreated: false, activationCode: undefined });
      const members = await identity.listMembers(admin, second.tenant.id);
      expect(members).toEqual([
        expect.objectContaining({
          email,
          role: 'READ_ONLY',
          access: { status: 'ACTIVE', allCompanies: false, companyIds: [second.company.id] },
        }),
      ]);
    });

    it('refuses companies of another tenant and memberships without companies', async () => {
      const own = await newTenant('iota');
      const other = await newTenant('kappa');
      const base = { tenantId: own.tenant.id, name: 'X', role: 'READ_ONLY' };

      await expect(
        addMember({ ...base, email: `x1.${suffix}@example.com`, companies: [other.company.id] }),
      ).rejects.toMatchObject({ code: 'COMPANY_NOT_IN_TENANT' });
      await expect(
        addMember({ ...base, email: `x2.${suffix}@example.com`, companies: [] }),
      ).rejects.toMatchObject({ code: 'MEMBERSHIP_NEEDS_COMPANIES' });
      await expect(
        addMember({ ...base, email: `x3.${suffix}@example.com`, role: 'boss', companies: 'all' }),
      ).rejects.toMatchObject({ code: 'INVALID_ROLE' });
    });

    it('removes a member, keeps the identity, and reactivates on a new addition', async () => {
      const { tenant } = await newTenant('lambda');
      const email = `marco.${suffix}@example.com`;
      const input = { tenantId: tenant.id, email, name: 'Marco', companies: 'all' as const };
      const added = await addMember({ ...input, role: 'WAREHOUSE_KEEPER' });

      await expect(addMember({ ...input, role: 'ADMIN' })).rejects.toMatchObject({
        code: 'MEMBERSHIP_EXISTS',
      });
      await identity.removeMember(admin, { tenantId: tenant.id, email });
      await expect(
        identity.removeMember(admin, { tenantId: tenant.id, email }),
      ).rejects.toMatchObject({ code: 'MEMBERSHIP_NOT_FOUND' });
      expect(await admin.user.count({ where: { id: added.userId } })).toBe(1);

      const again = await addMember({ ...input, role: 'ADMIN' });
      expect(again).toMatchObject({
        membershipId: added.membershipId,
        reactivated: true,
        identityCreated: false,
      });
      const [member] = await identity.listMembers(admin, tenant.id);
      expect(member).toMatchObject({ role: 'ADMIN', status: 'ACTIVE' });
    });

    it('replaces the unused activation code when a new one is issued', async () => {
      const { tenant } = await newTenant('mu');
      const added = await addMember({
        tenantId: tenant.id,
        email: `sara.${suffix}@example.com`,
        name: 'Sara',
        role: 'READ_ONLY',
        companies: 'all',
      });

      const fresh = await identity.issueActivationCode(admin, added.userId);

      const tokens = await admin.activationToken.findMany({ where: { userId: added.userId } });
      expect(tokens.map((t) => t.tokenHash)).toEqual([hashActivationCode(fresh)]);
    });
  });

  describe('@RequiresModule', () => {
    it('refuses tenants without the module, lets them in once enabled', async () => {
      const { tenant } = await newTenant('nu');
      const call = () =>
        request(app.getHttpServer()).get('/api/probe/warehouse').set('x-test-tenant', tenant.id);

      const refused = await call().expect(403);
      expect(refused.body).toMatchObject({ code: 'MODULE_NOT_ENABLED', detail: 'warehouse' });

      await tenancy.setModules(admin, tenant.slug, { enable: ['warehouse'] });
      await call().expect(200, { ok: true });
    });

    it('asks for a signed-in tenant when there is no context', async () => {
      const res = await request(app.getHttpServer()).get('/api/probe/warehouse').expect(401);

      expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });
});
