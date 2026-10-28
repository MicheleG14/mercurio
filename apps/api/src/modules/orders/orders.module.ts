import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { IdentityModule } from '../identity/index.js';
import { RegistryModule } from '../registry/index.js';
import { WarehouseModule } from '../warehouse/index.js';
import { FulfilmentsService } from './fulfilments.service.js';
import { OrderActionsService } from './order-actions.service.js';
import { OrderContentChecker } from './order-content.js';
import { OrderDraftsService } from './order-drafts.service.js';
import { OrderEvents } from './order-events.js';
import { OrderQueriesService } from './order-queries.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

/**
 * Orders ("ordini"): purchase orders received into a warehouse and sales orders shipped from one,
 * with reservations, partial fulfilment and prices (docs/adr/0024). Depends on the registry for
 * items and parties and on the warehouse for goods, through their public services and views; the
 * warehouse knows nothing of orders (B35).
 */
@Module({
  imports: [AuditModule, IdentityModule, RegistryModule, WarehouseModule],
  controllers: [OrdersController],
  providers: [
    OrdersRepository,
    OrderEvents,
    OrderContentChecker,
    OrderQueriesService,
    OrderDraftsService,
    OrderActionsService,
    FulfilmentsService,
    OrdersService,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
