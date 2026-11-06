import { Test } from '@nestjs/testing';
import { SEED_TRANSACTION } from '../src/cli/commands.js';
import { seedDemo } from '../src/cli/seed-demo.js';
import { AppConfigModule } from '../src/config/config.module.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { IdentityModule, IdentityService } from '../src/modules/identity/index.js';
import { InvoicingModule, InvoicingService } from '../src/modules/invoicing/index.js';
import { OrdersModule, OrdersService } from '../src/modules/orders/index.js';
import { RegistryModule, RegistryService } from '../src/modules/registry/index.js';
import { TenancyModule, TenancyService } from '../src/modules/tenancy/index.js';
import { WarehouseModule, WarehouseService } from '../src/modules/warehouse/index.js';
import { PrismaModule } from '../src/prisma/index.js';
import { adminClient, deleteTenantsAndUsers, uniqueSuffix } from './support/database.js';

// The demo's history is relative to its reference day: whatever the day, the rules of the use
// cases hold (dates of invoices, end of the month, a leap day, a new year), and something is over
// 90 days late (2026-11-06: the only due date in that window was the one credited by mistake).
// The seed on the common day is covered by seed-demo.e2e-spec.ts.
const DAYS = ['2026-11-06', '2026-12-31', '2027-01-01', '2028-02-29'];

describe.each(DAYS)('demo seed up to %s (e2e)', (today) => {
  let admin: PrismaClient;
  let close: () => Promise<void>;
  let invoicing: InvoicingService;
  let warehouse: WarehouseService;
  const suffix = uniqueSuffix();

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
    invoicing = moduleRef.get(InvoicingService);
    warehouse = moduleRef.get(WarehouseService);
    close = () => moduleRef.close();
    const services = {
      tenancy: moduleRef.get(TenancyService),
      identity: moduleRef.get(IdentityService),
      registry: moduleRef.get(RegistryService),
      warehouse,
      orders: moduleRef.get(OrdersService),
      invoicing,
    };
    await admin.$transaction((tx) => seedDemo(tx, services, { suffix, today }), SEED_TRANSACTION);
  }, 600_000);

  afterAll(async () => {
    await close?.();
    const tenants = await admin.tenant.findMany({ where: { slug: { endsWith: `-${suffix}` } } });
    const users = await admin.user.findMany({
      where: { email: { endsWith: `.${suffix}@example.com` } },
    });
    await deleteTenantsAndUsers(
      admin,
      tenants.map((t) => t.id),
      users.map((u) => u.id),
    );
    await admin.$disconnect();
  });

  it('writes the history through the same rules, ending on the day', async () => {
    const tenants = await admin.tenant.findMany({ where: { slug: { endsWith: `-${suffix}` } } });
    const last = await admin.invoice.findFirst({
      where: { tenantId: { in: tenants.map((t) => t.id) } },
      orderBy: { issueDate: 'desc' },
    });
    expect(last!.issueDate.toISOString().slice(0, 10) <= today).toBe(true);
    expect(await invoicing.verify(admin)).toEqual([]);
    expect(await warehouse.verifyStock(admin)).toEqual([]);
  });

  it('leaves something more than 90 days overdue in Rossi Srl', async () => {
    const [{ count }] = await admin.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM invoice_due_dates d
      JOIN invoices i ON i.id = d.invoice_id
      JOIN companies c ON c.id = d.company_id
      JOIN tenants t ON t.id = c.tenant_id
      WHERE t.slug LIKE ${'%-' + suffix} AND c.legal_name = 'Rossi Srl' AND i.kind = 'INVOICE'
        AND d.settled_amount < d.amount AND ${today}::date - d.due_date > 90`;
    expect(Number(count)).toBeGreaterThan(0);
  });
});
