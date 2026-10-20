import { NestFactory } from '@nestjs/core';
import { CliModule } from '../src/cli/cli.module.js';
import type { CliIo } from '../src/cli/commands.js';
import { runCli } from '../src/cli/run-cli.js';
import { DEMO } from '../src/cli/seed-demo.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { adminClient, deleteTenantsAndUsers, uniqueSuffix } from './support/database.js';

// What the terminal commands leave in the audit log, and the commands added for recovery.
// Valid Italian VAT numbers (with their check digit), reused from the demo data.
const [VAT_1, VAT_2] = DEMO.tenants[0].companies.map((c) => c.vatNumber) as [string, string];

describe('terminal commands and the audit log (e2e)', () => {
  let admin: PrismaClient;
  const suffix = uniqueSuffix();
  const slug = `audit-${suffix}`;
  const email = (name: string) => `${name}.${suffix}@example.com`;

  async function cli(...argv: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIo = {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      audit: () => undefined,
    };
    const code = await runCli(argv, io, () =>
      NestFactory.createApplicationContext(CliModule, { logger: false }),
    );
    return { code, out: out.join('\n'), err: err.join('\n') };
  }

  beforeAll(async () => {
    admin = adminClient();
    const created = await cli(
      'create-tenant',
      '--name',
      'Audit Test',
      '--slug',
      slug,
      '--modules',
      'registry,warehouse',
      '--company-name',
      'Audit Srl',
      '--vat',
      VAT_1,
      '--admin-email',
      email('boss'),
      '--admin-name',
      'Boss',
    );
    expect(created.code).toBe(0);
  });

  afterAll(async () => {
    const tenants = await admin.tenant.findMany({ where: { slug: { startsWith: slug } } });
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

  const events = async () => {
    const tenant = await admin.tenant.findUniqueOrThrow({ where: { slug } });
    return admin.auditEvent.findMany({ where: { tenantId: tenant.id }, orderBy: { id: 'asc' } });
  };

  it('records every change a command makes, as the terminal operator', async () => {
    await cli('add-company', '--tenant', slug, '--name', 'Second Srl', '--vat', VAT_2);
    await cli(
      'add-user',
      '--tenant',
      slug,
      '--email',
      email('mario'),
      '--name',
      'Mario',
      '--role',
      'READ_ONLY',
      '--companies',
      'all',
    );
    await cli('set-modules', '--tenant', slug, '--enable', 'orders');
    await cli('remove-user', '--tenant', slug, '--email', email('mario'));

    const log = await events();

    expect(log.map((e) => e.type)).toEqual([
      'TENANT_CREATED',
      'MEMBER_ADDED',
      'COMPANY_ADDED',
      'MEMBER_ADDED',
      'MODULES_CHANGED',
      'MEMBER_REMOVED',
    ]);
    expect(log.every((e) => e.source === 'CLI' && e.actorUserId === null)).toBe(true);
  });

  it('never writes an activation code into the log', async () => {
    const printed = await cli(
      'add-user',
      '--tenant',
      slug,
      '--email',
      email('luisa'),
      '--name',
      'Luisa',
      '--role',
      'ACCOUNTANT',
      '--companies',
      'all',
    );
    const code = /^ {2}([A-Za-z0-9_-]{43})$/m.exec(printed.out)![1]!;

    const stored = JSON.stringify([...(await events()), ...(await admin.authEvent.findMany())]);
    expect(stored).not.toContain(code);
  });

  it('records nothing when the command is refused', async () => {
    const before = (await events()).length;
    const res = await cli('add-company', '--tenant', slug, '--name', 'Dup', '--vat', VAT_1);

    expect(res.code).toBe(1);
    expect((await events()).length).toBe(before);
  });

  it('treats a new code for an active account as a recovery, and says so', async () => {
    const user = await admin.user.findUniqueOrThrow({ where: { email: email('luisa') } });

    const first = await cli('issue-code', '--email', email('luisa'));
    expect(first.out).not.toContain('RECOVERY');

    await admin.credential.create({ data: { userId: user.id, passwordHash: 'hash' } });
    const second = await cli('issue-code', '--email', email('luisa'));

    expect(second.out).toContain('RECOVERY');
    const types = (await admin.authEvent.findMany({ where: { userId: user.id } })).map(
      (e) => e.type,
    );
    expect(types).toEqual(['ACCOUNT_RECOVERY_ISSUED']);
  });

  it('signs a person out everywhere', async () => {
    const user = await admin.user.findUniqueOrThrow({ where: { email: email('luisa') } });
    for (const label of ['a', 'b']) {
      await admin.session.create({
        data: {
          userId: user.id,
          refreshHash: `${label}-${suffix}`,
          absoluteExpiresAt: new Date(Date.now() + 86_400_000),
        },
      });
    }

    const res = await cli('revoke-sessions', '--email', email('luisa'));

    expect(res.out).toContain('2 session(s)');
    expect(await admin.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    await cli('revoke-sessions', '--email', email('nobody')).then((r) => expect(r.code).toBe(1));
  });
});
