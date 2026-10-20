import { HttpStatus, Injectable } from '@nestjs/common';
import type { DbClient } from '../../prisma/index.js';
import { DomainException } from '../../shared/errors/index.js';
import { normalizeName } from '../../shared/text.js';
import { normalizeCountry, normalizeTaxCode, normalizeVatNumber } from './company-identifiers.js';
import { applyModuleChange, type ModuleKey, parseModuleKeys } from './module-catalog.js';
import { TenancyRepository } from './tenancy.repository.js';
import { normalizeSlug } from './tenant-slug.js';

export interface CompanyInput {
  legalName: string;
  vatNumber: string;
  taxCode?: string;
  country?: string;
}

/**
 * Public service of the tenancy module (B3): tenants, their companies and enabled modules.
 * Methods take the database client so a caller can combine several modules in one transaction.
 */
@Injectable()
export class TenancyService {
  constructor(private readonly repository: TenancyRepository) {}

  /** A new tenant with its first company and the chosen modules (registry is always added). */
  async createTenant(
    db: DbClient,
    input: { name: string; slug: string; modules: readonly string[]; company: CompanyInput },
  ) {
    const modules = applyModuleChange([], { enable: parseModuleKeys(input.modules) });
    const company = this.normalizeCompany(input.company);
    const tenant = await this.repository.createTenant(db, {
      name: normalizeName(input.name),
      slug: normalizeSlug(input.slug),
    });
    const created = await this.repository.createCompany(db, { tenantId: tenant.id, ...company });
    await this.repository.replaceModules(db, tenant.id, modules);
    return { tenant, company: created, modules };
  }

  async addCompany(db: DbClient, tenantSlug: string, input: CompanyInput) {
    const tenant = await this.requireTenant(db, tenantSlug);
    return this.repository.createCompany(db, {
      tenantId: tenant.id,
      ...this.normalizeCompany(input),
    });
  }

  /** Enables and disables modules, refusing any result that breaks a dependency. */
  async setModules(
    db: DbClient,
    tenantSlug: string,
    change: { enable?: readonly string[]; disable?: readonly string[] },
  ): Promise<ModuleKey[]> {
    const tenant = await this.requireTenant(db, tenantSlug);
    const current = await this.repository.listModules(db, tenant.id);
    const modules = applyModuleChange(current, {
      enable: parseModuleKeys(change.enable ?? []),
      disable: parseModuleKeys(change.disable ?? []),
    });
    await this.repository.replaceModules(db, tenant.id, modules);
    return modules;
  }

  enabledModules(db: DbClient, tenantId: string): Promise<ModuleKey[]> {
    return this.repository.listModules(db, tenantId);
  }

  async requireTenant(db: DbClient, slug: string) {
    const tenant = await this.repository.findTenantBySlug(db, normalizeSlug(slug));
    if (!tenant)
      throw new DomainException('TENANT_NOT_FOUND', HttpStatus.NOT_FOUND, { detail: slug });
    return tenant;
  }

  /** Fails unless every id is a company of the tenant: never link across tenants. */
  async assertCompaniesInTenant(db: DbClient, tenantId: string, ids: readonly string[]) {
    const unique = [...new Set(ids)];
    if ((await this.repository.countCompanies(db, tenantId, unique)) !== unique.length) {
      throw new DomainException('COMPANY_NOT_IN_TENANT', HttpStatus.BAD_REQUEST);
    }
  }

  listTenants(db: DbClient) {
    return this.repository.listTenants(db);
  }

  private normalizeCompany(input: CompanyInput) {
    const country = normalizeCountry(input.country);
    return {
      legalName: normalizeName(input.legalName, 'INVALID_COMPANY_NAME'),
      vatNumber: normalizeVatNumber(country, input.vatNumber),
      taxCode: normalizeTaxCode(input.taxCode),
      country,
    };
  }
}
