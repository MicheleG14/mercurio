import { HttpStatus } from '@nestjs/common';
import type { IdentityService } from '../modules/identity/index.js';
import type { TenancyService } from '../modules/tenancy/index.js';
import type { DbClient } from '../prisma/index.js';
import { DomainException } from '../shared/errors/index.js';

/**
 * Fictitious demo data (S2, S8; docs/conventions.md B21): two tenants that show both the
 * company and the tenant boundaries. Content is deterministic; emails use example.com, a domain
 * reserved for examples (RFC 2606), and VAT numbers are made up with a valid check digit.
 *
 * - rossi: two companies, one person per role, two people limited to one company;
 * - bianchi: one company, its own admin;
 * - Paola Conti, a consultant, belongs to both tenants with a different role in each (S4).
 *
 * No activation codes: demo credentials arrive with phase 1b.
 */
export const DEMO = {
  tenants: [
    {
      slug: 'rossi',
      name: 'Gruppo Rossi',
      modules: ['all'],
      companies: [
        { legalName: 'Rossi Srl', vatNumber: withCheckDigit('0274651096') },
        { legalName: 'Rossi Logistica Srl', vatNumber: withCheckDigit('0381927364') },
      ],
      members: [
        { email: 'anna.rossi', name: 'Anna Rossi', role: 'ADMIN', companies: 'all' },
        { email: 'sara.neri', name: 'Sara Neri', role: 'ACCOUNTANT', companies: 'all' },
        { email: 'marco.verdi', name: 'Marco Verdi', role: 'WAREHOUSE_KEEPER', companies: [1] },
        { email: 'luca.gallo', name: 'Luca Gallo', role: 'READ_ONLY', companies: [0] },
        { email: 'paola.conti', name: 'Paola Conti', role: 'ACCOUNTANT', companies: 'all' },
      ],
    },
    {
      slug: 'bianchi',
      name: 'Bianchi Snc',
      modules: ['registry', 'invoicing'],
      companies: [{ legalName: 'Bianchi Snc', vatNumber: withCheckDigit('0519283746') }],
      members: [
        { email: 'giorgio.bianchi', name: 'Giorgio Bianchi', role: 'ADMIN', companies: 'all' },
        { email: 'paola.conti', name: 'Paola Conti', role: 'READ_ONLY', companies: 'all' },
      ],
    },
  ],
} as const;

/**
 * Creates the demo data in `db` (call it inside one transaction). `suffix` exists for tests
 * only: it makes slugs and emails unique, so tests never touch the real demo data.
 */
export async function seedDemo(
  db: DbClient,
  services: { tenancy: TenancyService; identity: IdentityService },
  suffix = '',
) {
  const slug = (base: string) => (suffix ? `${base}-${suffix}` : base);
  const email = (local: string) => `${local}${suffix ? `.${suffix}` : ''}@example.com`;
  const summary: { slug: string; companies: number; members: number }[] = [];

  for (const tenant of DEMO.tenants) {
    const [first, ...others] = tenant.companies;
    let created;
    try {
      created = await services.tenancy.createTenant(db, {
        name: tenant.name,
        slug: slug(tenant.slug),
        modules: tenant.modules,
        company: first,
      });
    } catch (error) {
      if (error instanceof DomainException && error.code === 'TENANT_SLUG_TAKEN') {
        throw new DomainException('DEMO_ALREADY_PRESENT', HttpStatus.CONFLICT, {
          detail: slug(tenant.slug),
        });
      }
      throw error;
    }
    const companyIds = [created.company.id];
    for (const company of others) {
      companyIds.push((await services.tenancy.addCompany(db, created.tenant.slug, company)).id);
    }

    for (const member of tenant.members) {
      await services.identity.addMember(db, {
        tenantId: created.tenant.id,
        email: email(member.email),
        name: member.name,
        role: member.role,
        companies:
          member.companies === 'all' ? 'all' : member.companies.map((index) => companyIds[index]!),
      });
    }
    summary.push({
      slug: created.tenant.slug,
      companies: companyIds.length,
      members: tenant.members.length,
    });
  }
  return summary;
}

/** Appends the Italian VAT check digit to 10 digits, so demo numbers pass validation. */
function withCheckDigit(first10: string): string {
  let sum = 0;
  first10.split('').forEach((char, i) => {
    const digit = Number(char) * (i % 2 === 0 ? 1 : 2);
    sum += digit > 9 ? digit - 9 : digit;
  });
  return first10 + String((10 - (sum % 10)) % 10);
}
