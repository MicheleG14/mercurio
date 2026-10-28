import { Injectable } from '@nestjs/common';
import type { CompanyContext, TenantTransaction } from '../../prisma/index.js';
import { FulfilmentsService } from './fulfilments.service.js';
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
}
