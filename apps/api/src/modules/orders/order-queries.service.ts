import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import {
  companyOf,
  TenantContextService,
  TenantDatabase,
  type TenantTransaction,
} from '../../prisma/index.js';
import { businessToday, fromDbDate } from '../../shared/dates.js';
import { fromDecimal, PRICE, QUANTITY } from '../../shared/decimal.js';
import { DomainException } from '../../shared/errors/index.js';
import { Money } from '../../shared/money.js';
import { parseSort, skipAndTake } from '../../shared/pagination.js';
import { IdentityService } from '../identity/index.js';
import { RegistryService, unitDecimals, type VatCode, vatSummary } from '../registry/index.js';
import { WarehouseService } from '../warehouse/index.js';
import { ORDER_KINDS, orderReference, parseOrderReference } from './order-kinds.js';
import { isOpen, remainingOf } from './order-rules.js';
import type {
  IncomingDto,
  OrderDto,
  OrderItemOptionDto,
  OrderItemSearchQuery,
  OrderPageDto,
  OrderPartyOptionDto,
  OrderPartySearchQuery,
  OrdersQuery,
  OrdersSummaryDto,
  OrderSummaryDto,
  ReorderProposalLineDto,
} from './orders.dto.js';
import { ORDER_SORTS, type OrderListRow, OrdersRepository } from './orders.repository.js';

const quantity = (value: Prisma.Decimal) => fromDecimal(value, QUANTITY);
const amount = (value: Prisma.Decimal) => value.toFixed(2);
const reference = (order: { series: string | null; year: number | null; number: number | null }) =>
  order.series && order.year && order.number
    ? orderReference({ series: order.series, year: order.year, number: order.number })
    : null;

