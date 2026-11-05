import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { toDbDate } from '../../shared/dates.js';
import { DomainException } from '../../shared/errors/index.js';
import { EventBus, type EventContext } from '../../shared/events/index.js';
import { OrderFulfilledEvent, OrderFulfilmentReversedEvent } from '../orders/events.js';
import { TenancyService } from '../tenancy/index.js';
import { InvoicingRepository } from './invoicing.repository.js';

/**
 * What invoicing hears from orders (docs/adr/0027): a shipment of a sales order becomes a row
 * "to invoice", with what the order agreed; undoing one removes it, or is refused when a draft
 * or an invoice has it. It runs in the transaction of the shipment and does as little as
 * possible there: an insert that adds nothing when the shipment is already known.
 */
@Injectable()
export class FulfilmentListener implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly repository: InvoicingRepository,
    private readonly tenancy: TenancyService,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe(OrderFulfilledEvent, (event, context) => this.fulfilled(event, context));
    this.bus.subscribe(OrderFulfilmentReversedEvent, (event, context) =>
      this.reversed(event, context),
    );
  }

  /** A tenant that does not invoice with Mercurio hears nothing. */
  private async invoices({ tx, company }: EventContext): Promise<boolean> {
    return (await this.tenancy.enabledModules(tx, company.tenantId)).includes('invoicing');
  }

  async fulfilled(event: OrderFulfilledEvent, context: EventContext): Promise<void> {
    if (!(await this.invoices(context))) return;
    const { tx, company } = context;
    await this.repository.createInvoiceable(
      tx,
      {
        fulfilmentId: event.fulfilmentId,
        tenantId: company.tenantId,
        companyId: company.companyId,
        partyId: event.partyId,
        orderId: event.order.id,
        orderReference: event.order.reference,
        partyReference: event.order.partyReference,
        partyReferenceDate: event.order.partyReferenceDate
          ? toDbDate(event.order.partyReferenceDate)
          : null,
        documentId: event.document.id,
        documentReference: event.document.reference,
        documentDate: toDbDate(event.document.date),
      },
      event.lines.map((line) => ({
        orderLineId: line.orderLineId,
        lineNo: line.lineNo,
        itemId: line.itemId,
        description: line.description,
        unit: line.unit,
        quantity: new Prisma.Decimal(line.quantity),
        unitPrice: new Prisma.Decimal(line.unitPrice),
        discountPercent: new Prisma.Decimal(line.discountPercent),
        vatCode: line.vatCode,
        vatRate: new Prisma.Decimal(line.vatRate),
        vatNature: line.vatNature,
      })),
    );
  }

  async reversed(event: OrderFulfilmentReversedEvent, { tx }: EventContext): Promise<void> {
    // Locked (B34: after the order, before the warehouse): a draft taking it waits, or is waited.
    const [row] = await tx.$queryRaw<{ draftId: string | null; invoiceId: string | null }[]>`
      SELECT draft_id AS "draftId", invoice_id AS "invoiceId" FROM invoiceable_fulfilments
      WHERE fulfilment_id = ${event.fulfilmentId}::uuid
      FOR UPDATE`;
    if (!row) return;
    if (row.draftId || row.invoiceId) {
      throw new DomainException('FULFILMENT_INVOICED', HttpStatus.CONFLICT, {
        detail: row.invoiceId ? 'invoiced' : 'in a draft invoice',
      });
    }
    await this.repository.deleteInvoiceable(tx, event.fulfilmentId);
  }
}
