import { Prisma } from '../generated/prisma/client.js';
import type { DbClient } from '../prisma/index.js';
import {
  DEMO_EMAILS,
  DEMO_SLUGS,
  type SeedOptions,
  type SeedServices,
  seedDemo,
} from './seed-demo.js';

/**
 * Deletes everything of the given tenants, in an order the foreign keys accept: what points to a
 * row goes before it. Run as the owner role, inside a transaction. People (users) stay: they are
 * not of a tenant, and may belong to others. The audit log of these tenants goes too: its
 * append-only trigger is turned off for this transaction only, which no API role can do.
 *
 * The one place where issued fiscal documents are deleted (docs/adr/0034): `reset-demo` calls it
 * for the demo tenants only, and tests for their own. Afterwards it checks that no table with a
 * `tenant_id` still holds a row of these tenants, so a table added later cannot be forgotten.
 */
export async function deleteTenantData(db: DbClient, tenantIds: readonly string[]): Promise<void> {
  if (tenantIds.length === 0) return;
  const tenantId = { in: [...tenantIds] };
  await db.$executeRaw`SET LOCAL session_replication_role = replica`;
  await db.auditEvent.deleteMany({ where: { tenantId } });
  await db.$executeRaw`SET LOCAL session_replication_role = origin`;
  await db.session.deleteMany({ where: { selectedTenantId: tenantId } });
  // Invoicing: what points to documents goes before them, credit notes before what they credit.
  await db.paymentAllocation.deleteMany({ where: { tenantId } });
  await db.creditAllocation.deleteMany({ where: { tenantId } });
  await db.payment.deleteMany({ where: { tenantId, reversesId: { not: null } } });
  await db.payment.deleteMany({ where: { tenantId } });
  await db.invoiceDueDate.deleteMany({ where: { tenantId } });
  await db.invoiceDraftLine.deleteMany({ where: { tenantId } });
  await db.invoiceLine.deleteMany({ where: { tenantId, creditedLineId: { not: null } } });
  await db.invoiceLine.deleteMany({ where: { tenantId } });
  await db.invoiceVatRow.deleteMany({ where: { tenantId } });
  await db.invoiceableLine.deleteMany({ where: { tenantId } });
  await db.invoiceableFulfilment.deleteMany({ where: { tenantId } });
  await db.invoiceDraft.deleteMany({ where: { tenantId } });
  await db.invoice.deleteMany({ where: { tenantId, creditedInvoiceId: { not: null } } });
  await db.invoice.deleteMany({ where: { tenantId } });
  await db.invoiceCounter.deleteMany({ where: { tenantId } });
  // Orders first: their fulfilments point to stock documents.
  await db.orderFulfilmentLine.deleteMany({ where: { tenantId } });
  await db.orderFulfilment.deleteMany({ where: { tenantId } });
  await db.orderLine.deleteMany({ where: { tenantId } });
  await db.order.deleteMany({ where: { tenantId } });
  await db.orderCounter.deleteMany({ where: { tenantId } });
  await db.stockMovement.deleteMany({ where: { tenantId } });
  await db.stockReservation.deleteMany({ where: { tenantId } });
  await db.stockBalance.deleteMany({ where: { tenantId } });
  await db.reorderLevel.deleteMany({ where: { tenantId } });
  await db.stockDocumentCounter.deleteMany({ where: { tenantId } });
  // Reversals point to the documents they reverse: they go first.
  await db.stockDocument.deleteMany({ where: { tenantId, reversesId: { not: null } } });
  await db.stockDocument.deleteMany({ where: { tenantId } });
  await db.warehouse.deleteMany({ where: { tenantId } });
  await db.party.deleteMany({ where: { tenantId } });
  await db.item.deleteMany({ where: { tenantId } });
  await db.membershipCompany.deleteMany({ where: { tenantId } });
  await db.membership.deleteMany({ where: { tenantId } });
  await db.tenantModule.deleteMany({ where: { tenantId } });
  await db.company.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });

  const tables = await db.$queryRaw<{ table: string }[]>`
    SELECT c.table_name AS table
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
      AND t.table_type = 'BASE TABLE'`;
  for (const { table } of tables) {
    const [row] = await db.$queryRaw<{ left: bigint }[]>`
      SELECT count(*) AS left FROM ${Prisma.raw(`"${table}"`)}
      WHERE tenant_id = ANY(${[...tenantIds]}::uuid[])`;
    if (row && row.left > 0n) {
      throw new Error(`deleteTenantData: ${table} still holds rows of the tenants (add it above)`);
    }
  }
}

