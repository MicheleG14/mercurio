import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { IdentityModule } from '../identity/index.js';
import { TenancyModule } from '../tenancy/index.js';
import { CompaniesController, CompanyListController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { ItemsController } from './items.controller.js';
import { ItemsRepository } from './items.repository.js';
import { ItemsService } from './items.service.js';
import { PartiesController } from './parties.controller.js';
import { PartiesRepository } from './parties.repository.js';
import { PartiesService } from './parties.service.js';
import { ReferenceDataController } from './reference-data.controller.js';
import { RegistryService } from './registry.service.js';

/**
 * Registry ("anagrafiche"): customers, suppliers and items, shared by a tenant's companies, and
 * the invoice header data of each company (kept by tenancy, served here).
 */
@Module({
  imports: [AuditModule, IdentityModule, TenancyModule],
  controllers: [
    PartiesController,
    ItemsController,
    ReferenceDataController,
    CompanyListController,
    CompaniesController,
  ],
  providers: [
    PartiesRepository,
    PartiesService,
    ItemsRepository,
    ItemsService,
    RegistryService,
    CompaniesService,
  ],
  exports: [RegistryService],
})
export class RegistryModule {}
