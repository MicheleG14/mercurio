import { HttpStatus, type INestApplicationContext } from '@nestjs/common';
import type { ParseArgsOptionsConfig } from 'node:util';
import { IdentityService } from '../modules/identity/index.js';
import { MODULE_KEYS, TenancyService } from '../modules/tenancy/index.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/index.js';
import { DomainException } from '../shared/errors/index.js';
import { seedDemo } from './seed-demo.js';

/** Where a command writes: human-readable lines, and one audit event per completed command. */
export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  /** Structured record of what was done. Never contains activation codes. */
  audit(event: Record<string, unknown>): void;
}

/** Option values; boolean flags arrive as 'true' (see runCli). */
type Values = Record<string, string | undefined>;

interface Services {
  config: AppConfig;
  prisma: PrismaService;
  tenancy: TenancyService;
  identity: IdentityService;
}

export interface Command {
  summary: string;
  options: ParseArgsOptionsConfig;
  required: string[];
  run(services: Services, values: Values, io: CliIo): Promise<void>;
}

const text = { type: 'string' } as const;

/** "a, b,c" → ["a", "b", "c"] */
function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function printActivation(io: CliIo, activation: { code: string; expiresAt: Date }, email: string) {
  io.out('');
  io.out(`Activation code for ${email} (valid until ${activation.expiresAt.toISOString()}):`);
  io.out(`  ${activation.code}`);
  io.out('Shown only once and stored only as a hash: hand it over privately.');
}