/** A person outside the demo who belongs to a demo tenant: put back after the reset. */
export interface KeptMember {
  slug: string;
  email: string;
  name: string;
  role: string;
  /** "all", or the VAT numbers of the companies the person reaches (the same after the reset). */
  companies: 'all' | string[];
}

/**
 * Who belongs to the demo tenants without being a demo person: the operator's own account, for
 * one. `reset-demo` lists them first and puts them back with the same role.
 */
export async function keptMembers(db: DbClient, suffix = ''): Promise<KeptMember[]> {
  const slugs = DEMO_SLUGS.map((s) => (suffix ? `${s}-${suffix}` : s));
  const demo = new Set(DEMO_EMAILS.map((e) => (suffix ? e.replace('@', `.${suffix}@`) : e)));
  // One relation at a time (B39).
  const memberships = await db.membership.findMany({
    where: { tenant: { slug: { in: slugs } }, status: 'ACTIVE' },
  });
  const tenants = await db.tenant.findMany({ where: { slug: { in: slugs } } });
  const users = await db.user.findMany({
    where: { id: { in: memberships.map((m) => m.userId) } },
  });
  const links = await db.membershipCompany.findMany({
    where: { membershipId: { in: memberships.map((m) => m.id) } },
  });
  const companies = await db.company.findMany({
    where: { id: { in: links.map((l) => l.companyId) } },
  });
  const slugOf = new Map(tenants.map((t) => [t.id, t.slug]));
  const userOf = new Map(users.map((u) => [u.id, u]));
  const vatOf = new Map(companies.map((c) => [c.id, c.vatNumber]));
  return memberships
    .map((m) => ({ m, user: userOf.get(m.userId)! }))
    .filter(({ user }) => !demo.has(user.email))
    .map(({ m, user }) => ({
      slug: slugOf.get(m.tenantId)!,
      email: user.email,
      name: user.name,
      role: m.role,
      companies: m.allCompanies
        ? ('all' as const)
        : links.filter((l) => l.membershipId === m.id).map((l) => vatOf.get(l.companyId)!),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug) || a.email.localeCompare(b.email));
}

/**
 * Deletes the demo tenants and creates them again with a fresh history up to `today`, then puts
 * back the people outside the demo who belonged to them. One transaction: if anything fails, the
 * old data stays.
 */
export async function resetDemo(db: DbClient, services: SeedServices, options: SeedOptions = {}) {
  const suffix = options.suffix ?? '';
  const slugs = DEMO_SLUGS.map((s) => (suffix ? `${s}-${suffix}` : s));
  const kept = await keptMembers(db, suffix);
  const tenants = await db.tenant.findMany({
    where: { slug: { in: slugs } },
    select: { id: true },
  });
  await deleteTenantData(
    db,
    tenants.map((t) => t.id),
  );
  const seeded = await seedDemo(db, services, options);
  for (const member of kept) {
    const tenant = await services.tenancy.findTenantBySlug(db, member.slug);
    if (!tenant) continue;
    const companies =
      member.companies === 'all'
        ? ('all' as const)
        : await services.tenancy.companyIdsByVat(db, tenant.id, member.companies);
    await services.identity.addMember(db, {
      tenantId: tenant.id,
      email: member.email,
      name: member.name,
      role: member.role,
      companies,
    });
  }
  return { ...seeded, kept, deleted: tenants.length };
}
