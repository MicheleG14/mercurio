import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { ItemsController } from './items.controller.js';
import { ItemsRepository } from './items.repository.js';
import { ItemsService } from './items.service.js';
import { PartiesController } from './parties.controller.js';
import { PartiesRepository } from './parties.repository.js';
import { PartiesService } from './parties.service.js';
import { ReferenceDataController } from './reference-data.controller.js';

/** Registry ("anagrafiche"): customers, suppliers and items, shared by a tenant's companies. */
@Module({
  imports: [AuditModule],
  controllers: [PartiesController, ItemsController, ReferenceDataController],
  providers: [PartiesRepository, PartiesService, ItemsRepository, ItemsService],
})
export class RegistryModule {}
