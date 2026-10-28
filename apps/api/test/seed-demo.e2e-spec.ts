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
import { OrdersModule, OrdersService } from '../src/modules/orders/index.js';
import { RegistryModule, RegistryService } from '../src/modules/registry/index.js';
import { TenancyModule, TenancyService } from '../src/modules/tenancy/index.js';
import { WarehouseModule, WarehouseService } from '../src/modules/warehouse/index.js';
import { PrismaModule, TenantDatabase } from '../src/prisma/index.js';
import { adminClient, deleteTenantsAndUsers, uniqueSuffix } from './support/database.js';

// The demo seed, created with a test suffix (never touching real demo data), and the isolation
// checks repeated on it as the API role (docs/conventions.md B21).
describe('demo seed (e2e)', () => {
  let admin: PrismaClient;
  let db: TenantDatabase;
  let tenancy: TenancyService;
  let identity: IdentityService;
  let registry: RegistryService;
  let warehouse: WarehouseService;
  let orders: OrdersService;
  let close: () => Promise<void>;
  const suffix = uniqueSuffix();
  const email = (local: string) => `${local}.${suffix}@example.com`;
  let rossi: { id: string; companies: { id: string; legalName: string }[] };
  let bianchi: { id: string };

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
      ],
    }).compile();
    await moduleRef.init();
    db = moduleRef.get(TenantDatabase);
    tenancy = moduleRef.get(TenancyService);
    identity = moduleRef.get(IdentityService);
    registry = moduleRef.get(RegistryService);
    warehouse = moduleRef.get(WarehouseService);
    orders = moduleRef.get(OrdersService);
    close = () => moduleRef.close();

    await admin.$transaction((tx) =>
      seedDemo(tx, { tenancy, identity, registry, warehouse, orders }, suffix),
    );
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

  it('fills each registry with every kind of party, goods and services', async () => {
    const parties = await admin.party.findMany({ where: { tenantId: rossi.id } });
    expect(parties).toHaveLength(8);
    expect(new Set(parties.map((p) => p.kind))).toEqual(
      new Set(['PRIVATE', 'SOLE_TRADER', 'COMPANY', 'ORGANIZATION']),
    );
    expect(parties.filter((p) => p.archivedAt !== null)).toHaveLength(1);
    expect(parties.filter((p) => p.country !== 'IT')).toHaveLength(1);
    expect(parties.some((p) => p.isCustomer && p.isSupplier)).toBe(true);

    const items = await admin.item.findMany({ where: { tenantId: rossi.id } });
    expect(items).toHaveLength(15);
    expect(items.some((i) => !i.stockManaged)).toBe(true);
    expect(items.some((i) => i.vatCode.startsWith('N'))).toBe(true);
    expect(await admin.party.count({ where: { tenantId: bianchi.id } })).toBe(2);
    expect(await admin.item.count({ where: { tenantId: bianchi.id } })).toBe(3);
  });

  it('shows each tenant only its own registry, as the API role', async () => {
    const seen = await db.runAs({ tenantId: bianchi.id }, async (tx) => ({
      parties: await tx.party.findMany({ where: { tenantId: { in: [rossi.id, bianchi.id] } } }),
      items: await tx.item.findMany({ where: { tenantId: { in: [rossi.id, bianchi.id] } } }),
    }));
    expect(seen.parties).toHaveLength(2);
    expect(seen.items).toHaveLength(3);
  });

  it('fills the warehouses of Rossi through the same rules as the API', async () => {
    const [logistica, srl] = rossi.companies;
    const warehouses = await admin.warehouse.findMany({
      where: { tenantId: rossi.id },
      orderBy: { code: 'asc' },
    });
    expect(warehouses.map((w) => [w.code, w.companyId])).toEqual([
      ['DEP', srl!.id],
      ['HUB', logistica!.id],
      ['SEDE', srl!.id],
    ]);
    // Nine documents and a reversal in Rossi Srl, two in Rossi Logistica; then the receipts and
    // shipments of the demo orders, with one shipment undone.
    expect(
      await admin.stockDocument.count({ where: { companyId: srl!.id, originType: null } }),
    ).toBe(10);
    expect(await admin.stockDocument.count({ where: { companyId: logistica!.id } })).toBe(2);
    expect(
      await admin.stockDocument.count({ where: { companyId: srl!.id, originType: 'order' } }),
    ).toBe(8);
    expect(
      await admin.stockDocument.count({ where: { tenantId: rossi.id, reason: 'REVERSAL' } }),
    ).toBe(2);
    expect(await warehouse.verifyStock(admin)).toEqual([]);

    const below = await admin.$queryRaw<{ code: string }[]>`
      SELECT i.code FROM reorder_levels l
      JOIN items i ON i.id = l.item_id
      LEFT JOIN stock_balances b ON b.warehouse_id = l.warehouse_id AND b.item_id = l.item_id
      WHERE l.tenant_id = ${rossi.id}::uuid AND coalesce(b.quantity, 0) <= l.reorder_point
      ORDER BY i.code`;
    expect(below.map((r) => r.code)).toEqual(['CM-PORT', 'GU-NIT', 'SM-125', 'TR-18V']);
    expect(await admin.warehouse.count({ where: { tenantId: bianchi.id } })).toBe(0);
  });

  it('records the orders of Rossi in every status, through the same rules as the API', async () => {
    const [logistica, srl] = rossi.companies;
    const byStatus = async (companyId: string) =>
      (
        await admin.order.findMany({
          where: { companyId },
          orderBy: [{ kind: 'asc' }, { orderDate: 'asc' }],
        })
      ).map((o) => `${o.kind} ${o.status}`);
    expect((await byStatus(srl!.id)).sort()).toEqual(
      [
        'PURCHASE CANCELLED',
        'PURCHASE COMPLETED',
        'PURCHASE PARTIAL',
        'PURCHASE CONFIRMED',
        'PURCHASE DRAFT',
        'SALES COMPLETED',
        'SALES PARTIAL',
        'SALES CONFIRMED',
        'SALES CONFIRMED',
        'SALES CONFIRMED',
        'SALES COMPLETED',
        'SALES DRAFT',
      ].sort(),
    );
    expect(await byStatus(logistica!.id)).toEqual(['PURCHASE CONFIRMED', 'SALES CONFIRMED']);
    // The smerigliatrici of the German customer: 3 of 5 reserved, the rest waits for the supplier.
    const reserved = await admin.$queryRaw<{ code: string; reserved: string }[]>`
      SELECT i.code, sum(r.quantity)::text AS reserved FROM stock_reservations r
      JOIN items i ON i.id = r.item_id
      WHERE r.tenant_id = ${rossi.id}::uuid GROUP BY i.code ORDER BY i.code`;
    expect(reserved).toEqual([
      { code: 'CH-BRU', reserved: '4.000' },
      { code: 'CM-PORT', reserved: '600.000' },
      { code: 'CV-3G15', reserved: '100.000' },
      { code: 'SM-125', reserved: '3.000' },
      { code: 'TR-18V', reserved: '2.000' },
      { code: 'VR-BIA', reserved: '4.000' },
    ]);
    expect(await warehouse.verifyStock(admin)).toEqual([]);
    expect(await admin.order.count({ where: { tenantId: bianchi.id } })).toBe(0);
  });

  it('adds only what is missing when run again', async () => {
    const people = await admin.user.count({
      where: { email: { endsWith: `.${suffix}@example.com` } },
    });
    // An item that went missing (deleted by the owner role, never by the API) comes back alone.
    // A service: goods have stock movements, which keep them.
    await admin.item.deleteMany({ where: { tenantId: rossi.id, code: 'MDO-ORA' } });

    const again = await admin.$transaction((tx) =>
      seedDemo(tx, { tenancy, identity, registry, warehouse, orders }, suffix),
    );

    expect(again.userIds).toEqual([]);
    expect(again.tenants).toEqual([
      expect.objectContaining({
        created: false,
        parties: 0,
        items: 1,
        warehouses: 0,
        documents: 0,
        orders: 0,
      }),
      expect.objectContaining({
        created: false,
        parties: 0,
        items: 0,
        warehouses: 0,
        documents: 0,
        orders: 0,
      }),
    ]);
    expect(await admin.item.count({ where: { tenantId: rossi.id } })).toBe(15);
    expect(await admin.party.count({ where: { tenantId: rossi.id } })).toBe(8);
    expect(
      await admin.user.count({ where: { email: { endsWith: `.${suffix}@example.com` } } }),
    ).toBe(people);
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
