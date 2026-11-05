import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { CliModule } from '../src/cli/cli.module.js';
import { SEED_TRANSACTION } from '../src/cli/commands.js';
import { storyStart } from '../src/cli/demo-history.js';
import { resetDemo } from '../src/cli/demo-reset.js';
import { runCli } from '../src/cli/run-cli.js';
import { DEMO, seedDemo } from '../src/cli/seed-demo.js';
import { AppConfigModule } from '../src/config/config.module.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  canAccessCompany,
  IdentityModule,
  IdentityService,
} from '../src/modules/identity/index.js';
import { InvoicingModule, InvoicingService } from '../src/modules/invoicing/index.js';
import { OrdersModule, OrdersService } from '../src/modules/orders/index.js';
import { RegistryModule, RegistryService } from '../src/modules/registry/index.js';
import { TenancyModule, TenancyService } from '../src/modules/tenancy/index.js';
import { WarehouseModule, WarehouseService } from '../src/modules/warehouse/index.js';
import { PrismaModule, TenantDatabase } from '../src/prisma/index.js';
import { adminClient, deleteTenantsAndUsers, uniqueSuffix } from './support/database.js';

// The demo seed (docs/conventions.md B21), created with a test suffix so it never touches the
// real demo data, on a fixed reference day: twelve months of history through the use cases, every
// feature at least once, the same story when written again, and the reset that keeps the people
// outside the demo.
const TODAY = '2026-11-05';
const RESET = { timeout: 600_000 } as const;

