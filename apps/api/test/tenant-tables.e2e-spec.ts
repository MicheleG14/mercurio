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

  it('keeps every other table behind Row-Level Security too', async () => {
    const tables = await admin.$queryRaw<{ table: string; enabled: boolean; forced: boolean }[]>`
      SELECT c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname NOT IN ('_prisma_migrations') AND c.relname NOT LIKE 'test\\_%'
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns col
                        WHERE col.table_schema = 'public' AND col.table_name = c.relname
                          AND col.column_name = 'tenant_id')
      ORDER BY c.relname`;

    // Platform tables: people and tenants. Adding one without protection fails here.
    expect(tables.map((t) => t.table)).toEqual([
      'activation_tokens',
      'auth_events',
      'credentials',
      'recovery_codes',
      'sessions',
      'tenants',
      'users',
    ]);
    expect(tables.filter((t) => !(t.enabled && t.forced))).toEqual([]);
  });

  // Every write privilege of the API role is listed here, so a new grant is a deliberate change
  // (conventions B26). Reading is granted more freely and is not listed.
  it('gives the API role exactly the write privileges it needs', async () => {
    const tableWrites = await admin.$queryRaw<{ table: string; privilege: string }[]>`
      SELECT table_name AS table, privilege_type AS privilege
      FROM information_schema.role_table_grants
      WHERE grantee = 'mercurio_app' AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
        AND table_name NOT LIKE 'test\\_%'
      ORDER BY table_name, privilege_type`;
    expect(tableWrites).toEqual([
      { table: 'audit_events', privilege: 'INSERT' },
      { table: 'auth_events', privilege: 'INSERT' },
      { table: 'recovery_codes', privilege: 'INSERT' },
      { table: 'sessions', privilege: 'INSERT' },
    ]);

    // Updates are granted per column; the refresh hashes are not among them (only the rotation
    // function changes them).
    const columnUpdates = await admin.$queryRaw<{ table: string; column: string }[]>`
      SELECT table_name AS table, column_name AS column
      FROM information_schema.column_privileges
      WHERE grantee = 'mercurio_app' AND privilege_type = 'UPDATE'
        AND table_name NOT LIKE 'test\\_%'
      ORDER BY table_name, column_name`;
    const byTable = (name: string) =>
      columnUpdates.filter((c) => c.table === name).map((c) => c.column);
    expect(byTable('credentials')).toEqual([
      'failed_attempts',
      'locked_until',
      'password_hash',
      'totp_confirmed_at',
      'totp_last_step',
      'totp_secret_enc',
      'updated_at',
    ]);
    expect(byTable('recovery_codes')).toEqual(['used_at']);
    expect(byTable('sessions')).toEqual(['last_used_at', 'revoked_at', 'selected_tenant_id']);
    expect([...new Set(columnUpdates.map((c) => c.table))].sort()).toEqual([
      'credentials',
      'recovery_codes',
      'sessions',
    ]);
  });
});
