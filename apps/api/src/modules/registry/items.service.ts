import { HttpStatus, Injectable } from '@nestjs/common';
import type { Item, Prisma } from '../../generated/prisma/client.js';
import {
  isUniqueViolation,
  TenantContextService,
  TenantDatabase,
  type TenantTransaction,
} from '../../prisma/index.js';
import { fromDecimal, PRICE, toDecimal } from '../../shared/decimal.js';
import { DomainException } from '../../shared/errors/index.js';
import { type Page, parseSort, skipAndTake } from '../../shared/pagination.js';
import { escapeLike } from '../../shared/text.js';
import { type AuditEventType, AuditService } from '../audit/index.js';
import { FieldErrors } from './field-errors.js';
import { type ItemData, normalizeItem, normalizeItemCode } from './item-rules.js';
import type { CreateItemDto, ItemDto, ItemsQuery, UpdateItemDto } from './items.dto.js';
import { ItemsRepository } from './items.repository.js';
import { assertVersion, changedFields, definedOnly, editConflict } from './versioning.js';

/**
 * Items of the current tenant: the same rules as parties (one transaction with its audit event,
 * versions, archiving), plus a code that is never reused nor changed, since documents print it.
 */
@Injectable()
export class ItemsService {
  constructor(
    private readonly repository: ItemsRepository,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ItemsQuery): Promise<Page<ItemDto>> {
    const sort = parseSort(query.sort, ['code', 'description', 'createdAt'] as const) ?? {
      field: 'code',
      direction: 'asc',
    };
    const text = query.q?.trim() ? escapeLike(query.q.trim()) : undefined;
    const where: Prisma.ItemWhereInput = {
      archivedAt: query.archived ? { not: null } : null,
      ...(query.stockManaged !== undefined ? { stockManaged: query.stockManaged } : {}),
      ...(text
        ? {
            OR: [
              { code: { contains: text, mode: 'insensitive' } },
              { description: { contains: text, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const { items, total } = await this.db.run((tx) =>
      this.repository.list(
        tx,
        where,
        [{ [sort.field]: sort.direction }, { id: 'asc' }],
        skipAndTake(query),
      ),
    );
    return { items: items.map(toDto), total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: string): Promise<ItemDto> {
    return toDto(await this.db.run((tx) => this.require(tx, id)));
  }

  async create(dto: CreateItemDto): Promise<ItemDto> {
    const errors = new FieldErrors();
    const code = normalizeItemCode(dto.code, errors);
    const data = normalizeItem(dto, errors);
    return this.write(async (tx, tenantId) => {
      const item = await this.repository.create(tx, { tenantId, code, ...toColumns(data) });
      await this.record(tx, 'ITEM_CREATED', item);
      return item;
    });
  }

  async update(id: string, dto: UpdateItemDto): Promise<ItemDto> {
    const { version, ...changes } = dto;
    return this.write(async (tx) => {
      const current = await this.require(tx, id);
      assertVersion(current, version);
      if (current.archivedAt) throw new DomainException('ARCHIVED', HttpStatus.CONFLICT);

      const data = normalizeItem({ ...dataOf(current), ...definedOnly(changes) });
      const fields = changedFields(dataOf(current), withPriceScale(data));
      if (fields.length === 0) return current;

      const updated = await this.repository.updateAtVersion(tx, id, version, toColumns(data));
      if (!updated) throw editConflict();
      await this.record(tx, 'ITEM_UPDATED', updated, { fields });
      return updated;
    });
  }

  async archive(id: string, version: number): Promise<ItemDto> {
    return this.setArchived(id, version, true);
  }

  async restore(id: string, version: number): Promise<ItemDto> {
    return this.setArchived(id, version, false);
  }

  private setArchived(id: string, version: number, archive: boolean): Promise<ItemDto> {
    return this.write(async (tx) => {
      const current = await this.require(tx, id);
      assertVersion(current, version);
      if (archive && current.archivedAt) {
        throw new DomainException('ALREADY_ARCHIVED', HttpStatus.CONFLICT);
      }
      if (!archive && !current.archivedAt) {
        throw new DomainException('NOT_ARCHIVED', HttpStatus.CONFLICT);
      }
      const updated = await this.repository.updateAtVersion(tx, id, version, {
        archivedAt: archive ? new Date() : null,
      });
      if (!updated) throw editConflict();
      await this.record(tx, archive ? 'ITEM_ARCHIVED' : 'ITEM_RESTORED', updated);
      return updated;
    });
  }

  /** Runs a change. The unique index on lower(code) answers for duplicate codes, races included. */
  private async write(
    work: (tx: TenantTransaction, tenantId: string) => Promise<Item>,
  ): Promise<ItemDto> {
    try {
      return toDto(await this.db.run((tx) => work(tx, this.contexts.require().tenantId)));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainException('ITEM_CODE_TAKEN', HttpStatus.CONFLICT, {
          errors: [{ field: 'code', code: 'ITEM_CODE_TAKEN' }],
        });
      }
      throw error;
    }
  }

  private async require(tx: TenantTransaction, id: string): Promise<Item> {
    const item = await this.repository.findById(tx, id);
    if (!item) throw new DomainException('ITEM_NOT_FOUND', HttpStatus.NOT_FOUND);
    return item;
  }

  private record(
    tx: TenantTransaction,
    type: AuditEventType,
    item: Item,
    details?: { fields: string[] },
  ) {
    const context = this.contexts.require();
    return this.audit.recordTenantEvent(tx, {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      source: 'API',
      type,
      subject: { type: 'item', id: item.id },
      details,
    });
  }
}

function dataOf(item: Item): ItemData {
  return {
    description: item.description,
    unit: item.unit,
    vatCode: item.vatCode,
    salePrice: fromDecimal(item.salePrice, PRICE),
    stockManaged: item.stockManaged,
    notes: item.notes,
  };
}

function toColumns(data: ItemData) {
  return { ...data, salePrice: data.salePrice === null ? null : toDecimal(data.salePrice) };
}

/** "12.5" as stored and read back, "12.5000", so that an unchanged price compares equal. */
function withPriceScale(data: ItemData): ItemData {
  return {
    ...data,
    salePrice: data.salePrice === null ? null : fromDecimal(toDecimal(data.salePrice), PRICE),
  };
}

function toDto(item: Item): ItemDto {
  return {
    id: item.id,
    code: item.code,
    ...dataOf(item),
    version: item.version,
    archivedAt: item.archivedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
