import { Module } from '@nestjs/common';
import { EventsModule } from '../../shared/events/index.js';
import { AuditModule } from '../audit/index.js';
import { IdentityModule } from '../identity/index.js';
import { RegistryModule } from '../registry/index.js';
import { TenancyModule } from '../tenancy/index.js';
import { FulfilmentListener } from './fulfilment-listener.js';
import { InvoiceContentChecker } from './invoice-content.js';
import { InvoiceDraftsService } from './invoice-drafts.service.js';
import { InvoiceIssueService } from './invoice-issue.service.js';
import { InvoiceQueriesService } from './invoice-queries.service.js';
import {
  InvoiceDraftsController,
  InvoicesController,
  InvoicingController,
  PaymentsController,
} from './invoicing.controller.js';
import { InvoicingEvents } from './invoicing-events.js';
import { InvoicingRepository } from './invoicing.repository.js';
import { InvoicingService } from './invoicing.service.js';
import { PaymentsRepository } from './payments.repository.js';
import { PaymentsService } from './payments.service.js';

/**
 * Invoicing ("fatturazione"): invoices and credit notes, issued once and never changed, with
 * their due dates and payments (docs/adr/0027-0030). Depends on the registry for parties and items
 * and on tenancy for the company's data; it does not need orders, and hears their shipments as
 * events when the tenant has both (S7, B4).
 */
@Module({
  imports: [AuditModule, EventsModule, IdentityModule, RegistryModule, TenancyModule],
  controllers: [
    InvoicesController,
    InvoiceDraftsController,
    InvoicingController,
    PaymentsController,
  ],
  providers: [
    InvoicingRepository,
    InvoicingEvents,
    InvoiceContentChecker,
    InvoiceQueriesService,
    InvoiceDraftsService,
    InvoiceIssueService,
    FulfilmentListener,
    PaymentsRepository,
    PaymentsService,
    InvoicingService,
  ],
  exports: [InvoicingService],
})
export class InvoicingModule {}
