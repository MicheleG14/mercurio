import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { IdentityModule } from '../identity/index.js';
import { RegistryModule } from '../registry/index.js';
import { TenancyModule } from '../tenancy/index.js';
import { DeliveryNoteService } from './delivery-note.js';
import { StockDocumentsController } from './stock-documents.controller.js';
import { StockDocumentsRepository } from './stock-documents.repository.js';
import { ReservationsService } from './reservations.service.js';
import { StockDocumentsService } from './stock-documents.service.js';
import { StockController } from './stock.controller.js';
import { StockRepository } from './stock.repository.js';
import { StockService } from './stock.service.js';
import { WarehouseService } from './warehouse.service.js';
import { WarehousesController } from './warehouses.controller.js';
import { WarehousesRepository } from './warehouses.repository.js';
import { WarehousesService } from './warehouses.service.js';

/**
 * Warehouse ("magazzino"): warehouses per company, stock documents and their movements, stock
 * computed from the movements and reorder levels (docs/adr/0021). Depends on the registry for
 * items and parties, through its public service and views.
 */
@Module({
  imports: [AuditModule, IdentityModule, RegistryModule, TenancyModule],
  controllers: [WarehousesController, StockController, StockDocumentsController],
  providers: [
    WarehousesRepository,
    WarehousesService,
    StockDocumentsRepository,
    StockDocumentsService,
    StockRepository,
    StockService,
    ReservationsService,
    DeliveryNoteService,
    WarehouseService,
  ],
  exports: [WarehouseService],
})
export class WarehouseModule {}
