import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { TenantTransaction } from '../../prisma/index.js';
import { DomainException } from '../../shared/errors/index.js';
import type { CompanyContext } from './company-context.js';
import type { Origin } from './origins.js';
import { StockDocumentsRepository } from './stock-documents.repository.js';
import { type BalanceState, keyOf, lockOrder, planReservations } from './stock-rules.js';
import { WarehousesRepository } from './warehouses.repository.js';

/** One line of another module asking for goods: where, which item, and how much in all. */
export interface ReservationWish {
  originLineId: string;
  warehouseId: string;
  itemId: string;
  /** What the line should hold in all; zero releases it. A decimal string or a Decimal. */
  wanted: string | Prisma.Decimal;
}

/**
 * Reservations: goods of a balance promised to a line of another module (docs/adr/0025). Called
 * only through the public service, inside the caller's transaction, which has already locked its
 * own document (B34: the caller's rows first, then warehouses, balances, reservations). No audit
 * event here: the caller records what it did ("order confirmed"), as the warehouse records its
 * documents.
 */
@Injectable()
export class ReservationsService {
  constructor(
    private readonly repository: StockDocumentsRepository,
    private readonly warehouses: WarehousesRepository,
  ) {}

  /**
   * Brings each line's reservation to what it wants, or as close as available stock allows, and
   * returns what each line holds now. Asking for less releases the difference.
   */
  async reserve(
    tx: TenantTransaction,
    company: CompanyContext,
    origin: Origin,
    wishes: readonly ReservationWish[],
  ): Promise<{ originLineId: string; reserved: Prisma.Decimal }[]> {
    if (wishes.length === 0) return [];
    const lineIds = wishes.map((w) => w.originLineId);
    if (new Set(lineIds).size !== lineIds.length) {
      throw new Error('A line appears twice in one reservation request');
    }

    // Warehouses first, against archiving; then balances and reservations, in lock order.
    const warehouseIds = [...new Set(wishes.map((w) => w.warehouseId))].sort();
    const locked = await this.warehouses.lockForDocument(tx, company.companyId, warehouseIds);
    if (locked.length !== warehouseIds.length) {
      throw new DomainException('WAREHOUSE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    const balances = await this.repository.lockBalances(tx, company, lockOrder(wishes));
    const stock = new Map<string, BalanceState>(
      balances.map((b) => [
        keyOf(b),
        { quantity: new Prisma.Decimal(b.quantity), reserved: new Prisma.Decimal(b.reserved) },
      ]),
    );
    const existing = new Map(
      (await this.repository.lockReservations(tx, origin.type, lineIds)).map((r) => [
        r.originLineId,
        r,
      ]),
    );
    for (const wish of wishes) {
      const row = existing.get(wish.originLineId);
      if (row && (row.warehouseId !== wish.warehouseId || row.itemId !== wish.itemId)) {
        throw new Error(`Line ${wish.originLineId} has a reservation on another item or warehouse`);
      }
    }

    const planned = planReservations(
      wishes.map((wish) => ({
        originLineId: wish.originLineId,
        warehouseId: wish.warehouseId,
        itemId: wish.itemId,
        current: existing.get(wish.originLineId)?.quantity ?? new Prisma.Decimal(0),
        wanted: new Prisma.Decimal(wish.wanted),
      })),
      stock,
    );
    const changed = planned.filter((p) => !p.reserved.equals(p.current));
    await this.repository.saveReservations(
      tx,
      company,
      origin,
      changed.map((p) => ({
        warehouseId: p.warehouseId,
        itemId: p.itemId,
        originLineId: p.originLineId,
        existingId: existing.get(p.originLineId)?.id ?? null,
        quantity: p.reserved,
      })),
    );
    const byBalance = new Map<string, Prisma.Decimal>();
    for (const p of changed) {
      const key = keyOf(p);
      byBalance.set(
        key,
        (byBalance.get(key) ?? new Prisma.Decimal(0)).plus(p.reserved.minus(p.current)),
      );
    }
    await this.repository.applyChanges(
      tx,
      lockOrder(changed).map((key) => ({ ...key, reservedChange: byBalance.get(keyOf(key))! })),
    );
    return planned.map((p) => ({ originLineId: p.originLineId, reserved: p.reserved }));
  }

  /** Releases the reservations of these lines, whatever they hold. */
  async release(
    tx: TenantTransaction,
    company: CompanyContext,
    origin: Origin,
    lineIds: readonly string[],
  ): Promise<void> {
    // Read without locking to learn the balances, then lock in order through reserve. Only the
    // caller changes these lines, and it holds the lock on its own document.
    const rows = await this.repository.findReservations(tx, origin.type, lineIds);
    await this.reserve(
      tx,
      company,
      origin,
      rows.map((row) => ({
        originLineId: row.originLineId,
        warehouseId: row.warehouseId,
        itemId: row.itemId,
        wanted: '0',
      })),
    );
  }
}
