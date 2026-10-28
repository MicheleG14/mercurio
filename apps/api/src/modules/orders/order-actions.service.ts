import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import {
  type CompanyContext,
  companyOf,
  TenantContextService,
  TenantDatabase,
  type TenantTransaction,
} from '../../prisma/index.js';
import { businessToday, fromDbDate } from '../../shared/dates.js';
import { DomainException, FieldErrors } from '../../shared/errors/index.js';
import { assertVersion } from '../../shared/versioning.js';
import { type Origin, WarehouseService } from '../warehouse/index.js';
import { OrderContentChecker } from './order-content.js';
import { contentOf } from './order-drafts.service.js';
import { OrderEvents } from './order-events.js';
import { ORDER_KINDS, orderReference, ORIGIN_TYPE } from './order-kinds.js';
import { OrderQueriesService } from './order-queries.service.js';
import { isOpen, remainingOf, statusFromLines } from './order-rules.js';
import type { OrderDto } from './orders.dto.js';
import { type OrderRow, OrdersRepository } from './orders.repository.js';

/** How the warehouse knows this order: its documents and reservations carry it (B35). */
export function originOf(order: {
  id: string;
  series: string | null;
  year: number | null;
  number: number | null;
}): Origin {
  return {
    type: ORIGIN_TYPE,
    id: order.id,
    reference: orderReference({ series: order.series!, year: order.year!, number: order.number! }),
  };
}

/**
 * What happens to an order once it leaves the draft: confirmed (numbered, its goods reserved),
 * reserved again when stock arrives, its rest closed, or cancelled. Every action locks the order
 * first, then lets the warehouse lock what it needs (B34), all in one transaction (B12, B35).
 */
