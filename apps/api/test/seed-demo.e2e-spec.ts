import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { CliModule } from '../src/cli/cli.module.js';
import { runCli } from '../src/cli/run-cli.js';
import { DEMO, seedDemo } from '../src/cli/seed-demo.js';
import { AppConfigModule } from '../src/config/config.module.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  canAccessCompany,
  IdentityModule,
  IdentityService,
} from '../src/modules/identity/index.js';
import { TenancyModule, TenancyService } from '../src/modules/tenancy/index.js';
import { PrismaModule, TenantDatabase } from '../src/prisma/index.js';
import { adminClient, deleteTenantsAndUsers, uniqueSuffix } from './support/database.js';

// The demo seed, created with a test suffix (never touching real demo data), and the isolation
// checks repeated on it as the API role (docs/conventions.md B21).
describe('demo seed (e2e)', () => {
  let admin: PrismaClient;
  let db: TenantDatabase;
  let tenancy: TenancyService;
  let identity: IdentityService;
  let close: () => Promise<void>;
  const suffix = uniqueSuffix();
  const email = (local: string) => `${local}.${suffix}@example.com`;
  let rossi: { id: string; companies: { id: string; legalName: string }[] };
  let bianchi: { id: string };

  beforeAll(async () => {
    admin = adminClient();
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule, TenancyModule, IdentityModule],
    }).compile();
    await moduleRef.init();
    db = moduleRef.get(TenantDatabase);
    tenancy = moduleRef.get(TenancyService);
    identity = moduleRef.get(IdentityService);
    close = () => moduleRef.close();

    await admin.$transaction((tx) => seedDemo(tx, { tenancy, identity }, suffix));
    const tenants = await admin.tenant.findMany({
      where: { slug: { in: [`rossi-${suffix}`, `bianchi-${suffix}`] } },
      include: { companies: { orderBy: { legalName: 'asc' } } },
    });
    rossi = tenants.find((t) => t.slug.startsWith('rossi'))!;
    bianchi = tenants.find((t) => t.slug.startsWith('bianchi'))!;
  });

  afterAll(async () => {
    await close?.();
    const users = await admin.user.findMany({
      where: { email: { endsWith: `.${suffix}@example.com` } },
    });
    await deleteTenantsAndUsers(
      admin,
      [rossi?.id, bianchi?.id].filter(Boolean) as string[],
      users.map((u) => u.id),
    );
    await admin.$disconnect();
  });

  it('creates the two tenants with their companies, modules and members', async () => {
    expect(rossi.companies.map((c) => c.legalName)).toEqual(['Rossi Logistica Srl', 'Rossi Srl']);
    expect(await tenancy.enabledModules(admin, rossi.id)).toEqual([
      'registry',
      'warehouse',
      'orders',
      'invoicing',
    ]);
    expect(await tenancy.enabledModules(admin, bianchi.id)).toEqual(['registry', 'invoicing']);
    expect(await identity.listMembers(admin, rossi.id)).toHaveLength(
      DEMO.tenants[0].members.length,
    );
    // Six people: Paola Conti is one identity in two tenants.
    expect(
      await admin.user.count({ where: { email: { endsWith: `.${suffix}@example.com` } } }),
    ).toBe(6);
  });

  it('keeps each tenant to its own data, as the API role', async () => {
    const companiesOf = (tenantId: string) =>
      db.runAs({ tenantId }, (tx) =>
        tx.company.findMany({ where: { tenantId: { in: [rossi.id, bianchi.id] } } }),
      );

    expect((await companiesOf(rossi.id)).every((c) => c.tenantId === rossi.id)).toBe(true);
    expect(await companiesOf(rossi.id)).toHaveLength(2);
    expect(await companiesOf(bianchi.id)).toHaveLength(1);
  });

  it('shows the consultant both tenants, with the role of each', async () => {
    const paola = await admin.user.findUniqueOrThrow({ where: { email: email('paola.conti') } });

    const seen = await db.runAs({ tenantId: rossi.id, userId: paola.id }, (tx) =>
      tx.membership.findMany({ where: { userId: paola.id }, include: { tenant: true } }),
    );

    expect(
      seen.map((m) => [m.tenant.slug, m.role]).sort((a, b) => a[0]!.localeCompare(b[0]!)),
    ).toEqual([
      [`bianchi-${suffix}`, 'READ_ONLY'],
      [`rossi-${suffix}`, 'ACCOUNTANT'],
    ]);
  });

  it('limits Luca and Marco to one company each', async () => {
    const members = await identity.listMembers(admin, rossi.id);
    const [logistica, srl] = rossi.companies;
    const access = (local: string) => members.find((m) => m.email === email(local))!.access;

    expect(canAccessCompany(access('luca.gallo'), srl!.id)).toBe(true);
    expect(canAccessCompany(access('luca.gallo'), logistica!.id)).toBe(false);
    expect(canAccessCompany(access('marco.verdi'), logistica!.id)).toBe(true);
    expect(canAccessCompany(access('marco.verdi'), srl!.id)).toBe(false);
    expect(canAccessCompany(access('anna.rossi'), logistica!.id)).toBe(true);
  });

  it('refuses to run twice', async () => {
    await expect(
      admin.$transaction((tx) => seedDemo(tx, { tenancy, identity }, suffix)),
    ).rejects.toMatchObject({ code: 'DEMO_ALREADY_PRESENT' });
  });

  it('refuses a production database unless asked explicitly', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const err: string[] = [];
    try {
      const code = await runCli(
        ['seed-demo'],
        { out: () => undefined, err: (line) => err.push(line), audit: () => undefined },
        () => NestFactory.createApplicationContext(CliModule, { logger: false }),
      );

      expect(code).toBe(1);
      expect(err.join('\n')).toContain('DEMO_IN_PRODUCTION');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
