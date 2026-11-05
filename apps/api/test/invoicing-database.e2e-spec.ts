import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { TenantDatabase } from '../src/prisma/index.js';
import { createTestApp } from './support/auth.js';
import {
  adminClient,
  createWorld,
  deleteTenantsAndUsers,
  uniqueSuffix,
  uuidv7,
  type World,
} from './support/database.js';

// The tables of the invoicing module, before any code writes them (docs/adr/0028-0030): what the
// database refuses whatever the code does. Rows are written by the owner role; the API role is
// used where its privileges or isolation are the point (B37: an issued invoice cannot change).
describe('invoicing tables (e2e)', () => {
  let admin: PrismaClient;
  let world: World;
  let database: TenantDatabase;
  let close: () => Promise<void>;
  const suffix = uniqueSuffix();
  let partyId: string;

  beforeAll(async () => {
    admin = adminClient();
    world = await createWorld(admin);
    const app = await createTestApp();
    database = app.get(TenantDatabase);
    close = () => app.close();
    partyId = (
      await admin.party.create({
        data: {
          tenantId: world.tenants.a,
          kind: 'COMPANY',
          isCustomer: true,
          isSupplier: false,
          name: `Cliente fatture ${suffix}`,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await close?.();
    if (world) {
      await deleteTenantsAndUsers(admin, Object.values(world.tenants), Object.values(world.users));
    }
    await admin.$disconnect();
  });

  let number = 0;
  const issued = (data: Partial<Prisma.InvoiceUncheckedCreateInput> = {}) =>
    admin.invoice.create({
      data: {
        id: uuidv7(),
        tenantId: world.tenants.a,
        companyId: world.companies.a,
        kind: 'INVOICE',
        series: 'FT',
        year: 2026,
        number: ++number,
        issueDate: new Date('2026-11-05'),
        partyId,
        seller: {},
        customer: {},
        language: 'it',
        paymentTerms: 'RD',
        paymentMethod: 'MP05',
        taxableTotal: '100.00',
        vatTotal: '22.00',
        stampDuty: '0.00',
        total: '122.00',
        ...data,
      },
    });
  const asApi = (sql: Prisma.Sql) =>
    database.runAs({ tenantId: world.tenants.a }, (tx) => tx.$executeRaw(sql));

  it('numbers an invoice in the series of its kind and the year of its date, once', async () => {
    const invoice = await issued();
    await expect(issued({ series: 'NC' })).rejects.toThrow(/invoices_series_of_kind/);
    await expect(issued({ year: 2025 })).rejects.toThrow(/invoices_number_in_year/);
    await expect(issued({ number: invoice.number })).rejects.toThrow(/Unique constraint/);
    await expect(issued({ kind: 'CREDIT_NOTE', series: 'NC' })).rejects.toThrow(
      /invoices_credit_note_credits/,
    );
    await expect(
      issued({ kind: 'CREDIT_NOTE', series: 'NC', creditedInvoiceId: invoice.id }),
    ).resolves.toMatchObject({ kind: 'CREDIT_NOTE' });
  });

  it('keeps the totals of an issued document consistent', async () => {
    await expect(issued({ total: '121.99' })).rejects.toThrow(/invoices_totals/);
    await expect(issued({ stampDuty: '1.00' })).rejects.toThrow(/invoices_totals/);
    await expect(issued({ language: 'fr' })).rejects.toThrow(/invoices_language/);
  });

  it('wants a line priced in full or a description only', async () => {
    const invoice = await issued();
    const line = (data: Partial<Prisma.InvoiceLineUncheckedCreateInput>) =>
      admin.invoiceLine.create({
        data: {
          tenantId: world.tenants.a,
          companyId: world.companies.a,
          invoiceId: invoice.id,
          lineNo: 1,
          description: 'Riga',
          ...data,
        },
      });
    await expect(line({ quantity: '1' })).rejects.toThrow(/invoice_lines_priced_or_descriptive/);
    await expect(
      line({
        quantity: '2',
        unitPrice: '50',
        vatCode: '22',
        vatRate: '22.00',
        lineAmount: '100.00',
      }),
    ).resolves.toMatchObject({ lineNo: 1 });
    await expect(line({ lineNo: 2 })).resolves.toMatchObject({ lineNo: 2 });
  });

  it('never settles a due date beyond its amount', async () => {
    const invoice = await issued();
    const due = await admin.invoiceDueDate.create({
      data: {
        tenantId: world.tenants.a,
        companyId: world.companies.a,
        invoiceId: invoice.id,
        seq: 1,
        dueDate: new Date('2026-12-05'),
        amount: '122.00',
      },
    });
    await expect(
      asApi(
        Prisma.sql`UPDATE invoice_due_dates SET settled_amount = 122.01 WHERE id = ${due.id}::uuid`,
      ),
    ).rejects.toThrow(/invoice_due_dates_settled_within_amount/);
    await expect(
      asApi(
        Prisma.sql`UPDATE invoice_due_dates SET settled_amount = 122.00 WHERE id = ${due.id}::uuid`,
      ),
    ).resolves.toBe(1);
    await expect(
      asApi(Prisma.sql`UPDATE invoice_due_dates SET amount = 1 WHERE id = ${due.id}::uuid`),
    ).rejects.toThrow(/permission denied/);
  });

  it('lets the API role neither change nor delete an issued document', async () => {
    const { id } = await issued();
    await expect(
      asApi(Prisma.sql`UPDATE invoices SET total = 1 WHERE id = ${id}::uuid`),
    ).rejects.toThrow(/permission denied/);
    await expect(asApi(Prisma.sql`DELETE FROM invoices WHERE id = ${id}::uuid`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(asApi(Prisma.sql`UPDATE invoice_lines SET description = 'x'`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(asApi(Prisma.sql`DELETE FROM invoice_vat_rows`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(asApi(Prisma.sql`UPDATE payments SET amount = 1`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it('shows another tenant none of these documents', async () => {
    const { id } = await issued();
    const seen = await database.runAs({ tenantId: world.tenants.b }, (tx) =>
      tx.invoice.findMany({ where: { id } }),
    );
    expect(seen).toEqual([]);
    const own = await database.runAs({ tenantId: world.tenants.a }, (tx) =>
      tx.invoice.findMany({ where: { id } }),
    );
    expect(own).toHaveLength(1);
  });
});
