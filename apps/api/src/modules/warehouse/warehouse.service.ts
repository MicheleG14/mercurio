import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { DbClient, TenantTransaction } from '../../prisma/index.js';
import type { CompanyContext } from './company-context.js';
import type { Origin, PostOptions, ReverseOptions } from './origins.js';
import { ReservationsService, type ReservationWish } from './reservations.service.js';
import type { CreateStockDocumentDto, StockDocumentDto } from './stock-documents.dto.js';
import { StockDocumentsService } from './stock-documents.service.js';
import { StockRepository } from './stock.repository.js';
import { WarehousesRepository } from './warehouses.repository.js';
import { WarehousesService } from './warehouses.service.js';

/**
 * Public service of the warehouse module (B3, B35): for the demo seed, the stock check of the
 * terminal, and the modules that move goods through the warehouse (orders). Documents go through
 * the same use case as the API, so every caller obeys the same rules, locks and numbering.
 * Methods take the database client, so a caller records its own rows and the warehouse's in one
 * transaction, after locking its own document (B34).
 */
@Injectable()
export class WarehouseService {
  constructor(
    private readonly warehouses: WarehousesService,
    private readonly documents: StockDocumentsService,
    private readonly warehouseRows: WarehousesRepository,
    private readonly stock: StockRepository,
    private readonly reservations: ReservationsService,
  ) {}

  /** The warehouse with this code in the company, created when missing. */
  async ensureWarehouse(
    db: DbClient,
    company: CompanyContext,
    input: { code: string; name: string },
  ): Promise<{ id: string; created: boolean }> {
    const existing = await this.warehouseRows.findByCode(db, company.companyId, input.code);
    if (existing) return { id: existing.id, created: false };
    const created = await this.warehouses.createIn(db, company, input);
    return { id: created.id, created: true };
  }

  /** True once any document moved goods in or out of the warehouse. */
  async hasDocuments(db: DbClient, warehouseId: string): Promise<boolean> {
    return this.stock.hasMovements(db, warehouseId);
  }

  /**
   * Records a document as the API would. `today` lets a seed date its documents; an origin marks
   * a document made by another module, and its issue lines may take goods from that origin's
   * reservations first.
   */
  postDocument(
    db: DbClient,
    company: CompanyContext,
    dto: CreateStockDocumentDto,
    options?: PostOptions,
  ): Promise<StockDocumentDto> {
    return this.documents.postIn(db, company, dto, options);
  }

  /** Reverses a document; one with an origin only when that same origin is given. */
  reverseDocument(
    db: DbClient,
    company: CompanyContext,
    id: string,
    options?: ReverseOptions,
  ): Promise<StockDocumentDto> {
    return this.documents.reverseIn(db, company, id, options);
  }

  /**
   * Brings the reservation of each line to what it wants, or as close as available stock
   * allows; returns what each line holds now (docs/adr/0025).
   */
  reserve(
    db: TenantTransaction,
    company: CompanyContext,
    origin: Origin,
    wishes: readonly ReservationWish[],
  ): Promise<{ originLineId: string; reserved: Prisma.Decimal }[]> {
    return this.reservations.reserve(db, company, origin, wishes);
  }

  /** Releases whatever these lines hold. */
  release(
    db: TenantTransaction,
    company: CompanyContext,
    origin: Origin,
    lineIds: readonly string[],
  ): Promise<void> {
    return this.reservations.release(db, company, origin, lineIds);
  }

  /** What each line of this kind of origin holds now (no lock: for reading). */
  async reservedFor(
    db: DbClient,
    originType: string,
    lineIds: readonly string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    const rows = await this.stock.reservationsOfLines(db, originType, lineIds);
    return new Map(rows.map((row) => [row.originLineId, row.quantity]));
  }

  /** Sets the level unless the item already has one in that warehouse. */
  async setReorderLevelIfMissing(
    db: DbClient,
    company: CompanyContext,
    input: { warehouseId: string; itemId: string; reorderPoint: string; reorderQuantity?: string },
  ): Promise<void> {
    if (await this.stock.findReorderLevel(db, input.warehouseId, input.itemId)) return;
    await this.stock.createReorderLevel(db, {
      ...input,
      reorderQuantity: input.reorderQuantity ?? null,
      tenantId: company.tenantId,
      companyId: company.companyId,
    });
  }

  /**
   * Balances that differ from the sum of their movements, or whose reserved quantity differs
   * from the sum of their reservations (B11); empty when all is well.
   */
  verifyStock(db: DbClient) {
    return this.stock.differences(db);
  }
}
