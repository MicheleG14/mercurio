import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  type CompanyContext,
  companyOf,
  isUniqueViolation,
  TenantContextService,
  TenantDatabase,
  type TenantTransaction,
} from '../../prisma/index.js';
import { businessToday, fromDbDate, toDbDate } from '../../shared/dates.js';
import { fromDecimal, PRICE, QUANTITY } from '../../shared/decimal.js';
import { DomainException } from '../../shared/errors/index.js';
import { assertVersion, editConflict } from '../../shared/versioning.js';
import { type CheckedContent, OrderContentChecker } from './order-content.js';
import { OrderEvents } from './order-events.js';
import { OrderQueriesService } from './order-queries.service.js';
import type {
  CreateOrderDto,
  DuplicateOrderDto,
  OrderContentDto,
  OrderDto,
  UpdateOrderDto,
} from './orders.dto.js';
import { type OrderRow, OrdersRepository } from './orders.repository.js';

/**
 * Drafts: an order being prepared, without a number, free to change and to delete. Creating one
 * takes an id from the client (B33): the same id with the same content is the same draft.
 */
@Injectable()
export class OrderDraftsService {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly checker: OrderContentChecker,
    private readonly queries: OrderQueriesService,
    private readonly events: OrderEvents,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
  ) {}

  /** `created` tells whether the draft is new, so the API answers 201 or 200. */
  async create(dto: CreateOrderDto): Promise<{ order: OrderDto; created: boolean }> {
    const company = companyOf(this.contexts.require());
    try {
      return await this.db.run(async (tx) => {
        const same = await this.sameDraft(tx, company, dto);
        if (same) return { order: same, created: false };
        return { order: await this.createIn(tx, company, dto), created: true };
      });
    } catch (error) {
      // Two requests with the same id at once: the primary key let one through.
      if (!isUniqueViolation(error)) throw error;
      const same = await this.db.run((tx) => this.sameDraft(tx, company, dto));
      if (same) return { order: same, created: false };
      throw new DomainException('DOCUMENT_ID_REUSED', HttpStatus.CONFLICT);
    }
  }

  async createIn(
    tx: TenantTransaction,
    company: CompanyContext,
    dto: CreateOrderDto,
    today = businessToday(),
  ): Promise<OrderDto> {
    const content = await this.checker.check(tx, company, dto.kind, dto, today);
    await this.repository.create(
      tx,
      {
        id: dto.id,
        tenantId: company.tenantId,
        companyId: company.companyId,
        kind: dto.kind,
        ...headerColumns(content),
        createdById: company.userId,
      },
      lineRows(company, content),
    );
    await this.events.record(tx, company, 'ORDER_CREATED', dto.id, { kind: dto.kind });
    return this.queries.detail(tx, company.companyId, dto.id);
  }

  async update(id: string, dto: UpdateOrderDto): Promise<OrderDto> {
    const company = companyOf(this.contexts.require());
    return this.db.run(async (tx) => {
      const order = await this.requireDraft(tx, company, id, dto.version);
      const content = await this.checker.check(tx, company, order.kind, dto, businessToday());
      await this.repository.replaceLines(tx, id, lineRows(company, content));
      const updated = await this.repository.updateAtVersion(
        tx,
        id,
        dto.version,
        headerColumns(content),
      );
      if (!updated) throw editConflict();
      await this.events.record(tx, company, 'ORDER_UPDATED', id, { lines: content.lines.length });
      return this.queries.detail(tx, company.companyId, id);
    });
  }

  async remove(id: string, version: number): Promise<void> {
    const company = companyOf(this.contexts.require());
    await this.db.run(async (tx) => {
      await this.requireDraft(tx, company, id, version);
      if (!(await this.repository.deleteDraft(tx, id, version))) throw editConflict();
      await this.events.record(tx, company, 'ORDER_DELETED', id, {});
    });
  }

  /**
   * A new draft with the header and lines of an order, at its prices: the way to correct a
   * confirmed order (cancel it, duplicate it, fix the copy). Same id again: the same copy.
   */
  async duplicate(
    sourceId: string,
    dto: DuplicateOrderDto,
  ): Promise<{ order: OrderDto; created: boolean }> {
    const company = companyOf(this.contexts.require());
    return this.db.run(async (tx) => {
      const source = await this.repository.findById(tx, company.companyId, sourceId);
      if (!source) throw new DomainException('ORDER_NOT_FOUND', HttpStatus.NOT_FOUND);
      const existing = await this.repository.findAnyById(tx, dto.id);
      if (existing) {
        if (
          existing.companyId !== company.companyId ||
          existing.status !== 'DRAFT' ||
          existing.kind !== source.kind
        ) {
          throw new DomainException('DOCUMENT_ID_REUSED', HttpStatus.CONFLICT);
        }
        return { order: await this.queries.detail(tx, company.companyId, dto.id), created: false };
      }
      // Dated today, without the old requested date; everything else as in the source.
      const copy: CreateOrderDto = Object.assign(contentOf(source), {
        id: dto.id,
        kind: source.kind,
        orderDate: undefined,
        requestedDate: null,
      });
      const order = await this.createIn(tx, company, copy);
      return { order, created: true };
    });
  }

  private async requireDraft(
    tx: TenantTransaction,
    company: CompanyContext,
    id: string,
    version: number,
  ): Promise<OrderRow> {
    const order = await this.repository.lock(tx, company.companyId, id);
    if (!order) throw new DomainException('ORDER_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (order.status !== 'DRAFT') throw new DomainException('ORDER_NOT_DRAFT', HttpStatus.CONFLICT);
    assertVersion(order, version);
    return order;
  }

  /** The draft recorded with this id when the request is the same; 409 when it is not. */
  private async sameDraft(
    tx: TenantTransaction,
    company: CompanyContext,
    dto: CreateOrderDto,
  ): Promise<OrderDto | null> {
    const existing = await this.repository.findAnyById(tx, dto.id);
    if (!existing) return null;
    const order =
      existing.companyId === company.companyId
        ? await this.repository.findById(tx, company.companyId, dto.id)
        : null;
    if (!order || order.kind !== dto.kind) {
      throw new DomainException('DOCUMENT_ID_REUSED', HttpStatus.CONFLICT);
    }
    const content = await this.checker.check(
      tx,
      company,
      dto.kind,
      dto,
      fromDbDate(order.orderDate),
    );
    if (!sameContent(order, content)) {
      throw new DomainException('DOCUMENT_ID_REUSED', HttpStatus.CONFLICT);
    }
    return this.queries.detail(tx, company.companyId, dto.id);
  }
}