/** Reading orders: lists, the detail with what each line holds and can still get, searches. */
@Injectable()
export class OrderQueriesService {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly registry: RegistryService,
    private readonly warehouse: WarehouseService,
    private readonly identity: IdentityService,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
  ) {}

  private company() {
    return companyOf(this.contexts.require());
  }

  async list(query: OrdersQuery): Promise<OrderPageDto> {
    const { companyId } = this.company();
    const sort = parseSort(query.sort, ORDER_SORTS) ?? { field: 'date', direction: 'desc' };
    const q = query.q?.trim() || undefined;
    const { rows, total } = await this.db.run((tx) =>
      this.repository.list(
        tx,
        {
          companyId,
          kind: query.kind,
          status: query.status,
          partyId: query.partyId,
          warehouseId: query.warehouseId,
          from: query.from,
          to: query.to,
          q,
          reference: q ? parseOrderReference(q) : null,
          uncovered: query.uncovered,
          late: query.late,
          today: businessToday(),
        },
        sort,
        skipAndTake(query),
      ),
    );
    return { items: rows.map(summaryOf), total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: string): Promise<OrderDto> {
    const { companyId } = this.company();
    return this.db.run((tx) => this.detail(tx, companyId, id));
  }

  /** The order as the API returns it, read in the caller's transaction. */
  async detail(tx: TenantTransaction, companyId: string, id: string): Promise<OrderDto> {
    const order = await this.repository.findById(tx, companyId, id);
    if (!order) throw new DomainException('ORDER_NOT_FOUND', HttpStatus.NOT_FOUND);
    const [party] = await this.registry.findPartyRefs(tx, [order.partyId]);
    const warehouse = order.warehouseId
      ? await this.repository.warehouseRef(tx, companyId, order.warehouseId)
      : null;
    const items = new Map(
      (
        await this.registry.findItemRefs(
          tx,
          order.lines.map((l) => l.itemId),
        )
      ).map((i) => [i.id, i]),
    );
    const reserved = await this.repository.reservedByLine(tx, order.id);
    const available = order.warehouseId
      ? await this.repository.availableIn(
          tx,
          order.warehouseId,
          order.lines.map((l) => l.itemId),
        )
      : new Map<string, Prisma.Decimal>();
    const documents = await this.warehouse.documentReferences(
      tx,
      order.fulfilments.flatMap((f) => [
        f.stockDocumentId,
        f.reversalDocumentId ?? f.stockDocumentId,
      ]),
    );
    const names = new Map<string, string>();
    for (const userId of new Set(
      [order.createdById, ...order.fulfilments.map((f) => f.createdById)].filter(
        (u): u is string => u !== null,
      ),
    )) {
      const user = await this.identity.getUser(tx, userId);
      if (user) names.set(userId, user.name);
    }

    const zero = new Prisma.Decimal(0);
    const open = isOpen(order.status);
    const lines = order.lines.map((line) => {
      const remaining = remainingOf(line);
      return {
        id: line.id,
        lineNo: line.lineNo,
        itemId: line.itemId,
        itemCode: items.get(line.itemId)?.code ?? '',
        description: line.description,
        unit: line.unit,
        unitDecimals: unitDecimals(line.unit),
        quantity: quantity(line.quantity),
        unitPrice: fromDecimal(line.unitPrice, PRICE),
        discountPercent: line.discountPercent.toFixed(2),
        vatCode: line.vatCode,
        vatRate: line.vatRate.toFixed(2),
        vatNature: line.vatNature,
        lineAmount: line.lineAmount ? amount(line.lineAmount) : null,
        doneQuantity: quantity(line.doneQuantity),
        closedQuantity: quantity(line.closedQuantity),
        remainingQuantity: quantity(remaining),
        reservedQuantity: quantity(reserved.get(line.id) ?? zero),
        availableQuantity: order.warehouseId ? quantity(available.get(line.itemId) ?? zero) : null,
        uncovered: remaining.greaterThan(reserved.get(line.id) ?? zero),
      };
    });
    const summary = vatSummary(
      order.lines
        .filter((line) => line.lineAmount !== null)
        .map((line) => ({ vatCode: line.vatCode as VatCode, amount: Money.of(line.lineAmount!) })),
    );
    return Object.assign(
      summaryOf({
        ...order,
        partyName: party?.name ?? '',
        warehouseCode: warehouse?.code ?? null,
        lineCount: BigInt(order.lines.length),
        late:
          open && order.requestedDate !== null && fromDbDate(order.requestedDate) < businessToday(),
        uncovered: open && ORDER_KINDS[order.kind].reserves && lines.some((line) => line.uncovered),
      }),
      {
        warehouseName: warehouse?.name ?? null,
        partyReferenceDate: order.partyReferenceDate ? fromDbDate(order.partyReferenceDate) : null,
        notes: order.notes,
        vatTotal: amount(order.vatTotal),
        vatSummary: summary.rows.map((row) => ({
          vatCode: row.vatCode,
          rate: row.rate,
          nature: row.nature,
          taxable: row.taxable.toString(),
          vat: row.vat.toString(),
        })),
        lines: lines.map(({ uncovered: _uncovered, ...line }) => line),
        fulfilments: order.fulfilments.map((f) => ({
          id: f.id,
          documentDate: fromDbDate(f.fulfilmentDate),
          stockDocumentId: f.stockDocumentId,
          stockDocumentReference: documents.get(f.stockDocumentId) ?? '',
          reversalDocumentId: f.reversalDocumentId,
          reversalDocumentReference: f.reversalDocumentId
            ? (documents.get(f.reversalDocumentId) ?? null)
            : null,
          reversedAt: f.reversedAt?.toISOString() ?? null,
          createdByName: f.createdById ? (names.get(f.createdById) ?? null) : null,
          createdAt: f.createdAt.toISOString(),
          lines: f.lines.map((l) => ({
            orderLineId: l.orderLineId,
            quantity: quantity(l.quantity),
          })),
        })),
        createdByName: order.createdById ? (names.get(order.createdById) ?? null) : null,
        confirmedAt: order.confirmedAt?.toISOString() ?? null,
        cancelledAt: order.cancelledAt?.toISOString() ?? null,
        createdAt: order.createdAt.toISOString(),
      },
    );
  }

  async searchItems(query: OrderItemSearchQuery): Promise<OrderItemOptionDto[]> {
    const { companyId } = this.company();
    const rows = await this.db.run(async (tx) => {
      // Only a warehouse of this company: otherwise its stock would show through.
      if (
        query.warehouseId &&
        !(await this.repository.warehouseRef(tx, companyId, query.warehouseId))
      ) {
        throw new DomainException('WAREHOUSE_NOT_FOUND', HttpStatus.NOT_FOUND);
      }
      return this.repository.searchItems(tx, query.q?.trim() || undefined, query.warehouseId);
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      description: row.description,
      unit: row.unit,
      unitDecimals: unitDecimals(row.unit),
      salePrice: fromDecimal(row.salePrice, PRICE),
      vatCode: row.vatCode,
      availableQuantity: row.available === null ? null : quantity(row.available),
    }));
  }

  searchParties(query: OrderPartySearchQuery): Promise<OrderPartyOptionDto[]> {
    return this.db.run((tx) =>
      this.repository.searchParties(
        tx,
        query.q?.trim() || undefined,
        ORDER_KINDS[query.kind].party,
      ),
    );
  }

  async incoming(itemId: string): Promise<IncomingDto> {
    const { companyId } = this.company();
    const rows = await this.db.run((tx) => this.repository.incoming(tx, companyId, itemId));
    return {
      itemId,
      quantity: quantity(rows.reduce((sum, row) => sum.plus(row.remaining), new Prisma.Decimal(0))),
      orders: rows.map((row) => ({
        orderId: row.orderId,
        reference: orderReference(row),
        warehouseId: row.warehouseId,
        warehouseCode: row.warehouseCode,
        requestedDate: row.requestedDate ? fromDbDate(row.requestedDate) : null,
        remainingQuantity: quantity(row.remaining),
      })),
    };
  }

  /**
   * What to order for a warehouse: the items at or below their reorder point, each with the
   * reorder quantity (or what brings it back to the point) less what suppliers already bring.
   * Items already covered by incoming orders are left out.
   */
  async reorderProposal(warehouseId: string): Promise<ReorderProposalLineDto[]> {
    const company = this.company();
    return this.db.run(async (tx) => {
      if (!(await this.repository.warehouseRef(tx, company.companyId, warehouseId))) {
        throw new DomainException('WAREHOUSE_NOT_FOUND', HttpStatus.NOT_FOUND);
      }
      const below = await this.warehouse.belowReorder(tx, company, warehouseId);
      const incoming = await this.repository.incomingByItem(tx, company.companyId, warehouseId);
      const items = new Map(
        (
          await this.repository.itemRefs(
            tx,
            below.map((b) => b.itemId),
          )
        ).map((i) => [i.id, i]),
      );
      const zero = new Prisma.Decimal(0);
      return below.flatMap((row) => {
        const item = items.get(row.itemId);
        if (!item) return [];
        const coming = incoming.get(row.itemId) ?? zero;
        const wanted = row.reorderQuantity ?? row.reorderPoint.minus(row.available);
        const proposed = Prisma.Decimal.max(wanted.minus(coming), zero).toDecimalPlaces(
          unitDecimals(item.unit),
          Prisma.Decimal.ROUND_UP,
        );
        if (proposed.isZero()) return [];
        return [
          {
            itemId: item.id,
            itemCode: item.code,
            description: item.description,
            unit: item.unit,
            unitDecimals: unitDecimals(item.unit),
            vatCode: item.vatCode,
            availableQuantity: quantity(row.available),
            reorderPoint: quantity(row.reorderPoint),
            incomingQuantity: quantity(coming),
            proposedQuantity: quantity(proposed),
          },
        ];
      });
    });
  }

  async summary(): Promise<OrdersSummaryDto> {
    const { companyId } = this.company();
    return (await this.db.run((tx) =>
      this.repository.counts(tx, companyId, businessToday()),
    )) as unknown as OrdersSummaryDto;
  }
}

function summaryOf(
  order: Omit<OrderListRow, 'requestedDate' | 'orderDate'> & {
    orderDate: Date;
    requestedDate: Date | null;
  },
): OrderSummaryDto {
  return {
    id: order.id,
    kind: order.kind,
    status: order.status,
    reference: reference(order),
    orderDate: fromDbDate(order.orderDate),
    partyId: order.partyId,
    partyName: order.partyName,
    warehouseId: order.warehouseId,
    warehouseCode: order.warehouseCode,
    partyReference: order.partyReference,
    requestedDate: order.requestedDate ? fromDbDate(order.requestedDate) : null,
    taxableTotal: amount(order.taxableTotal),
    total: amount(order.total),
    lineCount: Number(order.lineCount),
    late: order.late,
    uncovered: order.uncovered,
    version: order.version,
  };
}
