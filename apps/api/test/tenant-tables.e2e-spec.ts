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
        'items',
        'membership_companies',
        'memberships',
        'parties',
        'reorder_levels',
        'stock_balances',
        'stock_document_counters',
        'stock_documents',
        'stock_movements',
        'tenant_modules',
        'warehouses',
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
    const columnsOf = async (table: string) =>
      (
        await admin.$queryRaw<{ column: string }[]>`
          SELECT column_name AS column FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${table}`
      ).map((c) => c.column);
    const [partyColumns, itemColumns] = [await columnsOf('parties'), await columnsOf('items')];

    const tableWrites = await admin.$queryRaw<{ table: string; privilege: string }[]>`
      SELECT table_name AS table, privilege_type AS privilege
      FROM information_schema.role_table_grants
      WHERE grantee = 'mercurio_app' AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
        AND table_name NOT LIKE 'test\\_%'
      ORDER BY table_name, privilege_type`;
    // Stock documents and movements: insert only (B32). Reorder levels are settings: deletable.
    expect(tableWrites).toEqual([
      { table: 'audit_events', privilege: 'INSERT' },
      { table: 'auth_events', privilege: 'INSERT' },
      { table: 'items', privilege: 'INSERT' },
      { table: 'parties', privilege: 'INSERT' },
      { table: 'recovery_codes', privilege: 'INSERT' },
      { table: 'reorder_levels', privilege: 'DELETE' },
      { table: 'reorder_levels', privilege: 'INSERT' },
      { table: 'sessions', privilege: 'INSERT' },
      { table: 'stock_balances', privilege: 'INSERT' },
      { table: 'stock_document_counters', privilege: 'INSERT' },
      { table: 'stock_documents', privilege: 'INSERT' },
      { table: 'stock_movements', privilege: 'INSERT' },
      { table: 'warehouses', privilege: 'INSERT' },
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
    // Registry rows: never the id or the tenant, and never an item's code (it is never reused,
    // so it never changes either). No DELETE at all: they are archived (B31).
    const identity = ['created_at', 'id', 'tenant_id'];
    expect(byTable('parties')).toEqual(
      partyColumns.filter((column) => !identity.includes(column)).sort(),
    );
    expect(byTable('items')).toEqual(
      itemColumns.filter((column) => ![...identity, 'code'].includes(column)).sort(),
    );
    // Warehouse: a balance changes only in quantity, a warehouse never in code or company, a
    // counter only in its last number.
    expect(byTable('stock_balances')).toEqual(['quantity', 'updated_at']);
    expect(byTable('warehouses')).toEqual(['archived_at', 'name', 'updated_at', 'version']);
    expect(byTable('reorder_levels')).toEqual([
      'reorder_point',
      'reorder_quantity',
      'updated_at',
      'version',
    ]);
    expect(byTable('stock_document_counters')).toEqual(['last_number']);
    expect([...new Set(columnUpdates.map((c) => c.table))].sort()).toEqual([
      'credentials',
      'items',
      'parties',
      'recovery_codes',
      'reorder_levels',
      'sessions',
      'stock_balances',
      'stock_document_counters',
      'warehouses',
    ]);
  });
});
