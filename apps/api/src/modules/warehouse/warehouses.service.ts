import { HttpStatus, Injectable } from '@nestjs/common';
import type { Warehouse } from '../../generated/prisma/client.js';
import {
  isUniqueViolation,
  TenantContextService,
  TenantDatabase,
  type TenantTransaction,
} from '../../prisma/index.js';
import { DomainException, FieldErrors } from '../../shared/errors/index.js';
import { type Page, skipAndTake } from '../../shared/pagination.js';
import { assertVersion, editConflict } from '../../shared/versioning.js';
import { type AuditEventType, AuditService } from '../audit/index.js';
import { type CompanyContext, companyOf } from '../../prisma/index.js';
import type {
  CreateWarehouseDto,
  UpdateWarehouseDto,
  WarehouseDto,
  WarehousesQuery,
} from './warehouses.dto.js';
import { WarehousesRepository } from './warehouses.repository.js';

const WAREHOUSE_CODE = /^[A-Z0-9-]{1,10}$/;

/** The code of a new warehouse: trimmed and uppercase, so "sede" and "SEDE" are the same code. */
export function normalizeWarehouseCode(value: string, errors: FieldErrors): string {
  const code = value.trim().toUpperCase();
  if (!code) errors.add('code', 'REQUIRED');
  else if (!WAREHOUSE_CODE.test(code)) errors.add('code', 'WAREHOUSE_CODE_INVALID');
  return code;
}

export function normalizeWarehouseName(value: string, errors: FieldErrors): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) errors.add('name', 'REQUIRED');
  else if (name.length > 100) errors.add('name', 'TOO_LONG');
  return name;
}

/**
 * Warehouses of the current company. Same rules as the registry (versions, archiving instead of
 * deleting), plus one of its own: a warehouse is archived only when empty, so no stock ever
 * disappears from the totals.
 */
@Injectable()
export class WarehousesService {
  constructor(
    private readonly repository: WarehousesRepository,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async list(query: WarehousesQuery): Promise<Page<WarehouseDto>> {
    const { companyId } = this.company();
    const { items, total } = await this.db.run((tx) =>
      this.repository.list(
        tx,
        { companyId, archivedAt: query.archived ? { not: null } : null },
        skipAndTake(query),
      ),
    );
    return { items: items.map(toDto), total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: string): Promise<WarehouseDto> {
    return toDto(await this.db.run((tx) => this.require(tx, id)));
  }

  async create(dto: CreateWarehouseDto): Promise<WarehouseDto> {
    const company = this.company();
    return toDto(await this.db.run((tx) => this.createIn(tx, company, dto)));
  }

  /** Also used by the demo seed, through WarehouseService. */
  async createIn(
    tx: TenantTransaction,
    company: CompanyContext,
    dto: CreateWarehouseDto,
  ): Promise<Warehouse> {
    const errors = new FieldErrors();
    const code = normalizeWarehouseCode(dto.code, errors);
    const name = normalizeWarehouseName(dto.name, errors);
    errors.throwIfAny();
    try {
      // A savepoint would be needed to go on after a unique violation inside the transaction;
      // there is nothing to go on with, so the error simply ends it.
      const warehouse = await this.repository.create(tx, {
        tenantId: company.tenantId,
        companyId: company.companyId,
        code,
        name,
      });
      await this.record(tx, company, 'WAREHOUSE_CREATED', warehouse);
      return warehouse;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainException('WAREHOUSE_CODE_TAKEN', HttpStatus.CONFLICT, {
          errors: [{ field: 'code', code: 'WAREHOUSE_CODE_TAKEN' }],
        });
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateWarehouseDto): Promise<WarehouseDto> {
    const company = this.company();
    return toDto(
      await this.db.run(async (tx) => {
        const current = await this.require(tx, id);
        assertVersion(current, dto.version);
        if (current.archivedAt) throw new DomainException('ARCHIVED', HttpStatus.CONFLICT);
        const errors = new FieldErrors();
        const name = normalizeWarehouseName(dto.name, errors);
        errors.throwIfAny();
        if (name === current.name) return current;
        const updated = await this.repository.updateAtVersion(tx, id, dto.version, { name });
        if (!updated) throw editConflict();
        await this.record(tx, company, 'WAREHOUSE_UPDATED', updated, { fields: ['name'] });
        return updated;
      }),
    );
  }

  async archive(id: string, version: number): Promise<WarehouseDto> {
    const company = this.company();
    return toDto(
      await this.db.run(async (tx) => {
        const current = await this.require(tx, id);
        assertVersion(current, version);
        if (current.archivedAt) throw new DomainException('ALREADY_ARCHIVED', HttpStatus.CONFLICT);
        // Update first: the row lock makes a document being recorded finish before the stock
        // check below, so the check sees its goods (see lockForDocument).
        const updated = await this.repository.updateAtVersion(tx, id, version, {
          archivedAt: new Date(),
        });
        if (!updated) throw editConflict();
        if (await this.repository.hasStock(tx, id)) {
          throw new DomainException('WAREHOUSE_NOT_EMPTY', HttpStatus.CONFLICT);
        }
        await this.record(tx, company, 'WAREHOUSE_ARCHIVED', updated);
        return updated;
      }),
    );
  }

  async restore(id: string, version: number): Promise<WarehouseDto> {
    const company = this.company();
    return toDto(
      await this.db.run(async (tx) => {
        const current = await this.require(tx, id);
        assertVersion(current, version);
        if (!current.archivedAt) throw new DomainException('NOT_ARCHIVED', HttpStatus.CONFLICT);
        const updated = await this.repository.updateAtVersion(tx, id, version, {
          archivedAt: null,
        });
        if (!updated) throw editConflict();
        await this.record(tx, company, 'WAREHOUSE_RESTORED', updated);
        return updated;
      }),
    );
  }

  private company(): CompanyContext {
    return companyOf(this.contexts.require());
  }

  /** A warehouse of the current company; one of another company is as missing as a wrong id. */
  private async require(tx: TenantTransaction, id: string): Promise<Warehouse> {
    const warehouse = await this.repository.findInCompany(tx, this.company().companyId, id);
    if (!warehouse) throw new DomainException('WAREHOUSE_NOT_FOUND', HttpStatus.NOT_FOUND);
    return warehouse;
  }

  private record(
    tx: TenantTransaction,
    company: CompanyContext,
    type: AuditEventType,
    warehouse: Warehouse,
    details?: { fields: string[] },
  ) {
    return this.audit.recordTenantEvent(tx, {
      tenantId: company.tenantId,
      actorUserId: company.userId,
      source: company.userId ? 'API' : 'CLI',
      type,
      subject: { type: 'warehouse', id: warehouse.id },
      details: { code: warehouse.code, ...details },
    });
  }
}

export function toDto(warehouse: Warehouse): WarehouseDto {
  return {
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    version: warehouse.version,
    archivedAt: warehouse.archivedAt?.toISOString() ?? null,
    createdAt: warehouse.createdAt.toISOString(),
    updatedAt: warehouse.updatedAt.toISOString(),
  };
}