describe('demo seed (e2e)', () => {
  let admin: PrismaClient;
  let db: TenantDatabase;
  let services: {
    tenancy: TenancyService;
    identity: IdentityService;
    registry: RegistryService;
    warehouse: WarehouseService;
    orders: OrdersService;
    invoicing: InvoicingService;
  };
  let close: () => Promise<void>;
  const suffix = uniqueSuffix();
  const email = (local: string) => `${local}.${suffix}@example.com`;
  const outsiderEmail = `outsider-${suffix}@example.org`;
  let seeded: Awaited<ReturnType<typeof seedDemo>>;
  let rossi: { id: string; companies: { id: string; legalName: string }[] };
  let bianchi: { id: string };
  let other: { id: string };

  const load = async () => {
    const tenants = await admin.tenant.findMany({
      where: { slug: { in: [`rossi-${suffix}`, `bianchi-${suffix}`] } },
      include: { companies: { orderBy: { legalName: 'asc' } } },
    });
    rossi = tenants.find((t) => t.slug.startsWith('rossi'))!;
    bianchi = tenants.find((t) => t.slug.startsWith('bianchi'))!;
  };

  /** What a reference day must always give: documents, numbers, dates and amounts. */
  const story = async (tenantId: string) => ({
    invoices: (
      await admin.invoice.findMany({
        where: { tenantId },
        orderBy: [
          { company: { legalName: 'asc' } },
          { series: 'asc' },
          { year: 'asc' },
          { number: 'asc' },
        ],
        select: { series: true, year: true, number: true, issueDate: true, total: true },
      })
    ).map(
      (i) =>
        `${i.series} ${i.number}/${i.year} ${i.issueDate.toISOString().slice(0, 10)} ${i.total.toFixed(2)}`,
    ),
    documents: await admin.stockDocument.count({ where: { tenantId } }),
    orders: await admin.order.count({ where: { tenantId } }),
    payments: (
      await admin.payment.aggregate({ where: { tenantId }, _sum: { amount: true }, _count: true })
    )._count,
  });

  beforeAll(async () => {
    admin = adminClient();
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PrismaModule,
        TenancyModule,
        IdentityModule,
        RegistryModule,
        WarehouseModule,
        OrdersModule,
        InvoicingModule,
      ],
    }).compile();
    await moduleRef.init();
    db = moduleRef.get(TenantDatabase);
    services = {
      tenancy: moduleRef.get(TenancyService),
      identity: moduleRef.get(IdentityService),
      registry: moduleRef.get(RegistryService),
      warehouse: moduleRef.get(WarehouseService),
      orders: moduleRef.get(OrdersService),
      invoicing: moduleRef.get(InvoicingService),
    };
    close = () => moduleRef.close();

    seeded = await admin.$transaction(
      (tx) => seedDemo(tx, services, { suffix, today: TODAY }),
      SEED_TRANSACTION,
    );
    await load();
    other = await admin.tenant.create({
      data: { name: 'Not a demo', slug: `other-${suffix}` },
    });
  }, 600_000);

  afterAll(async () => {
    await close?.();
    const users = await admin.user.findMany({
      where: {
        OR: [{ email: { endsWith: `.${suffix}@example.com` } }, { email: outsiderEmail }],
      },
    });
    const tenants = await admin.tenant.findMany({
      where: { slug: { in: [`rossi-${suffix}`, `bianchi-${suffix}`, `other-${suffix}`] } },
    });
    await deleteTenantsAndUsers(
      admin,
      tenants.map((t) => t.id),
      users.map((u) => u.id),
    );
    await admin.$disconnect();
  });

  it('creates the two tenants with their companies, modules and members', async () => {
    expect(rossi.companies.map((c) => c.legalName)).toEqual(['Rossi Logistica Srl', 'Rossi Srl']);
    expect(await services.tenancy.enabledModules(admin, rossi.id)).toEqual([
      'registry',
      'warehouse',
      'orders',
      'invoicing',
    ]);
    expect(await services.tenancy.enabledModules(admin, bianchi.id)).toEqual([
      'registry',
      'invoicing',
    ]);
    expect(await services.identity.listMembers(admin, rossi.id)).toHaveLength(
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
    const seen = await db.runAs({ tenantId: bianchi.id }, (tx) =>
      tx.invoice.findMany({ where: { tenantId: { in: [rossi.id, bianchi.id] } } }),
    );
    expect(seen.every((i) => i.tenantId === bianchi.id)).toBe(true);
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
    const members = await services.identity.listMembers(admin, rossi.id);
    const [logistica, srl] = rossi.companies;
    const access = (local: string) => members.find((m) => m.email === email(local))!.access;
    expect(canAccessCompany(access('luca.gallo'), srl!.id)).toBe(true);
    expect(canAccessCompany(access('luca.gallo'), logistica!.id)).toBe(false);
    expect(canAccessCompany(access('marco.verdi'), logistica!.id)).toBe(true);
    expect(canAccessCompany(access('marco.verdi'), srl!.id)).toBe(false);
  });

  it('fills each registry with every kind of party, goods and services', async () => {
    const parties = await admin.party.findMany({ where: { tenantId: rossi.id } });
    expect(parties).toHaveLength(DEMO.tenants[0].parties.length);
    expect(new Set(parties.map((p) => p.kind))).toEqual(
      new Set(['PRIVATE', 'SOLE_TRADER', 'COMPANY', 'ORGANIZATION']),
    );
    expect(parties.filter((p) => p.archivedAt !== null)).toHaveLength(1);
    expect(parties.filter((p) => p.country !== 'IT')).toHaveLength(1);
    expect(await admin.item.count({ where: { tenantId: rossi.id } })).toBe(15);
    expect(await admin.party.count({ where: { tenantId: bianchi.id } })).toBe(3);
  });

  it('shows every feature of the demo at least once', () => {
    expect(seeded.missing).toEqual([]);
    expect(seeded.today).toBe(TODAY);
  });

  it('writes twelve months of invoices, numbered without gaps, dates growing with numbers', async () => {
    const srl = rossi.companies.find((c) => c.legalName === 'Rossi Srl')!;
    const invoices = await admin.invoice.findMany({
      where: { companyId: srl.id },
      orderBy: [{ series: 'asc' }, { year: 'asc' }, { number: 'asc' }],
    });
    const months = new Set(invoices.map((i) => i.issueDate.toISOString().slice(0, 7)));
    for (let d = storyStart(TODAY); d <= TODAY;) {
      expect(months.has(d.slice(0, 7))).toBe(true);
      const next = new Date(`${d}T00:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      d = next.toISOString().slice(0, 10);
    }
    // Per series and year: 1, 2, 3… and never a date before the one of the number before.
    const groups = new Map<string, typeof invoices>();
    for (const i of invoices) {
      const key = `${i.series}/${i.year}`;
      groups.set(key, [...(groups.get(key) ?? []), i]);
    }
    expect([...groups.keys()]).toEqual(expect.arrayContaining(['FT/2025', 'FT/2026', 'NC/2026']));
    for (const group of groups.values()) {
      group.forEach((invoice, i) => {
        expect(invoice.number).toBe(i + 1);
        if (i > 0) expect(invoice.issueDate >= group[i - 1]!.issueDate).toBe(true);
      });
    }
    // Ten to fifteen documents a month, on average.
    expect(invoices.length / 13).toBeGreaterThanOrEqual(8);
  });

  it('leaves something owed in every bucket of delay, and the books consistent', async () => {
    const srl = rossi.companies.find((c) => c.legalName === 'Rossi Srl')!;
    const buckets = await admin.$queryRaw<{ bucket: string }[]>`
      SELECT DISTINCT CASE
               WHEN d.due_date >= ${TODAY}::date THEN 'NOT_DUE'
               WHEN ${TODAY}::date - d.due_date <= 30 THEN 'DAYS_1_30'
               WHEN ${TODAY}::date - d.due_date <= 60 THEN 'DAYS_31_60'
               WHEN ${TODAY}::date - d.due_date <= 90 THEN 'DAYS_61_90'
               ELSE 'OVER_90' END AS bucket
      FROM invoice_due_dates d JOIN invoices i ON i.id = d.invoice_id
      WHERE d.company_id = ${srl.id}::uuid AND i.kind = 'INVOICE'
        AND d.settled_amount < d.amount`;
    expect(buckets.map((b) => b.bucket).sort()).toEqual(
      ['DAYS_1_30', 'DAYS_31_60', 'DAYS_61_90', 'NOT_DUE', 'OVER_90'].sort(),
    );
    expect(await services.invoicing.verify(admin)).toEqual([]);
    expect(await services.warehouse.verifyStock(admin)).toEqual([]);
  });

  it('leaves the demo as it is when run again', async () => {
    const before = await story(rossi.id);
    const again = await admin.$transaction(
      (tx) => seedDemo(tx, services, { suffix, today: TODAY }),
      SEED_TRANSACTION,
    );
    expect(again.userIds).toEqual([]);
    expect(again.tenants.every((t) => !t.created)).toBe(true);
    expect(await story(rossi.id)).toEqual(before);
  });

  it('resets the demo to the same story, keeping the people outside it and other tenants', async () => {
    const before = { rossi: await story(rossi.id), bianchi: await story(bianchi.id) };
    const outsider = await admin.user.create({ data: { email: outsiderEmail, name: 'Operator' } });
    const [logistica] = rossi.companies;
    await services.identity.addMember(admin, {
      tenantId: rossi.id,
      email: outsiderEmail,
      name: 'Operator',
      role: 'ACCOUNTANT',
      companies: [logistica!.id],
    });
    await services.identity.addMember(admin, {
      tenantId: bianchi.id,
      email: outsiderEmail,
      name: 'Operator',
      role: 'ADMIN',
      companies: 'all',
    });
    const oldRossi = rossi.id;

    const reset = await admin.$transaction(
      (tx) => resetDemo(tx, services, { suffix, today: TODAY }),
      RESET,
    );
    await load();

    expect(reset.deleted).toBe(2);
    expect(reset.missing).toEqual([]);
    expect(rossi.id).not.toBe(oldRossi);
    expect(await admin.tenant.findUnique({ where: { id: other.id } })).not.toBeNull();
    // The same reference day gives the same story.
    expect(await story(rossi.id)).toEqual(before.rossi);
    expect(await story(bianchi.id)).toEqual(before.bianchi);
    // The operator is back, the same identity, with the same role and companies.
    const memberships = await admin.membership.findMany({
      where: { userId: outsider.id },
      include: { tenant: true, companies: { include: { company: true } } },
      orderBy: { tenant: { slug: 'asc' } },
    });
    expect(
      memberships.map((m) => [
        m.tenant.slug,
        m.role,
        m.allCompanies ? 'all' : m.companies.map((c) => c.company.legalName),
      ]),
    ).toEqual([
      [`bianchi-${suffix}`, 'ADMIN', 'all'],
      [`rossi-${suffix}`, 'ACCOUNTANT', ['Rossi Logistica Srl']],
    ]);
    // Nothing of the old tenants is left anywhere.
    expect(await admin.invoice.count({ where: { tenantId: oldRossi } })).toBe(0);
  }, 600_000);

  it('refuses a production database unless asked explicitly', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const err: string[] = [];
    try {
      for (const command of ['seed-demo', 'reset-demo']) {
        const code = await runCli(
          [command],
          { out: () => undefined, err: (line) => err.push(line), audit: () => undefined },
          () => NestFactory.createApplicationContext(CliModule, { logger: false }),
        );
        expect(code).toBe(1);
      }
      expect(err.filter((line) => line.includes('DEMO_IN_PRODUCTION'))).toHaveLength(2);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
