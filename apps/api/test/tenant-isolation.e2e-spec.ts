import { Test } from '@nestjs/testing';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { AppConfigModule } from '../src/config/config.module.js';
import {
  PrismaModule,
  PrismaService,
  TenantContextService,
  TenantDatabase,
  type TenantTransaction,
} from '../src/prisma/index.js';
import { adminClient, createWorld, deleteWorld, type World } from './support/database.js';

// Tenant isolation as the API sees it: TenantDatabase and PrismaService connect as mercurio_app
// (DATABASE_URL), the role subject to Row-Level Security. The owner client only prepares data.
// See docs/adr/0008 and docs/conventions.md B25.
describe('tenant isolation (e2e)', () => {
  let admin: PrismaClient;
  let prisma: PrismaService;
  let db: TenantDatabase;
  let contexts: TenantContextService;
  let world: World;
  let close: () => Promise<void>;

  beforeAll(async () => {
    admin = adminClient();
    world = await createWorld(admin);
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    db = moduleRef.get(TenantDatabase);
    contexts = moduleRef.get(TenantContextService);
    close = () => moduleRef.close();
  });

  afterAll(async () => {
    await close?.();
    if (world) await deleteWorld(admin, world);
    await admin.$disconnect();
  });

  const inTenant = <T>(
    tenantId: string,
    work: (tx: TenantTransaction) => Promise<T>,
    userId?: string,
  ) => db.runAs({ tenantId, userId }, work);
  const ours = (w: World) => ({ in: Object.values(w.tenants) });

  describe('reading', () => {
    it('shows each tenant only its own rows, in every tenant table', async () => {
      const seen = await inTenant(world.tenants.b, async (tx) => ({
        companies: await tx.company.findMany({ where: { tenantId: ours(world) } }),
        modules: await tx.tenantModule.findMany({ where: { tenantId: ours(world) } }),
        memberships: await tx.membership.findMany({ where: { tenantId: ours(world) } }),
        reachable: await tx.membershipCompany.findMany({ where: { tenantId: ours(world) } }),
      }));

      for (const rows of Object.values(seen)) {
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((row) => row.tenantId === world.tenants.b)).toBe(true);
      }
      expect(seen.companies.map((c) => c.id).sort()).toEqual(
        [world.companies.b, world.companies.b2].sort(),
      );
    });

    it('finds nothing of another tenant even when asked by id', async () => {
      const found = await inTenant(world.tenants.a, (tx) =>
        tx.company.findUnique({ where: { id: world.companies.b } }),
      );

      expect(found).toBeNull();
    });

    it('shows no tenant row at all without a context', async () => {
      const where = { tenantId: ours(world) };

      expect(await prisma.company.count({ where })).toBe(0);
      expect(await prisma.membership.count({ where })).toBe(0);
      expect(await prisma.tenant.count({ where: { id: ours(world) } })).toBe(0);
      expect(await prisma.user.count({ where: { id: { in: Object.values(world.users) } } })).toBe(
        0,
      );
    });

    it('uses the context of the current operation', async () => {
      const ids = await contexts.run({ tenantId: world.tenants.c }, () =>
        db.run((tx) => tx.company.findMany({ where: { tenantId: ours(world) } })),
      );

      expect(ids.map((c) => c.id)).toEqual([world.companies.c]);
      await expect(db.run(async () => 0)).rejects.toThrow(/No tenant context/);
    });

    it('rejects a malformed context instead of guessing', async () => {
      await expect(db.runAs({ tenantId: 'not-a-uuid' }, async () => 0)).rejects.toThrow(
        /Invalid tenantId/,
      );
    });
  });

  describe('platform tables', () => {
    it("shows the members of the current tenant and the user's own tenants", async () => {
      const seen = await inTenant(
        world.tenants.a,
        async (tx) => ({
          tenants: await tx.tenant.findMany({ where: { id: ours(world) } }),
          users: await tx.user.findMany({ where: { id: { in: Object.values(world.users) } } }),
          memberships: await tx.membership.findMany({ where: { tenantId: ours(world) } }),
        }),
        world.users.u,
      );

      // U belongs to A and B: both tenants visible, C not.
      expect(seen.tenants.map((t) => t.id).sort()).toEqual(
        [world.tenants.a, world.tenants.b].sort(),
      );
      // Members of A (only U) are visible; V and W, members elsewhere, are not.
      expect(seen.users.map((u) => u.id)).toEqual([world.users.u]);
      // All of A's memberships, plus U's own in B, never V's membership in B.
      expect(seen.memberships.map((m) => m.id).sort()).toEqual(
        [world.memberships.ua, world.memberships.ub].sort(),
      );
    });

    it('stops showing another tenant once the membership there is removed', async () => {
      await admin.membership.update({
        where: { id: world.memberships.ub },
        data: { status: 'REMOVED' },
      });
      try {
        const tenants = await inTenant(
          world.tenants.a,
          (tx) => tx.tenant.findMany({ where: { id: ours(world) } }),
          world.users.u,
        );

        expect(tenants.map((t) => t.id)).toEqual([world.tenants.a]);
      } finally {
        await admin.membership.update({
          where: { id: world.memberships.ub },
          data: { status: 'ACTIVE' },
        });
      }
    });

    it('gives the API role no way to read activation codes', async () => {
      await expect(prisma.activationToken.count()).rejects.toThrow(/permission denied/i);
    });
  });

  describe('writing', () => {
    it('lets the API role write nothing yet: privileges arrive with the features that need them', async () => {
      await expect(
        inTenant(world.tenants.a, (tx) =>
          tx.company.create({
            data: { tenantId: world.tenants.a, legalName: 'X', vatNumber: '00000000009' },
          }),
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('refuses, at schema level, to link a membership to a company of another tenant', async () => {
      // Even the owner role, which bypasses Row-Level Security, cannot cross tenants here.
      await expect(
        admin.membershipCompany.create({
          data: {
            tenantId: world.tenants.a,
            membershipId: world.memberships.ua,
            companyId: world.companies.b,
          },
        }),
      ).rejects.toThrow(/foreign key/i);
    });
  });

  // Write isolation is proven on a probe table protected by the same function every tenant
  // table uses (mercurio_enable_tenant_isolation), with full privileges for the API role.
  describe('writing on a table with the standard protection', () => {
    beforeAll(async () => {
      // One transaction: other test files never see the table without its protection.
      await admin.$transaction([
        admin.$executeRawUnsafe('DROP TABLE IF EXISTS test_isolation_probe'),
        admin.$executeRawUnsafe(
          'CREATE TABLE test_isolation_probe (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, label text NOT NULL)',
        ),
        admin.$executeRawUnsafe(`SELECT mercurio_enable_tenant_isolation('test_isolation_probe')`),
        admin.$executeRawUnsafe(
          'GRANT SELECT, INSERT, UPDATE, DELETE ON test_isolation_probe TO mercurio_app',
        ),
      ]);
      await admin.$executeRawUnsafe(
        `INSERT INTO test_isolation_probe VALUES
           ('00000000-0000-7000-8000-0000000000b1', '${world.tenants.b}', 'b-row')`,
      );
    });

    afterAll(async () => {
      await admin.$executeRawUnsafe('DROP TABLE IF EXISTS test_isolation_probe');
    });

    it('accepts rows of the current tenant', async () => {
      const inserted = await inTenant(
        world.tenants.a,
        (tx) =>
          tx.$executeRaw`INSERT INTO test_isolation_probe VALUES
            ('00000000-0000-7000-8000-0000000000a1', ${world.tenants.a}::uuid, 'a-row')`,
      );

      expect(inserted).toBe(1);
    });

    it('rejects a row for another tenant', async () => {
      await expect(
        inTenant(
          world.tenants.a,
          (tx) =>
            tx.$executeRaw`INSERT INTO test_isolation_probe VALUES
              ('00000000-0000-7000-8000-0000000000a2', ${world.tenants.b}::uuid, 'sneaky')`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('updates and deletes nothing of another tenant', async () => {
      const changed = await inTenant(world.tenants.a, async (tx) => ({
        updated: await tx.$executeRaw`UPDATE test_isolation_probe SET label = 'hacked'
                                      WHERE tenant_id = ${world.tenants.b}::uuid`,
        deleted: await tx.$executeRaw`DELETE FROM test_isolation_probe
                                      WHERE tenant_id = ${world.tenants.b}::uuid`,
      }));

      expect(changed).toEqual({ updated: 0, deleted: 0 });
      const rows = await admin.$queryRaw<{ label: string }[]>`
        SELECT label FROM test_isolation_probe WHERE tenant_id = ${world.tenants.b}::uuid`;
      expect(rows).toEqual([{ label: 'b-row' }]);
    });

    it('refuses to move a row to another tenant', async () => {
      await expect(
        inTenant(
          world.tenants.a,
          (tx) =>
            tx.$executeRaw`UPDATE test_isolation_probe SET tenant_id = ${world.tenants.b}::uuid
                           WHERE tenant_id = ${world.tenants.a}::uuid`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('sees nothing without a context', async () => {
      const rows = await prisma.$queryRaw<unknown[]>`SELECT * FROM test_isolation_probe`;

      expect(rows).toEqual([]);
    });
  });

  describe('connection pool', () => {
    it('never lets the context of one operation reach another', async () => {
      const tenants = Array.from(
        { length: 30 },
        (_, i) => [world.tenants.a, world.tenants.b, world.tenants.c][i % 3]!,
      );

      const results = await Promise.all(
        tenants.map((tenantId) =>
          inTenant(tenantId, async (tx) => {
            await tx.$executeRaw`SELECT pg_sleep(0.01)`;
            const rows = await tx.company.findMany({ where: { tenantId: ours(world) } });
            return rows.every((row) => row.tenantId === tenantId) && rows.length > 0;
          }),
        ),
      );

      expect(results.every(Boolean)).toBe(true);
      // After all those transactions, the pooled connections carry no context.
      expect(await prisma.company.count({ where: { tenantId: ours(world) } })).toBe(0);
    });
  });
});