/** The request that would create this order again: for a copy, or to check a draft. */
export function contentOf(order: OrderRow): OrderContentDto {
  return {
    orderDate: fromDbDate(order.orderDate),
    partyId: order.partyId,
    warehouseId: order.warehouseId,
    partyReference: order.partyReference,
    partyReferenceDate: order.partyReferenceDate ? fromDbDate(order.partyReferenceDate) : null,
    requestedDate: order.requestedDate ? fromDbDate(order.requestedDate) : null,
    notes: order.notes,
    lines: order.lines.map((line) => ({
      itemId: line.itemId,
      description: line.description,
      quantity: fromDecimal(line.quantity, QUANTITY),
      unitPrice: fromDecimal(line.unitPrice, PRICE),
      discountPercent: line.discountPercent.toFixed(2),
      vatCode: line.vatCode,
    })),
  };
}

function headerColumns(content: CheckedContent) {
  const { header, totals } = content;
  return {
    orderDate: toDbDate(header.orderDate),
    partyId: header.partyId,
    warehouseId: header.warehouseId,
    partyReference: header.partyReference,
    partyReferenceDate: header.partyReferenceDate ? toDbDate(header.partyReferenceDate) : null,
    requestedDate: header.requestedDate ? toDbDate(header.requestedDate) : null,
    notes: header.notes,
    ...totals,
  };
}

function lineRows(company: CompanyContext, content: CheckedContent) {
  return content.lines.map((line, index) => ({
    tenantId: company.tenantId,
    companyId: company.companyId,
    lineNo: index + 1,
    ...line,
  }));
}

/** Whether a stored draft is what this checked request would store (B33). */
function sameContent(order: OrderRow, content: CheckedContent): boolean {
  const columns = headerColumns(content);
  const sameDate = (a: Date | null, b: Date | null) =>
    (a?.getTime() ?? null) === (b?.getTime() ?? null);
  const sameDecimal = (a: Prisma.Decimal | null, b: Prisma.Decimal | null) =>
    a === null || b === null ? a === b : a.equals(b);
  return (
    sameDate(order.orderDate, columns.orderDate) &&
    order.partyId === columns.partyId &&
    order.warehouseId === columns.warehouseId &&
    order.partyReference === columns.partyReference &&
    sameDate(order.partyReferenceDate, columns.partyReferenceDate) &&
    sameDate(order.requestedDate, columns.requestedDate) &&
    order.notes === columns.notes &&
    order.lines.length === content.lines.length &&
    content.lines.every((line, index) => {
      const stored = order.lines[index]!;
      return (
        stored.itemId === line.itemId &&
        stored.description === line.description &&
        sameDecimal(stored.quantity, line.quantity) &&
        sameDecimal(stored.unitPrice, line.unitPrice) &&
        sameDecimal(stored.discountPercent, line.discountPercent) &&
        stored.vatCode === line.vatCode
      );
    })
  );
}
