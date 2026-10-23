import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../prisma/index.js';
import type { CompanyContext } from './company-context.js';
import type { CreateStockDocumentDto, StockDocumentDto } from './stock-documents.dto.js';
import { StockDocumentsService } from './stock-documents.service.js';
import { StockRepository } from './stock.repository.js';
import { WarehousesRepository } from './warehouses.repository.js';
import { WarehousesService } from './warehouses.service.js';

/**
 * Public service of the warehouse module (B3) for code outside a request: the demo seed and the
 * stock check of the terminal. Documents go through the same use case as the API, so the seed
 * obeys the same rules, locks and numbering. Methods take the database client, so a caller can
 * combine several modules in one transaction.
 */
@Injectable()
export class WarehouseService {
  constructor(
    private readonly warehouses: WarehousesService,
    private readonly documents: StockDocumentsService,
    private readonly warehouseRows: WarehousesRepository,
    private readonly stock: StockRepository,
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

  /** Records a document as the API would; `today` lets a seed date its documents. */
  postDocument(
    db: DbClient,
    company: CompanyContext,
    dto: CreateStockDocumentDto,
    today?: string,
  ): Promise<StockDocumentDto> {
    return this.documents.postIn(db, company, dto, today);
  }

  reverseDocument(
    db: DbClient,
    company: CompanyContext,
    id: string,
    today?: string,
  ): Promise<StockDocumentDto> {
    return this.documents.reverseIn(db, company, id, today);
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

  /** Balances that differ from the sum of their movements (B11); empty when all is well. */
  verifyStock(db: DbClient) {
    return this.stock.differences(db);
  }
}
