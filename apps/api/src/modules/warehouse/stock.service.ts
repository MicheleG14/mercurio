import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type ReorderLevel } from '../../generated/prisma/client.js';
import {
  isUniqueViolation,
  TenantContextService,
  TenantDatabase,
  type TenantTransaction,
} from '../../prisma/index.js';
import { fromDecimal, QUANTITY } from '../../shared/decimal.js';
import { DomainException, FieldErrors } from '../../shared/errors/index.js';
import { type Page, parseSort, skipAndTake } from '../../shared/pagination.js';
import { editConflict } from '../../shared/versioning.js';
import { AuditService } from '../audit/index.js';
import { RegistryService, unitDecimals } from '../registry/index.js';
import { type CompanyContext, companyOf } from './company-context.js';
import { documentReference } from './reasons.js';
import { StockDocumentsRepository } from './stock-documents.repository.js';
import { businessToday, fromDbDate, quantityError, toDbDate } from './stock-rules.js';
import type {
  ItemOptionDto,
  ItemSearchQuery,
  ItemStockDto,
  MovementPageDto,
  MovementsQuery,
  PartyOptionDto,
  PartySearchQuery,
  ReorderLevelDto,
  SetReorderLevelDto,
  StockQuery,
  StockRowDto,
  StockSummaryDto,
} from './stock.dto.js';
import { STOCK_SORTS, StockRepository } from './stock.repository.js';
import { WarehousesRepository } from './warehouses.repository.js';

const quantity = (value: Prisma.Decimal) => fromDecimal(value, QUANTITY);
const optionalQuantity = (value: Prisma.Decimal | null) => fromDecimal(value, QUANTITY);

