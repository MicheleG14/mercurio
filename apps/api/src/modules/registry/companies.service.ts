import { Injectable } from '@nestjs/common';
import type { Company } from '../../generated/prisma/client.js';
import { companyOf, TenantContextService, TenantDatabase } from '../../prisma/index.js';
import { AuditService } from '../audit/index.js';
import { missingForInvoices, TenancyService } from '../tenancy/index.js';
import type { CompanyDto, UpdateCompanyDto } from './companies.dto.js';

/**
 * The header data of the current company, through the public service of tenancy, which owns the
 * table (B3). Here because it needs the guards of a request, which tenancy cannot import.
 */
@Injectable()
export class CompaniesService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
  ) {}

  async current(): Promise<CompanyDto> {
    const { companyId } = companyOf(this.contexts.require());
    return toDto(await this.db.run((tx) => this.tenancy.getCompany(tx, companyId)));
  }

  async update(dto: UpdateCompanyDto): Promise<CompanyDto> {
    const company = companyOf(this.contexts.require());
    const { version, ...changes } = dto;
    return toDto(
      await this.db.run(async (tx) => {
        const result = await this.tenancy.updateCompanyProfile(
          tx,
          company.companyId,
          version,
          changes,
        );
        if (result.fields.length > 0) {
          await this.audit.recordTenantEvent(tx, {
            tenantId: company.tenantId,
            actorUserId: company.userId,
            source: 'API',
            type: 'COMPANY_UPDATED',
            subject: { type: 'company', id: company.companyId },
            details: { fields: result.fields },
          });
        }
        return result.company;
      }),
    );
  }
}

function toDto(company: Company): CompanyDto {
  return {
    id: company.id,
    legalName: company.legalName,
    vatNumber: company.vatNumber,
    taxCode: company.taxCode,
    country: company.country,
    address: company.address,
    postalCode: company.postalCode,
    city: company.city,
    province: company.province,
    reaOffice: company.reaOffice,
    reaNumber: company.reaNumber,
    shareCapital: company.shareCapital?.toFixed(2) ?? null,
    soleShareholder: company.soleShareholder,
    inLiquidation: company.inLiquidation,
    taxRegime: company.taxRegime,
    iban: company.iban,
    email: company.email,
    pecEmail: company.pecEmail,
    phone: company.phone,
    chargeStampDuty: company.chargeStampDuty,
    missingForInvoices: missingForInvoices(company),
    version: company.version,
  };
}
