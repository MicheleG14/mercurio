import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import {
  type CompanyContext,
  companyOf,
  isUniqueViolation,
  TenantContextService,
  TenantDatabase,
  type TenantTransaction,
} from '../../prisma/index.js';
import { businessToday, toDbDate } from '../../shared/dates.js';
import { quantityError } from '../../shared/decimal.js';
import { DomainException, type FieldError, FieldErrors } from '../../shared/errors/index.js';
import { unitDecimals } from '../registry/index.js';
import { WarehouseService } from '../warehouse/index.js';
import { originOf } from './order-actions.service.js';
import { OrderEvents } from './order-events.js';
import { ORDER_KINDS } from './order-kinds.js';
import { OrderQueriesService } from './order-queries.service.js';
import { isOpen, remainingOf, statusFromLines } from './order-rules.js';
import type { CreateFulfilmentDto, OrderDto } from './orders.dto.js';
import { type OrderRow, OrdersRepository } from './orders.repository.js';

/**
 * Receiving a purchase order and shipping a sales order, in part or in full, and undoing one of
 * those (docs/adr/0024). One transaction: lock the order, check the quantities against what is
 * left, let the warehouse record its document (which locks warehouses, balances, reservations
 * and its counter, B34), then record the fulfilment and the lines' progress. If the warehouse
 * refuses, nothing is left behind, and its errors come back on the lines of this request.
 */
