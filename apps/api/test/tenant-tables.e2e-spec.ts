import type { PrismaClient } from '../src/generated/prisma/client.js';
import { adminClient } from './support/database.js';

// Guard test (docs/conventions.md B25): every table with a tenant_id column must have
// Row-Level Security enabled and forced, and the standard tenant_isolation policy. A future
// migration that forgets the protection fails CI here instead of exposing data.
describe('tenant tables (guard)', () => {
  let admin: PrismaClient;

  beforeAll(() => {
    admin = adminClient();
  });

  afterAll(async () => {
    await admin.$disconnect();
  });

  it('protects every table that holds tenant data', async () => {
    const tables = await admin.$queryRaw<
      { table: string; enabled: boolean; forced: boolean; isolated: boolean }[]
    >`
      SELECT c.relname AS table,
             c.relrowsecurity AS enabled,
             c.relforcerowsecurity AS forced,
             EXISTS (SELECT 1 FROM pg_policies p
                     WHERE p.schemaname = 'public' AND p.tablename = c.relname
                       AND p.policyname = 'tenant_isolation') AS isolated
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = 'public' AND col.table_name = c.relname
                      AND col.column_name = 'tenant_id')
      ORDER BY c.relname`;

    expect(tables.map((t) => t.table)).toEqual(
      expect.arrayContaining([
        'companies',
        'membership_companies',
        'memberships',
        'tenant_modules',
      ]),
    );
    const unprotected = tables.filter((t) => !(t.enabled && t.forced && t.isolated));
    expect(unprotected).toEqual([]);
  });

  it('keeps the platform tables behind Row-Level Security too', async () => {
    const tables = await admin.$queryRaw<{ table: string; enabled: boolean; forced: boolean }[]>`
      SELECT relname AS table, relrowsecurity AS enabled, relforcerowsecurity AS forced
      FROM pg_class
      WHERE relname IN ('tenants', 'users', 'activation_tokens') AND relkind = 'r'
      ORDER BY relname`;

    expect(tables).toEqual([
      { table: 'activation_tokens', enabled: true, forced: true },
      { table: 'tenants', enabled: true, forced: true },
      { table: 'users', enabled: true, forced: true },
    ]);
  });

  // Phase 1a grants no write access. When a feature needs it, this becomes an explicit list of
  // the expected (table, privilege) pairs, so every new grant is a deliberate change.
  it('gives the API role read access only', async () => {
    const writable = await admin.$queryRaw<{ table: string }[]>`
      SELECT table_name AS table FROM information_schema.role_table_grants
      WHERE grantee = 'mercurio_app' AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
        AND table_name NOT LIKE 'test\\_%'`;

    expect(writable).toEqual([]);
  });
});