export const COMMANDS: Record<string, Command> = {
  'create-tenant': {
    summary: 'Create a tenant with its first company, modules and administrator',
    options: {
      name: text,
      slug: text,
      modules: text,
      'company-name': text,
      vat: text,
      'tax-code': text,
      country: text,
      'admin-email': text,
      'admin-name': text,
    },
    required: ['name', 'slug', 'modules', 'company-name', 'vat', 'admin-email', 'admin-name'],
    async run({ prisma, tenancy, identity }, v, io) {
      // One transaction across both modules: the tenant exists with its admin, or not at all.
      const { created, admin } = await prisma.$transaction(async (tx) => {
        const created = await tenancy.createTenant(tx, {
          name: v.name!,
          slug: v.slug!,
          modules: list(v.modules),
          company: {
            legalName: v['company-name']!,
            vatNumber: v.vat!,
            taxCode: v['tax-code'],
            country: v.country,
          },
        });
        const admin = await identity.addMember(tx, {
          tenantId: created.tenant.id,
          email: v['admin-email']!,
          name: v['admin-name']!,
          role: 'ADMIN',
          companies: 'all',
        });
        return { created, admin };
      });

      io.out(`Tenant ${created.tenant.slug} created: ${created.tenant.name}`);
      io.out(`  company: ${created.company.legalName} (VAT ${created.company.vatNumber})`);
      io.out(`  modules: ${created.modules.join(', ')}`);
      io.out(
        `  admin:   ${admin.email}${admin.identityCreated ? '' : ' (existing identity, no new code)'}`,
      );
      if (admin.activation) printActivation(io, admin.activation, admin.email);
      io.audit({
        command: 'create-tenant',
        tenant: created.tenant.slug,
        modules: created.modules,
        admin: admin.email,
      });
    },
  },

  'add-company': {
    summary: 'Add a company to a tenant',
    options: { tenant: text, name: text, vat: text, 'tax-code': text, country: text },
    required: ['tenant', 'name', 'vat'],
    async run({ prisma, tenancy }, v, io) {
      const company = await prisma.$transaction((tx) =>
        tenancy.addCompany(tx, v.tenant!, {
          legalName: v.name!,
          vatNumber: v.vat!,
          taxCode: v['tax-code'],
          country: v.country,
        }),
      );
      io.out(`Company ${company.legalName} (VAT ${company.vatNumber}) added to ${v.tenant}`);
      io.audit({ command: 'add-company', tenant: v.tenant, vat: company.vatNumber });
    },
  },

  'add-user': {
    summary: 'Add a person to a tenant (reusing their identity if it exists)',
    options: { tenant: text, email: text, name: text, role: text, companies: text },
    required: ['tenant', 'email', 'name', 'role', 'companies'],
    async run({ prisma, tenancy, identity }, v, io) {
      const added = await prisma.$transaction(async (tx) => {
        const tenant = await tenancy.requireTenant(tx, v.tenant!);
        const companies =
          v.companies === 'all'
            ? 'all'
            : await tenancy.companyIdsByVat(tx, tenant.id, list(v.companies));
        return identity.addMember(tx, {
          tenantId: tenant.id,
          email: v.email!,
          name: v.name!,
          role: v.role!,
          companies,
        });
      });
      const how = added.reactivated ? 'reactivated in' : 'added to';
      io.out(`${added.email} ${how} ${v.tenant} as ${v.role!.toUpperCase()}`);
      if (!added.identityCreated) io.out('  existing identity: no new activation code');
      if (added.activation) printActivation(io, added.activation, added.email);
      io.audit({
        command: 'add-user',
        tenant: v.tenant,
        email: added.email,
        role: v.role!.toUpperCase(),
        companies: v.companies,
      });
    },
  },

  'remove-user': {
    summary: 'Remove a person from a tenant (the identity and its history stay)',
    options: { tenant: text, email: text },
    required: ['tenant', 'email'],
    async run({ prisma, tenancy, identity }, v, io) {
      await prisma.$transaction(async (tx) => {
        const tenant = await tenancy.requireTenant(tx, v.tenant!);
        await identity.removeMember(tx, { tenantId: tenant.id, email: v.email! });
      });
      io.out(`${v.email} removed from ${v.tenant}`);
      io.audit({ command: 'remove-user', tenant: v.tenant, email: v.email });
    },
  },

  'set-modules': {
    summary: 'Enable or disable modules of a tenant, respecting their dependencies',
    options: { tenant: text, enable: text, disable: text },
    required: ['tenant'],
    async run({ prisma, tenancy }, v, io) {
      const modules = await prisma.$transaction((tx) =>
        tenancy.setModules(tx, v.tenant!, { enable: list(v.enable), disable: list(v.disable) }),
      );
      io.out(`Modules of ${v.tenant}: ${modules.join(', ')}`);
      io.audit({ command: 'set-modules', tenant: v.tenant, modules });
    },
  },

  'issue-code': {
    summary: 'Issue a new activation code for a person (the unused previous one stops working)',
    options: { email: text },
    required: ['email'],
    async run({ prisma, identity }, v, io) {
      const issued = await prisma.$transaction((tx) =>
        identity.issueActivationCodeFor(tx, v.email!),
      );
      printActivation(io, issued, issued.email);
      io.audit({ command: 'issue-code', email: issued.email });
    },
  },

  'seed-demo': {
    summary:
      'Create the fictitious demo tenants (refused in production without --allow-production)',
    options: { 'allow-production': { type: 'boolean' } },
    required: [],
    async run({ config, prisma, tenancy, identity }, v, io) {
      if (config.isProduction && v['allow-production'] !== 'true') {
        throw new DomainException('DEMO_IN_PRODUCTION', HttpStatus.CONFLICT, {
          detail: 'add --allow-production to seed a production database on purpose',
        });
      }
      const seeded = await prisma.$transaction((tx) => seedDemo(tx, { tenancy, identity }));
      for (const tenant of seeded) {
        io.out(
          `Demo tenant ${tenant.slug}: ${tenant.companies} companies, ${tenant.members} members`,
        );
      }
      io.out('Fictitious data. Sign-in for demo users arrives with phase 1b.');
      io.audit({ command: 'seed-demo', tenants: seeded.map((t) => t.slug) });
    },
  },

  'list-tenants': {
    summary: 'List tenants with their companies, modules and members',
    options: {},
    required: [],
    async run({ prisma, tenancy, identity }, _v, io) {
      const tenants = await tenancy.listTenants(prisma);
      if (tenants.length === 0) io.out('No tenants yet.');
      for (const tenant of tenants) {
        const vatById = new Map(tenant.companies.map((c) => [c.id, c.vatNumber]));
        io.out(`${tenant.slug}  ${tenant.name}  [${tenant.status}]`);
        const enabled = new Set(tenant.modules.map((m) => m.moduleKey));
        io.out(`  modules:   ${MODULE_KEYS.filter((key) => enabled.has(key)).join(', ')}`);
        for (const company of tenant.companies) {
          io.out(`  company:   ${company.legalName} (VAT ${company.vatNumber})`);
        }
        for (const member of await identity.listMembers(prisma, tenant.id)) {
          const reach = member.access.allCompanies
            ? 'all companies'
            : member.access.companyIds.map((id) => vatById.get(id)).join(', ');
          io.out(`  member:    ${member.email}  ${member.role}  [${member.status}]  ${reach}`);
        }
      }
    },
  },
};

export function resolveServices(app: INestApplicationContext): Services {
  return {
    config: app.get<AppConfig>(APP_CONFIG),
    prisma: app.get(PrismaService),
    tenancy: app.get(TenancyService),
    identity: app.get(IdentityService),
  };
}
