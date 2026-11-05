import { Injectable } from '@nestjs/common';
import type { CompanyContext, TenantTransaction } from '../../prisma/index.js';
import { fromDbDate } from '../../shared/dates.js';
import { EventBus } from '../../shared/events/index.js';
import { WarehouseService } from '../warehouse/index.js';
import { fulfilledEvent, FulfilmentsService } from './fulfilments.service.js';
import { OrdersRepository } from './orders.repository.js';
import { OrderActionsService } from './order-actions.service.js';
import { OrderDraftsService } from './order-drafts.service.js';
import type { CreateFulfilmentDto, CreateOrderDto, OrderDto } from './orders.dto.js';

/**
 * Public service of the orders module (B3) for code outside a request: the demo seed. Every
 * action goes through the same use case as the API, so the seed obeys the same rules, locks and
 * numbering. `today` lets a seed date what it records.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly drafts: OrderDraftsService,
    private readonly actions: OrderActionsService,
    private readonly fulfilments: FulfilmentsService,
    private readonly repository: OrdersRepository,
    private readonly warehouse: WarehouseService,
    private readonly bus: EventBus,
  ) {}

  createDraft(
    tx: TenantTransaction,
    company: CompanyContext,
    dto: CreateOrderDto,
    today?: string,
  ): Promise<OrderDto> {
    return this.drafts.createIn(tx, company, dto, today);
  }

  confirm(
    tx: TenantTransaction,
    company: CompanyContext,
    id: string,
    version: number,
    today?: string,
  ): Promise<OrderDto> {
    return this.actions.confirmIn(tx, company, id, version, today);
  }

  reserve(tx: TenantTransaction, company: CompanyContext, id: string): Promise<OrderDto> {
    return this.actions.reserveIn(tx, company, id);
  }

  close(
    tx: TenantTransaction,
    company: CompanyContext,
    id: string,
    version: number,
    lineIds?: string[],
  ): Promise<OrderDto> {
    return this.actions.closeIn(tx, company, id, version, lineIds);
  }

  cancel(
    tx: TenantTransaction,
    company: CompanyContext,
    id: string,
    version: number,
  ): Promise<OrderDto> {
    return this.actions.cancelIn(tx, company, id, version);
  }

  async fulfil(
    tx: TenantTransaction,
    company: CompanyContext,
    orderId: string,
    dto: CreateFulfilmentDto,
    today?: string,
  ): Promise<OrderDto> {
    return (await this.fulfilments.fulfilIn(tx, company, orderId, dto, today)).order;
  }

  reverseFulfilment(
    tx: TenantTransaction,
    company: CompanyContext,
    orderId: string,
    fulfilmentId: string,
    today?: string,
  ): Promise<OrderDto> {
    return this.fulfilments.reverseIn(tx, company, orderId, fulfilmentId, today);
  }

  /** Whether the company has any order: the seed adds orders only to a company without. */
  async hasOrders(tx: TenantTransaction, companyId: string): Promise<boolean> {
    return (await tx.order.count({ where: { companyId } })) > 0;
  }

  /**
   * Publishes again an `OrderFulfilledEvent` for every shipment of a sales order of the tenant
   * that is not undone, oldest first (docs/adr/0027): for shipments recorded before a module
   * listened, or while it was off. Listeners are idempotent, so running it twice adds nothing.
   * Returns how many events were published.
   */
  async republishFulfilments(tx: TenantTransaction, tenantId: string): Promise<number> {
    const shipments = await this.repository.liveSalesFulfilments(tx, tenantId);
    const documents = await this.warehouse.documentReferences(
      tx,
      shipments.map((s) => s.fulfilment.stockDocumentId),
    );
    for (const { order, fulfilment } of shipments) {
      const company = { tenantId, companyId: order.companyId, userId: null };
      await this.bus.publish(
        fulfilledEvent(order, fulfilment, {
          id: fulfilment.stockDocumentId,
          reference: documents.get(fulfilment.stockDocumentId)!,
          date: fromDbDate(fulfilment.fulfilmentDate),
        }),
        { tx, company },
      );
    }
    return shipments.length;
  }
}