/** What is in stock, where, and how it got there; reorder levels. Reads only, apart from levels. */
@Injectable()
export class StockService {
  constructor(
    private readonly repository: StockRepository,
    private readonly documents: StockDocumentsRepository,
    private readonly warehouses: WarehousesRepository,
    private readonly registry: RegistryService,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async list(query: StockQuery): Promise<Page<StockRowDto>> {
    const company = this.company();
    const sort = parseSort(query.sort, STOCK_SORTS) ?? { field: 'code', direction: 'asc' };
    const { rows, total } = await this.db.run(async (tx) => {
      if (query.warehouseId) await this.requireWarehouse(tx, company, query.warehouseId);
      return this.repository.list(
        tx,
        {
          companyId: company.companyId,
          warehouseId: query.warehouseId,
          q: query.q?.trim() || undefined,
          belowReorder: query.belowReorder,
          includeZero: query.includeZero,
          asOf: query.asOf,
        },
        sort,
        skipAndTake(query),
      );
    });
    return {
      items: rows.map((row) => ({
        itemId: row.itemId,
        itemCode: row.code,
        itemDescription: row.description,
        unit: row.unit,
        unitDecimals: unitDecimals(row.unit),
        itemArchived: row.archived,
        quantity: quantity(row.quantity),
        reorderPoint: optionalQuantity(row.reorderPoint),
        reorderQuantity: optionalQuantity(row.reorderQuantity),
        belowReorder: row.below,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async item(itemId: string): Promise<ItemStockDto> {
    const company = this.company();
    return this.db.run(async (tx) => {
      const [item] = await this.registry.findItemRefs(tx, [itemId]);
      if (!item) throw new DomainException('ITEM_NOT_FOUND', HttpStatus.NOT_FOUND);
      const rows = await this.repository.itemByWarehouse(tx, company.companyId, itemId);
      const total = rows.reduce((sum, row) => sum.plus(row.quantity), new Prisma.Decimal(0));
      return {
        itemId: item.id,
        itemCode: item.code,
        itemDescription: item.description,
        unit: item.unit,
        unitDecimals: unitDecimals(item.unit),
        itemArchived: item.archived,
        stockManaged: item.stockManaged,
        quantity: quantity(total),
        warehouses: rows.map((row) => ({
          warehouseId: row.warehouseId,
          warehouseCode: row.code,
          warehouseName: row.name,
          warehouseArchived: row.archived,
          quantity: quantity(row.quantity),
          reorderPoint: optionalQuantity(row.reorderPoint),
          reorderQuantity: optionalQuantity(row.reorderQuantity),
          reorderVersion: row.reorderVersion,
          belowReorder:
            row.reorderPoint !== null && row.quantity.lessThanOrEqualTo(row.reorderPoint),
        })),
      };
    });
  }

  async movements(itemId: string, query: MovementsQuery): Promise<MovementPageDto> {
    const company = this.company();
    const { rows, total } = await this.db.run(async (tx) => {
      if (query.warehouseId) await this.requireWarehouse(tx, company, query.warehouseId);
      return this.repository.movements(
        tx,
        {
          companyId: company.companyId,
          itemId,
          warehouseId: query.warehouseId,
          from: query.from,
          to: query.to,
        },
        skipAndTake(query),
      );
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        movementDate: fromDbDate(row.movementDate),
        documentId: row.documentId,
        reference: documentReference(row),
        reason: row.reason,
        warehouseCode: row.warehouseCode,
        quantity: quantity(row.quantity),
        balance: quantity(row.balance),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async searchItems(query: ItemSearchQuery): Promise<ItemOptionDto[]> {
    const company = this.company();
    const rows = await this.db.run(async (tx) => {
      // Only a warehouse of this company: otherwise its stock would show through.
      if (query.warehouseId) await this.requireWarehouse(tx, company, query.warehouseId);
      return this.repository.searchItems(tx, query.q?.trim() || undefined, query.warehouseId);
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      description: row.description,
      unit: row.unit,
      unitDecimals: unitDecimals(row.unit),
      archived: row.archived,
      quantity: optionalQuantity(row.quantity),
    }));
  }

  searchParties(query: PartySearchQuery): Promise<PartyOptionDto[]> {
    return this.db.run((tx) =>
      this.repository.searchParties(tx, query.q?.trim() || undefined, query.role),
    );
  }

  async summary(): Promise<StockSummaryDto> {
    const company = this.company();
    return this.db.run(async (tx) => {
      const below = await this.repository.list(
        tx,
        { companyId: company.companyId, belowReorder: true, includeZero: true },
        { field: 'code', direction: 'asc' },
        { skip: 0, take: 1 },
      );
      const today = await this.documents.countToday(
        tx,
        company.companyId,
        toDbDate(businessToday()),
      );
      return { belowReorder: below.total, documentsToday: today };
    });
  }

  /** Creates the level (no version) or changes it (the version read, B29). */
  async setReorderLevel(
    warehouseId: string,
    itemId: string,
    dto: SetReorderLevelDto,
  ): Promise<ReorderLevelDto> {
    const company = this.company();
    try {
      return toLevelDto(
        await this.db.run(async (tx) => {
          const code = await this.requireActiveWarehouse(tx, company, warehouseId);
          const [item] = await this.registry.findItemRefs(tx, [itemId]);
          if (!item) throw new DomainException('ITEM_NOT_FOUND', HttpStatus.NOT_FOUND);
          const errors = new FieldErrors();
          if (!item.stockManaged) errors.add('itemId', 'ITEM_NOT_STOCK_MANAGED');
          const decimals = unitDecimals(item.unit);
          const pointError = quantityError(dto.reorderPoint, decimals, true);
          if (pointError) errors.add('reorderPoint', pointError);
          const reorderQuantity = dto.reorderQuantity ?? null;
          const quantityProblem =
            reorderQuantity === null ? null : quantityError(reorderQuantity, decimals);
          if (quantityProblem) errors.add('reorderQuantity', quantityProblem);
          errors.throwIfAny();

          const data = {
            reorderPoint: new Prisma.Decimal(dto.reorderPoint),
            reorderQuantity: reorderQuantity === null ? null : new Prisma.Decimal(reorderQuantity),
          };
          const key = { warehouseId, itemId };
          const level =
            dto.version === undefined
              ? await this.repository.createReorderLevel(tx, {
                  ...key,
                  ...data,
                  tenantId: company.tenantId,
                  companyId: company.companyId,
                })
              : await this.repository.updateReorderLevel(tx, key, dto.version, data);
          if (!level) throw editConflict();
          await this.recordLevel(tx, company, 'REORDER_LEVEL_SET', itemId, code);
          return level;
        }),
      );
    } catch (error) {
      // Someone else created the level first: this person's form is out of date.
      if (isUniqueViolation(error)) throw editConflict();
      throw error;
    }
  }

  async removeReorderLevel(warehouseId: string, itemId: string, version: number): Promise<void> {
    const company = this.company();
    await this.db.run(async (tx) => {
      const code = await this.requireWarehouse(tx, company, warehouseId);
      const level = await this.repository.findReorderLevel(tx, warehouseId, itemId);
      if (!level) throw new DomainException('REORDER_LEVEL_NOT_FOUND', HttpStatus.NOT_FOUND);
      if (!(await this.repository.deleteReorderLevel(tx, { warehouseId, itemId }, version))) {
        throw editConflict();
      }
      await this.recordLevel(tx, company, 'REORDER_LEVEL_REMOVED', itemId, code);
    });
  }

  private company(): CompanyContext {
    return companyOf(this.contexts.require());
  }

  /** The code of a warehouse of this company; another company's is as missing as a wrong id. */
  private async requireWarehouse(
    tx: TenantTransaction,
    company: CompanyContext,
    id: string,
  ): Promise<string> {
    const warehouse = await this.warehouses.findInCompany(tx, company.companyId, id);
    if (!warehouse) throw new DomainException('WAREHOUSE_NOT_FOUND', HttpStatus.NOT_FOUND);
    return warehouse.code;
  }

  private async requireActiveWarehouse(
    tx: TenantTransaction,
    company: CompanyContext,
    id: string,
  ): Promise<string> {
    const warehouse = await this.warehouses.findInCompany(tx, company.companyId, id);
    if (!warehouse) throw new DomainException('WAREHOUSE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (warehouse.archivedAt) throw new DomainException('WAREHOUSE_ARCHIVED', HttpStatus.CONFLICT);
    return warehouse.code;
  }

  private recordLevel(
    tx: TenantTransaction,
    company: CompanyContext,
    type: 'REORDER_LEVEL_SET' | 'REORDER_LEVEL_REMOVED',
    itemId: string,
    warehouseCode: string,
  ) {
    return this.audit.recordTenantEvent(tx, {
      tenantId: company.tenantId,
      actorUserId: company.userId,
      source: company.userId ? 'API' : 'CLI',
      type,
      subject: { type: 'item', id: itemId },
      details: { warehouse: warehouseCode },
    });
  }
}

function toLevelDto(level: ReorderLevel): ReorderLevelDto {
  return {
    warehouseId: level.warehouseId,
    itemId: level.itemId,
    reorderPoint: quantity(level.reorderPoint),
    reorderQuantity: optionalQuantity(level.reorderQuantity),
    version: level.version,
  };
}
