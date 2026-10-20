import { HttpStatus, Injectable } from '@nestjs/common';
import { type DbClient, isUniqueViolation } from '../../prisma/index.js';
import { DomainException } from '../../shared/errors/index.js';
import { MODULE_KEYS, type ModuleKey } from './module-catalog.js';

export interface NewCompany {
  tenantId: string;
  legalName: string;
  vatNumber: string;
  taxCode?: string;
  country: string;
}

/**
 * The only code that touches the tenancy tables (B2, B3). Every query filters by tenant
 * explicitly: terminal commands run as the owner role, which Row-Level Security does not
 * restrict, so the filter is the first line of defence and the policies the second.
 */
@Injectable()
export class TenancyRepository {
  findTenantBySlug(db: DbClient, slug: string) {
    return db.tenant.findUnique({ where: { slug } });
  }

  async createTenant(db: DbClient, data: { name: string; slug: string }) {
    try {
      return await db.tenant.create({ data });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainException('TENANT_SLUG_TAKEN', HttpStatus.CONFLICT, { detail: data.slug });
      }
      throw error;
    }
  }

  async createCompany(db: DbClient, data: NewCompany) {
    try {
      return await db.company.create({ data });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainException('COMPANY_VAT_TAKEN', HttpStatus.CONFLICT, {
          detail: data.vatNumber,
        });
      }
      throw error;
    }
  }

  findTenantById(db: DbClient, id: string) {
    return db.tenant.findUnique({ where: { id } });
  }

  findTenantsByIds(db: DbClient, ids: readonly string[]) {
    return db.tenant.findMany({ where: { id: { in: [...ids] } }, orderBy: { name: 'asc' } });
  }

  listCompanies(db: DbClient, tenantId: string) {
    return db.company.findMany({ where: { tenantId }, orderBy: { legalName: 'asc' } });
  }

  findCompaniesByVat(db: DbClient, tenantId: string, vatNumbers: readonly string[]) {
    return db.company.findMany({ where: { tenantId, vatNumber: { in: [...vatNumbers] } } });
  }

  countCompanies(db: DbClient, tenantId: string, ids: readonly string[]) {
    return db.company.count({ where: { tenantId, id: { in: [...ids] } } });
  }

  async listModules(db: DbClient, tenantId: string): Promise<ModuleKey[]> {
    const rows = await db.tenantModule.findMany({
      where: { tenantId },
      select: { moduleKey: true },
    });
    // In catalog order. Keys are written only through the catalog; an unknown one is ignored.
    const enabled = new Set(rows.map((row) => row.moduleKey));
    return MODULE_KEYS.filter((key) => enabled.has(key));
  }

  async replaceModules(db: DbClient, tenantId: string, keys: readonly ModuleKey[]) {
    await db.tenantModule.deleteMany({ where: { tenantId, moduleKey: { notIn: [...keys] } } });
    await db.tenantModule.createMany({
      data: keys.map((moduleKey) => ({ tenantId, moduleKey })),
      skipDuplicates: true,
    });
  }

  listTenants(db: DbClient) {
    return db.tenant.findMany({
      orderBy: { slug: 'asc' },
      include: {
        companies: { orderBy: { legalName: 'asc' } },
        modules: { orderBy: { moduleKey: 'asc' } },
      },
    });
  }
}