@Injectable()
export class OrderActionsService {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly checker: OrderContentChecker,
    private readonly warehouse: WarehouseService,
    private readonly queries: OrderQueriesService,
    private readonly events: OrderEvents,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
  ) {}

  private run<T>(work: (tx: TenantTransaction, company: CompanyContext) => Promise<T>) {
    const company = companyOf(this.contexts.require());
    return this.db.run((tx) => work(tx, company));
  }

  confirm(id: string, version: number): Promise<OrderDto> {
    return this.run((tx, company) => this.confirmIn(tx, company, id, version));
  }

  /**
   * Numbers the order in its series and year, and for a sales order reserves what is available
   * of each line; the rest stays uncovered and the order is confirmed all the same. The number is
   * taken before the reservations, which carry it: no other use case takes an order number, so
   * the order of locks stays fixed (B34).
   */
  async confirmIn(
    tx: TenantTransaction,
    company: CompanyContext,
    id: string,
    version: number,
    today = businessToday(),
  ): Promise<OrderDto> {
    const order = await this.lock(tx, company, id);
    if (order.status !== 'DRAFT') throw new DomainException('ORDER_NOT_DRAFT', HttpStatus.CONFLICT);
    assertVersion(order, version);
    // The same rules as the draft, now complete: the party or an item may be archived since.
    await this.checker.check(tx, company, order.kind, contentOf(order), today, true);

    const rule = ORDER_KINDS[order.kind];
    const year = Number(fromDbDate(order.orderDate).slice(0, 4));
    const number = await this.repository.nextNumber(tx, company, rule.series, year);
    const numbered = { ...order, series: rule.series, year, number };
    if (rule.reserves) {
      await this.warehouse.reserve(tx, company, originOf(numbered), this.wishes(numbered));
    }
    await this.repository.updateAtVersion(tx, id, version, {
      status: 'CONFIRMED',
      series: rule.series,
      year,
      number,
      confirmedAt: new Date(),
    });
    await this.events.record(tx, company, 'ORDER_CONFIRMED', id, {
      reference: originOf(numbered).reference,
    });
    return this.queries.detail(tx, company.companyId, id);
  }

  reserve(id: string): Promise<OrderDto> {
    return this.run((tx, company) => this.reserveIn(tx, company, id));
  }

  /** Reserves what is now available for the lines still uncovered ("Prenota disponibile"). */
  async reserveIn(tx: TenantTransaction, company: CompanyContext, id: string): Promise<OrderDto> {
    const order = await this.lock(tx, company, id);
    this.assertOpen(order);
    if (!ORDER_KINDS[order.kind].reserves) {
      throw new DomainException('ORDER_DOES_NOT_RESERVE', HttpStatus.CONFLICT);
    }
    const before = await this.repository.reservedByLine(tx, order.id);
    const held = await this.warehouse.reserve(tx, company, originOf(order), this.wishes(order));
    const grown = held.filter((h) => h.reserved.greaterThan(before.get(h.originLineId) ?? 0));
    if (grown.length > 0) {
      await this.events.record(tx, company, 'ORDER_RESERVED', id, {
        reference: originOf(order).reference,
        lines: grown.length,
      });
    }
    return this.queries.detail(tx, company.companyId, id);
  }

  close(id: string, version: number, lineIds?: string[]): Promise<OrderDto> {
    return this.run((tx, company) => this.closeIn(tx, company, id, version, lineIds));
  }

  /**
   * Closes what is left of some lines (all when none are named): it will not come or go any more.
   * Their reservations are released. An order with nothing left becomes completed.
   */
  async closeIn(
    tx: TenantTransaction,
    company: CompanyContext,
    id: string,
    version: number,
    lineIds?: string[],
  ): Promise<OrderDto> {
    const order = await this.lock(tx, company, id);
    this.assertOpen(order);
    assertVersion(order, version);
    const errors = new FieldErrors();
    for (const [index, lineId] of (lineIds ?? []).entries()) {
      if (!order.lines.some((line) => line.id === lineId)) {
        errors.add(`lineIds[${index}]`, 'ORDER_LINE_NOT_FOUND');
      }
    }
    errors.throwIfAny();

    const chosen = order.lines.filter(
      (line) => (!lineIds || lineIds.includes(line.id)) && !remainingOf(line).isZero(),
    );
    if (chosen.length === 0) throw new DomainException('NOTHING_TO_CLOSE', HttpStatus.CONFLICT);
    for (const line of chosen) {
      line.closedQuantity = line.closedQuantity.plus(remainingOf(line));
      await this.repository.setLineProgress(tx, line.id, { closedQuantity: line.closedQuantity });
    }
    if (ORDER_KINDS[order.kind].reserves) {
      await this.warehouse.release(
        tx,
        company,
        originOf(order),
        chosen.map((line) => line.id),
      );
    }
    await this.repository.updateAtVersion(tx, id, version, {
      status: statusFromLines(order.lines),
    });
    await this.events.record(tx, company, 'ORDER_CLOSED', id, {
      reference: originOf(order).reference,
      lines: chosen.length,
    });
    return this.queries.detail(tx, company.companyId, id);
  }

  cancel(id: string, version: number): Promise<OrderDto> {
    return this.run((tx, company) => this.cancelIn(tx, company, id, version));
  }

  /** Cancels a confirmed order nothing has moved for; its number stays used, its goods released. */
  async cancelIn(
    tx: TenantTransaction,
    company: CompanyContext,
    id: string,
    version: number,
  ): Promise<OrderDto> {
    const order = await this.lock(tx, company, id);
    this.assertOpen(order);
    assertVersion(order, version);
    if (order.fulfilments.some((f) => f.reversalDocumentId === null)) {
      throw new DomainException('ORDER_HAS_FULFILMENTS', HttpStatus.CONFLICT);
    }
    if (ORDER_KINDS[order.kind].reserves) {
      await this.warehouse.release(
        tx,
        company,
        originOf(order),
        order.lines.map((line) => line.id),
      );
    }
    await this.repository.updateAtVersion(tx, id, version, {
      status: 'CANCELLED',
      cancelledAt: new Date(),
    });
    await this.events.record(tx, company, 'ORDER_CANCELLED', id, {
      reference: originOf(order).reference,
    });
    return this.queries.detail(tx, company.companyId, id);
  }

  private async lock(
    tx: TenantTransaction,
    company: CompanyContext,
    id: string,
  ): Promise<OrderRow> {
    const order = await this.repository.lock(tx, company.companyId, id);
    if (!order) throw new DomainException('ORDER_NOT_FOUND', HttpStatus.NOT_FOUND);
    return order;
  }

  private assertOpen(order: OrderRow) {
    if (!isOpen(order.status)) throw new DomainException('ORDER_NOT_OPEN', HttpStatus.CONFLICT);
  }

  /** Each line wants what it still has to ship. */
  private wishes(order: OrderRow) {
    return order.lines.map((line) => ({
      originLineId: line.id,
      warehouseId: order.warehouseId!,
      itemId: line.itemId,
      wanted: Prisma.Decimal.max(remainingOf(line), 0),
    }));
  }
}