@Injectable()
export class FulfilmentsService {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly warehouse: WarehouseService,
    private readonly queries: OrderQueriesService,
    private readonly events: OrderEvents,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
  ) {}

  /** `created` is false when this fulfilment was already recorded with this id (B33). */
  async fulfil(
    orderId: string,
    dto: CreateFulfilmentDto,
  ): Promise<{ order: OrderDto; created: boolean }> {
    const company = companyOf(this.contexts.require());
    try {
      return await this.db.run((tx) => this.fulfilIn(tx, company, orderId, dto));
    } catch (error) {
      // The id was taken by a document that is not this fulfilment.
      if (isUniqueViolation(error)) {
        throw new DomainException('DOCUMENT_ID_REUSED', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async fulfilIn(
    tx: TenantTransaction,
    company: CompanyContext,
    orderId: string,
    dto: CreateFulfilmentDto,
    today = businessToday(),
  ): Promise<{ order: OrderDto; created: boolean }> {
    const order = await this.repository.lock(tx, company.companyId, orderId);
    if (!order) throw new DomainException('ORDER_NOT_FOUND', HttpStatus.NOT_FOUND);
    // After the lock: a request with the same id that was waiting finds the first one done.
    if (await this.alreadyRecorded(tx, order, dto)) {
      return { order: await this.queries.detail(tx, company.companyId, orderId), created: false };
    }
    if (!isOpen(order.status)) throw new DomainException('ORDER_NOT_OPEN', HttpStatus.CONFLICT);

    const moving = this.checkLines(order, dto);
    const rule = ORDER_KINDS[order.kind];
    const origin = originOf(order);
    const linesById = new Map(order.lines.map((line) => [line.id, line]));
    let posted;
    try {
      posted = await this.warehouse.postDocument(
        tx,
        company,
        {
          id: dto.id,
          reason: rule.stockReason,
          documentDate: dto.documentDate,
          warehouseId: order.warehouseId!,
          partyId: order.partyId,
          partyDocumentRef: dto.partyDocumentRef ?? null,
          partyDocumentDate: dto.partyDocumentDate ?? null,
          notes: dto.notes ?? null,
          lines: moving.map((m) => ({
            itemId: linesById.get(m.orderLineId)!.itemId,
            quantity: m.quantity.toString(),
          })),
        },
        {
          today,
          origin,
          reservations: rule.reserves ? moving.map((m) => m.orderLineId) : undefined,
        },
      );
    } catch (error) {
      throw onRequestLines(
        error,
        moving.map((m) => m.index),
      );
    }

    await this.repository.createFulfilment(
      tx,
      {
        id: dto.id,
        tenantId: company.tenantId,
        companyId: company.companyId,
        orderId,
        stockDocumentId: posted.id,
        fulfilmentDate: toDbDate(posted.documentDate),
        createdById: company.userId,
      },
      moving.map((m) => ({ orderLineId: m.orderLineId, quantity: m.quantity })),
    );
    for (const m of moving) {
      const line = linesById.get(m.orderLineId)!;
      line.doneQuantity = line.doneQuantity.plus(m.quantity);
      await this.repository.setLineProgress(tx, line.id, { doneQuantity: line.doneQuantity });
    }
    await this.repository.updateAtVersion(tx, orderId, order.version, {
      status: statusFromLines(order.lines),
    });
    await this.events.record(tx, company, 'ORDER_FULFILLED', orderId, {
      reference: origin.reference,
      document: posted.reference,
    });
    return { order: await this.queries.detail(tx, company.companyId, orderId), created: true };
  }

  reverse(orderId: string, fulfilmentId: string): Promise<OrderDto> {
    const company = companyOf(this.contexts.require());
    return this.db.run((tx) => this.reverseIn(tx, company, orderId, fulfilmentId));
  }

  /**
   * Undoes a fulfilment: the warehouse reverses its document (only this order may), the lines
   * get back what it moved, and the goods of a sales order that come back are reserved again for
   * it, since they are still promised to that customer.
   */
  async reverseIn(
    tx: TenantTransaction,
    company: CompanyContext,
    orderId: string,
    fulfilmentId: string,
    today = businessToday(),
  ): Promise<OrderDto> {
    const order = await this.repository.lock(tx, company.companyId, orderId);
    if (!order) throw new DomainException('ORDER_NOT_FOUND', HttpStatus.NOT_FOUND);
    const fulfilment = order.fulfilments.find((f) => f.id === fulfilmentId);
    if (!fulfilment) throw new DomainException('FULFILMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (fulfilment.reversalDocumentId) {
      throw new DomainException('FULFILMENT_ALREADY_REVERSED', HttpStatus.CONFLICT);
    }

    const origin = originOf(order);
    const reversal = await this.warehouse.reverseDocument(tx, company, fulfilment.stockDocumentId, {
      today,
      origin,
    });
    await this.repository.markFulfilmentReversed(tx, fulfilment.id, reversal.id);
    const touched = new Set<string>();
    for (const moved of fulfilment.lines) {
      const line = order.lines.find((l) => l.id === moved.orderLineId)!;
      line.doneQuantity = line.doneQuantity.minus(moved.quantity);
      touched.add(line.id);
      await this.repository.setLineProgress(tx, line.id, { doneQuantity: line.doneQuantity });
    }
    if (ORDER_KINDS[order.kind].reserves) {
      await this.warehouse.reserve(
        tx,
        company,
        origin,
        order.lines
          .filter((line) => touched.has(line.id))
          .map((line) => ({
            originLineId: line.id,
            warehouseId: order.warehouseId!,
            itemId: line.itemId,
            wanted: remainingOf(line),
          })),
      );
    }
    await this.repository.updateAtVersion(tx, orderId, order.version, {
      status: statusFromLines(order.lines),
    });
    await this.events.record(tx, company, 'ORDER_FULFILMENT_REVERSED', orderId, {
      reference: origin.reference,
      document: reversal.reference,
    });
    return this.queries.detail(tx, company.companyId, orderId);
  }

  /** True when this fulfilment is already recorded as asked (B33); 409 when the id is reused. */
  private async alreadyRecorded(
    tx: TenantTransaction,
    order: OrderRow,
    dto: CreateFulfilmentDto,
  ): Promise<boolean> {
    const existing = await this.repository.findFulfilment(tx, dto.id);
    if (!existing) return false;
    const recorded = order.fulfilments.find((f) => f.id === dto.id);
    const asked = dto.lines.filter((line) => !new Prisma.Decimal(safe(line.quantity)).isZero());
    const same =
      recorded !== undefined &&
      recorded.lines.length === asked.length &&
      asked.every((line) =>
        recorded.lines.some(
          (r) => r.orderLineId === line.orderLineId && r.quantity.equals(safe(line.quantity)),
        ),
      );
    if (!same) throw new DomainException('DOCUMENT_ID_REUSED', HttpStatus.CONFLICT);
    return true;
  }

  /**
   * The lines that move, in request order: each a line of this order once, a quantity with the
   * unit's decimals, never more than what is left. Lines at zero stay out of the document.
   */
  private checkLines(order: OrderRow, dto: CreateFulfilmentDto) {
    const errors = new FieldErrors();
    const seen = new Set<string>();
    const moving: { index: number; orderLineId: string; quantity: Prisma.Decimal }[] = [];
    dto.lines.forEach((input, index) => {
      const at = (field: string) => `lines[${index}].${field}`;
      const line = order.lines.find((l) => l.id === input.orderLineId);
      if (!line) {
        errors.add(at('orderLineId'), 'ORDER_LINE_NOT_FOUND');
        return;
      }
      if (seen.has(line.id)) errors.add(at('orderLineId'), 'DUPLICATE_LINE');
      seen.add(line.id);
      const problem = quantityError(input.quantity, unitDecimals(line.unit), true);
      if (problem) {
        errors.add(at('quantity'), problem);
        return;
      }
      const quantity = new Prisma.Decimal(input.quantity);
      if (quantity.greaterThan(remainingOf(line))) {
        errors.add(at('quantity'), 'QUANTITY_OVER_REMAINING');
      } else if (!quantity.isZero()) {
        moving.push({ index, orderLineId: line.id, quantity });
      }
    });
    errors.throwIfAny();
    if (moving.length === 0) {
      throw new DomainException('NOTHING_TO_FULFIL', HttpStatus.CONFLICT);
    }
    return moving;
  }
}

/** A quantity as sent, for comparing: text that is not a number compares as zero. */
function safe(value: string): string {
  try {
    return new Prisma.Decimal(value).toString();
  } catch {
    return '0';
  }
}

/**
 * The warehouse's errors on the lines of its document ("lines[1].quantity") moved to the lines
 * of this request: lines at zero are not in the document, so the indexes differ.
 */
function onRequestLines(error: unknown, requestIndexes: number[]): unknown {
  if (!(error instanceof DomainException) || !error.errors) return error;
  const errors: FieldError[] = error.errors.map((fieldError) => {
    const match = /^lines\[(\d+)\]\.(.+)$/.exec(fieldError.field);
    if (!match) return fieldError;
    const index = requestIndexes[Number(match[1])];
    const field = match[2] === 'itemId' ? 'orderLineId' : match[2];
    return { ...fieldError, field: `lines[${index}].${field}` };
  });
  return new DomainException(error.code, error.status, { detail: error.detail, errors });
}
