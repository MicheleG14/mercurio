import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type StockMovement } from '../../generated/prisma/client.js';
import {
  isUniqueViolation,
  TenantContextService,
  TenantDatabase,
  type TenantTransaction,
} from '../../prisma/index.js';
import { fromDecimal, QUANTITY } from '../../shared/decimal.js';
import { DomainException, FieldErrors, optionalText } from '../../shared/errors/index.js';
import { type Page, parseSort, skipAndTake } from '../../shared/pagination.js';
import { escapeLike } from '../../shared/text.js';
import { AuditService } from '../audit/index.js';
import { IdentityService } from '../identity/index.js';
import { type ItemRef, RegistryService, unitDecimals } from '../registry/index.js';
import { type CompanyContext, companyOf } from '../../prisma/index.js';
import {
  documentReference,
  type DocumentType,
  NOTES_REQUIRED,
  parseDocumentReference,
  SERIES_OF_TYPE,
  STOCK_REASONS,
} from './reasons.js';
import type {
  CreateStockDocumentDto,
  DocumentLinkDto,
  StockDocumentDto,
  StockDocumentsQuery,
  StockDocumentSummaryDto,
  StockLineDto,
} from './stock-documents.dto.js';
import { type DocumentRow, StockDocumentsRepository } from './stock-documents.repository.js';
import type { Origin, PostOptions, ReverseOptions } from './origins.js';
import {
  availableAfterConsumption,
  balanceChanges,
  type BalanceState,
  businessToday,
  documentDateError,
  fromDbDate,
  isCalendarDate,
  keyOf,
  lockOrder,
  planMovements,
  plannedConsumption,
  type PlannedLine,
  type PlannedMovement,
  quantityError,
  reverseMovements,
  shortages,
  type StockKey,
  toDbDate,
  touchedKeys,
} from './stock-rules.js';
import { WarehousesRepository } from './warehouses.repository.js';

const TYPE_OF_SERIES = Object.fromEntries(
  Object.entries(SERIES_OF_TYPE).map(([type, series]) => [series, type]),
) as Record<string, DocumentType>;

/**
 * Stock documents: recording one, reversing one, reading them. Recording is one transaction
 * (B12) in a fixed order: lock the warehouses (against archiving), lock the balances in lock
 * order (B34), check that none goes below zero, take the number, write the document and its
 * movements, update the balances, record the audit event. See docs/adr/0021.
 */
@Injectable()
export class StockDocumentsService {
  constructor(
    private readonly repository: StockDocumentsRepository,
    private readonly warehouses: WarehousesRepository,
    private readonly registry: RegistryService,
    private readonly identity: IdentityService,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records a document, or returns the one already recorded with the same id and content (B33):
   * `created` tells which, so the API answers 201 or 200.
   */
  async post(
    dto: CreateStockDocumentDto,
  ): Promise<{ document: StockDocumentDto; created: boolean }> {
    const company = companyOf(this.contexts.require());
    try {
      return await this.db.run(async (tx) => {
        const same = await this.sameAsExisting(tx, dto);
        if (same) return { document: same, created: false };
        return { document: await this.postIn(tx, company, dto), created: true };
      });
    } catch (error) {
      // Two requests with the same id at once: the primary key let one through. The other one
      // looks at what was recorded, now committed.
      if (!isUniqueViolation(error)) throw error;
      const same = await this.db.run((tx) => this.sameAsExisting(tx, dto));
      if (same) return { document: same, created: false };
      throw new DomainException('DOCUMENT_ID_REUSED', HttpStatus.CONFLICT);
    }
  }

  /** Records a document in an open transaction: the API and the demo seed both come here. */
  async postIn(
    tx: TenantTransaction,
    company: CompanyContext,
    dto: CreateStockDocumentDto,
    options: PostOptions = {},
  ): Promise<StockDocumentDto> {
    const today = options.today ?? businessToday();
    const rule = STOCK_REASONS[dto.reason];
    const errors = new FieldErrors();
    const documentDate = dto.documentDate ?? today;
    const dateError = documentDateError(documentDate, today);
    if (dateError) errors.add('documentDate', dateError);

    // Warehouses first, locked against archiving until this transaction ends.
    const target = dto.targetWarehouseId ?? null;
    if (rule.direction === 'transfer') {
      if (!target) errors.add('targetWarehouseId', 'REQUIRED');
      else if (target === dto.warehouseId) errors.add('targetWarehouseId', 'SAME_WAREHOUSE');
    } else if (target) {
      errors.add('targetWarehouseId', 'NOT_ALLOWED');
    }
    const warehouseIds = [
      dto.warehouseId,
      ...(target && rule.direction === 'transfer' ? [target] : []),
    ];
    const locked = await this.warehouses.lockForDocument(tx, company.companyId, warehouseIds);
    for (const [field, id] of [
      ['warehouseId', dto.warehouseId],
      ['targetWarehouseId', target],
    ] as const) {
      if (!id || !warehouseIds.includes(id)) continue;
      const warehouse = locked.find((w) => w.id === id);
      if (!warehouse) errors.add(field, 'WAREHOUSE_NOT_FOUND');
      else if (warehouse.archived) errors.add(field, 'WAREHOUSE_ARCHIVED');
    }

    await this.checkParty(tx, dto, errors);
    const partyDocumentRef = optionalText(dto.partyDocumentRef);
    const partyDocumentDate = dto.partyDocumentDate ?? null;
    if ((partyDocumentRef || partyDocumentDate) && rule.party === null) {
      errors.add(partyDocumentRef ? 'partyDocumentRef' : 'partyDocumentDate', 'NOT_ALLOWED');
    }
    if (partyDocumentDate) {
      if (!isCalendarDate(partyDocumentDate)) errors.add('partyDocumentDate', 'DATE_INVALID');
      else if (partyDocumentDate > documentDate) {
        errors.add('partyDocumentDate', 'DATE_AFTER_DOCUMENT');
      }
    }
    const notes = optionalText(dto.notes);
    if (!notes && NOTES_REQUIRED.includes(dto.reason)) errors.add('notes', 'REQUIRED');

    const items = await this.registry.findItemRefs(
      tx,
      dto.lines.map((line) => line.itemId),
    );
    const lines = this.checkLines(dto, items, errors);
    errors.throwIfAny();

    // Balances, locked in lock order; an adjustment reads the stock only now, under the lock.
    const header = { warehouseId: dto.warehouseId, targetWarehouseId: target };
    const stock = await this.lockStock(tx, company, touchedKeys(rule.direction, header, lines));
    const physical = new Map([...stock].map(([key, balance]) => [key, balance.quantity]));
    const movements = planMovements(rule.direction, header, lines, physical);
    if (rule.direction === 'counted') {
      for (const movement of movements.filter((m) => m.quantity.isZero())) {
        errors.add(`lines[${movement.lineNo - 1}].countedQuantity`, 'NO_DIFFERENCE');
      }
      errors.throwIfAny();
    }
    // Then the reservations this document takes its goods from (B34: after the balances).
    const consumed = await this.consumeReservations(tx, dto, lines, options);
    this.assertStock(movements, availableAfterConsumption(stock, consumed), rule.direction);

    const year = Number(documentDate.slice(0, 4));
    const number = await this.repository.nextNumber(tx, company, rule.series, year);
    const created = await this.write(tx, company, {
      id: dto.id,
      reason: dto.reason,
      series: rule.series,
      year,
      number,
      documentDate: toDbDate(documentDate),
      warehouseId: dto.warehouseId,
      targetWarehouseId: rule.direction === 'transfer' ? target : null,
      partyId: dto.partyId ?? null,
      partyDocumentRef,
      partyDocumentDate: partyDocumentDate ? toDbDate(partyDocumentDate) : null,
      notes,
      ...originColumns(options.origin),
      movements,
      consumed,
    });
    await this.recordEvent(tx, company, 'STOCK_DOCUMENT_POSTED', created.id, {
      reference: documentReference({ series: rule.series, year, number }),
      reason: dto.reason,
    });
    return this.detail(tx, created.id, company.companyId);
  }

  /**
   * Reverses a document with one that moves the same goods back, dated today. A document is
   * reversed at most once (unique index); a reversal is not reversed (record a new document).
   */
  async reverse(id: string): Promise<StockDocumentDto> {
    const company = companyOf(this.contexts.require());
    try {
      // Through the API never with an origin: a document made by an order is undone there (B35).
      return await this.db.run((tx) => this.reverseIn(tx, company, id));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainException('ALREADY_REVERSED', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async reverseIn(
    tx: TenantTransaction,
    company: CompanyContext,
    id: string,
    options: ReverseOptions = {},
  ): Promise<StockDocumentDto> {
    const today = options.today ?? businessToday();
    const original = await this.require(tx, company.companyId, id);
    if (original.reason === 'REVERSAL') {
      throw new DomainException('CANNOT_REVERSE_REVERSAL', HttpStatus.CONFLICT);
    }
    if (original.originType && !sameOrigin(original, options.origin)) {
      throw new DomainException('DOCUMENT_HAS_ORIGIN', HttpStatus.CONFLICT, {
        detail: `Made by ${original.originReference}: undo it from there`,
      });
    }
    if (original.reversedBy) throw new DomainException('ALREADY_REVERSED', HttpStatus.CONFLICT);

    const warehouseIds = [original.warehouseId, original.targetWarehouseId].filter(
      (w): w is string => w !== null,
    );
    const locked = await this.warehouses.lockForDocument(tx, company.companyId, warehouseIds);
    if (locked.some((w) => w.archived)) {
      throw new DomainException('WAREHOUSE_ARCHIVED', HttpStatus.CONFLICT);
    }
    const movements = reverseMovements(
      (await this.repository.movementsOf(tx, original.id)).map(toPlanned),
    );
    const stock = await this.lockStock(
      tx,
      company,
      movements.map((m) => ({ warehouseId: m.warehouseId, itemId: m.itemId })),
    );
    // Another reversal may have been waiting on the same balances: look again, now that they are
    // ours, so the answer is "already reversed" rather than a stock error caused by that reversal.
    if ((await this.repository.findById(tx, company.companyId, id))?.reversedBy) {
      throw new DomainException('ALREADY_REVERSED', HttpStatus.CONFLICT);
    }
    this.assertStock(movements, availableAfterConsumption(stock, []), 'out');

    const year = Number(today.slice(0, 4));
    const number = await this.repository.nextNumber(tx, company, original.series, year);
    const created = await this.write(tx, company, {
      reason: 'REVERSAL',
      series: original.series,
      year,
      number,
      documentDate: toDbDate(today),
      warehouseId: original.warehouseId,
      targetWarehouseId: original.targetWarehouseId,
      partyId: original.partyId,
      partyDocumentRef: original.partyDocumentRef,
      partyDocumentDate: original.partyDocumentDate,
      reversesId: original.id,
      notes: null,
      originType: original.originType,
      originId: original.originId,
      originReference: original.originReference,
      movements,
      consumed: [],
    });
    await this.recordEvent(tx, company, 'STOCK_DOCUMENT_REVERSED', created.id, {
      reference: documentReference({ series: original.series, year, number }),
      reverses: documentReference(original),
    });
    return this.detail(tx, created.id, company.companyId);
  }

  async get(id: string): Promise<StockDocumentDto> {
    const { companyId } = companyOf(this.contexts.require());
    return this.db.run((tx) => this.detail(tx, id, companyId));
  }

  async list(query: StockDocumentsQuery): Promise<Page<StockDocumentSummaryDto>> {
    const { companyId } = companyOf(this.contexts.require());
    const sort = parseSort(query.sort, ['date', 'number'] as const) ?? {
      field: 'date',
      direction: 'desc',
    };
    const orderBy: Prisma.StockDocumentOrderByWithRelationInput[] =
      sort.field === 'date'
        ? [{ documentDate: sort.direction }, { createdAt: sort.direction }]
        : [{ year: sort.direction }, { series: sort.direction }, { number: sort.direction }];
    const text = query.q?.trim();
    const reference = text ? parseDocumentReference(text) : null;
    const where: Prisma.StockDocumentWhereInput = {
      companyId,
      ...(query.reason ? { reason: query.reason } : {}),
      ...(query.type ? { series: SERIES_OF_TYPE[query.type] } : {}),
      ...(query.partyId ? { partyId: query.partyId } : {}),
      ...(query.from || query.to
        ? {
            documentDate: {
              ...(query.from ? { gte: toDbDate(query.from) } : {}),
              ...(query.to ? { lte: toDbDate(query.to) } : {}),
            },
          }
        : {}),
      AND: [
        query.warehouseId
          ? { OR: [{ warehouseId: query.warehouseId }, { targetWarehouseId: query.warehouseId }] }
          : {},
        reference
          ? reference
          : text
            ? { partyDocumentRef: { contains: escapeLike(text), mode: 'insensitive' } }
            : {},
      ],
    };
    const { items, total } = await this.db.run(async (tx) => {
      const page = await this.repository.list(
        tx,
        where,
        [...orderBy, { id: 'asc' }],
        skipAndTake(query),
      );
      const parties = await this.registry.findPartyRefs(
        tx,
        page.items.map((d) => d.partyId).filter((p): p is string => p !== null),
      );
      const names = new Map(parties.map((p) => [p.id, p.name]));
      return {
        items: page.items.map((d) => summary(d, d.partyId ? (names.get(d.partyId) ?? null) : null)),
        total: page.total,
      };
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** The document with this id when its content is the same as the request; 409 if it is not. */
  private async sameAsExisting(
    tx: TenantTransaction,
    dto: CreateStockDocumentDto,
  ): Promise<StockDocumentDto | null> {
    const existing = await this.repository.findAnyById(tx, dto.id);
    if (!existing) return null;
    const { companyId } = companyOf(this.contexts.require());
    const movements = await this.repository.movementsOf(tx, existing.id);
    if (existing.companyId !== companyId || !sameContent(existing, movements, dto)) {
      throw new DomainException('DOCUMENT_ID_REUSED', HttpStatus.CONFLICT);
    }
    return this.detail(tx, existing.id, companyId);
  }

  private async checkParty(
    tx: TenantTransaction,
    dto: CreateStockDocumentDto,
    errors: FieldErrors,
  ) {
    const rule = STOCK_REASONS[dto.reason];
    if (!dto.partyId) {
      if (rule.partyRequired) errors.add('partyId', 'REQUIRED');
      return;
    }
    if (rule.party === null) {
      errors.add('partyId', 'NOT_ALLOWED');
      return;
    }
    const [party] = await this.registry.findPartyRefs(tx, [dto.partyId]);
    if (!party) errors.add('partyId', 'PARTY_NOT_FOUND');
    else if (party.archived) errors.add('partyId', 'PARTY_ARCHIVED');
    else if (rule.party === 'supplier' ? !party.isSupplier : !party.isCustomer) {
      errors.add('partyId', 'PARTY_WRONG_ROLE');
    }
  }

  /**
   * Line rules: the item exists and is managed in stock; an archived item may only go out (to
   * clear what is left); quantities have the unit's decimals; an adjustment counts each item once.
   */
  private checkLines(
    dto: CreateStockDocumentDto,
    items: ItemRef[],
    errors: FieldErrors,
  ): PlannedLine[] {
    const direction = STOCK_REASONS[dto.reason].direction;
    const byId = new Map(items.map((item) => [item.id, item]));
    const seen = new Set<string>();
    return dto.lines.map((line, index) => {
      const at = (field: string) => `lines[${index}].${field}`;
      const item = byId.get(line.itemId);
      if (!item) errors.add(at('itemId'), 'ITEM_NOT_FOUND');
      else if (!item.stockManaged) errors.add(at('itemId'), 'ITEM_NOT_STOCK_MANAGED');
      else if (item.archived && (direction === 'in' || direction === 'transfer')) {
        errors.add(at('itemId'), 'ITEM_ARCHIVED');
      }
      const decimals = item ? unitDecimals(item.unit) : 3;

      if (direction === 'counted') {
        if (seen.has(line.itemId)) errors.add(at('itemId'), 'DUPLICATE_ITEM');
        seen.add(line.itemId);
        if (line.quantity !== undefined) errors.add(at('quantity'), 'NOT_ALLOWED');
        const problem =
          line.countedQuantity === undefined
            ? 'REQUIRED'
            : quantityError(line.countedQuantity, decimals, true);
        if (problem) errors.add(at('countedQuantity'), problem);
        return {
          itemId: line.itemId,
          countedQuantity: problem ? undefined : new Prisma.Decimal(line.countedQuantity!),
        };
      }
      if (line.countedQuantity !== undefined) errors.add(at('countedQuantity'), 'NOT_ALLOWED');
      const problem =
        line.quantity === undefined ? 'REQUIRED' : quantityError(line.quantity, decimals);
      if (problem) errors.add(at('quantity'), problem);
      return {
        itemId: line.itemId,
        quantity: problem ? undefined : new Prisma.Decimal(line.quantity!),
      };
    });
  }

  private async lockStock(
    tx: TenantTransaction,
    company: CompanyContext,
    keys: StockKey[],
  ): Promise<Map<string, BalanceState>> {
    const rows = await this.repository.lockBalances(tx, company, lockOrder(keys));
    return new Map(
      rows.map((row) => [
        keyOf(row),
        { quantity: new Prisma.Decimal(row.quantity), reserved: new Prisma.Decimal(row.reserved) },
      ]),
    );
  }

  /**
   * 409 on every line that takes out more than is available, that is, not promised to an order
   * (docs/adr/0025). An inventory count below what is reserved is STOCK_RESERVED: the goods are
   * promised, so someone has to release them from the orders first.
   */
  private assertStock(
    movements: PlannedMovement[],
    available: Map<string, Prisma.Decimal>,
    direction: string,
  ) {
    const missing = shortages(movements, available);
    if (missing.length === 0) return;
    const [code, field] =
      direction === 'counted'
        ? ['STOCK_RESERVED', 'countedQuantity']
        : ['STOCK_INSUFFICIENT', 'quantity'];
    throw new DomainException(code, HttpStatus.CONFLICT, {
      errors: missing.flatMap((shortage) =>
        shortage.lineNos.map((lineNo) => ({ field: `lines[${lineNo - 1}].${field}`, code })),
      ),
    });
  }

  /**
   * Locks the reservations the lines of an issue take goods from, and says how much each gives:
   * the line's quantity, or the whole reservation if it holds less (the rest must be free stock).
   * A reservation of another item or warehouse, or used by two lines, is a bug of the caller.
   */
  private async consumeReservations(
    tx: TenantTransaction,
    dto: CreateStockDocumentDto,
    lines: PlannedLine[],
    options: PostOptions,
  ): Promise<ConsumedReservation[]> {
    const wanted = options.reservations ?? [];
    const lineIds = wanted.filter((id): id is string => id !== null);
    if (lineIds.length === 0) return [];
    if (!options.origin || STOCK_REASONS[dto.reason].direction !== 'out') {
      throw new Error('Only an issue with an origin takes goods from reservations');
    }
    if (new Set(lineIds).size !== lineIds.length) {
      throw new Error('Two lines of a document take goods from the same reservation');
    }
    const rows = await this.repository.lockReservations(tx, options.origin.type, lineIds);
    const byLine = new Map(rows.map((row) => [row.originLineId, row]));
    const held = lines.map((line, index) => {
      const row = wanted[index] ? byLine.get(wanted[index]) : undefined;
      if (row && (row.itemId !== line.itemId || row.warehouseId !== dto.warehouseId)) {
        throw new Error(`Reservation ${row.id} is not for line ${index + 1}`);
      }
      return row ?? null;
    });
    const amounts = plannedConsumption(
      lines.map((line) => ({ quantity: line.quantity! })),
      held.map((row) => (row ? new Prisma.Decimal(row.quantity) : null)),
    );
    return held.flatMap((row, index) =>
      row && !amounts[index]!.isZero()
        ? [
            {
              id: row.id,
              warehouseId: row.warehouseId,
              itemId: row.itemId,
              originLineId: row.originLineId,
              held: new Prisma.Decimal(row.quantity),
              quantity: amounts[index]!,
            },
          ]
        : [],
    );
  }

  private async write(
    tx: TenantTransaction,
    company: CompanyContext,
    data: Omit<Prisma.StockDocumentUncheckedCreateInput, 'tenantId' | 'companyId'> & {
      movements: PlannedMovement[];
      consumed: ConsumedReservation[];
    },
  ) {
    const { movements, consumed, ...document } = data;
    const created = await this.repository.create(
      tx,
      {
        ...document,
        tenantId: company.tenantId,
        companyId: company.companyId,
        createdById: company.userId,
      },
      movements.map((movement) => ({
        tenantId: company.tenantId,
        companyId: company.companyId,
        lineNo: movement.lineNo,
        warehouseId: movement.warehouseId,
        itemId: movement.itemId,
        quantity: movement.quantity,
        countedQuantity: movement.countedQuantity,
        movementDate: document.documentDate,
      })),
    );
    // Reservations first, then quantity and reserved together on each balance.
    for (const reservation of consumed) {
      await this.repository.setReservationQuantity(
        tx,
        reservation.id,
        reservation.held.minus(reservation.quantity),
      );
    }
    const reservedChanges = new Map<string, Prisma.Decimal>();
    for (const reservation of consumed) {
      const key = keyOf(reservation);
      reservedChanges.set(
        key,
        (reservedChanges.get(key) ?? new Prisma.Decimal(0)).minus(reservation.quantity),
      );
    }
    await this.repository.applyChanges(
      tx,
      balanceChanges(movements).map((change) => ({
        ...change,
        reservedChange: reservedChanges.get(keyOf(change)),
      })),
    );
    return created;
  }

  private async require(tx: TenantTransaction, companyId: string, id: string) {
    const document = await this.repository.findById(tx, companyId, id);
    if (!document) throw new DomainException('STOCK_DOCUMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    return document;
  }

  private async detail(
    tx: TenantTransaction,
    id: string,
    companyId: string,
  ): Promise<StockDocumentDto> {
    const document = await this.require(tx, companyId, id);
    const movements = await this.repository.movementsOf(tx, id);
    const items = new Map(
      (
        await this.registry.findItemRefs(
          tx,
          movements.map((m) => m.itemId),
        )
      ).map((i) => [i.id, i]),
    );
    const [party] = document.partyId
      ? await this.registry.findPartyRefs(tx, [document.partyId])
      : [];
    const user = document.createdById
      ? await this.identity.getUser(tx, document.createdById)
      : null;
    const signed = document.series === 'RE';
    const lines: StockLineDto[] = movements
      .filter((m) => m.warehouseId === document.warehouseId)
      .map((m) => {
        const item = items.get(m.itemId);
        return {
          lineNo: m.lineNo,
          itemId: m.itemId,
          itemCode: item?.code ?? '',
          itemDescription: item?.description ?? '',
          unit: item?.unit ?? '',
          quantity: fromDecimal(signed ? m.quantity : m.quantity.abs(), QUANTITY),
          countedQuantity: fromDecimal(m.countedQuantity, QUANTITY),
        };
      });
    return Object.assign(summary(document, party?.name ?? null), {
      partyDocumentDate: document.partyDocumentDate ? fromDbDate(document.partyDocumentDate) : null,
      notes: document.notes,
      createdByName: user?.name ?? null,
      reversedReason: document.reverses?.reason ?? null,
      lines,
    });
  }

  private recordEvent(
    tx: TenantTransaction,
    company: CompanyContext,
    type: 'STOCK_DOCUMENT_POSTED' | 'STOCK_DOCUMENT_REVERSED',
    documentId: string,
    details: Prisma.InputJsonObject,
  ) {
    return this.audit.recordTenantEvent(tx, {
      tenantId: company.tenantId,
      actorUserId: company.userId,
      source: company.userId ? 'API' : 'CLI',
      type,
      subject: { type: 'stock_document', id: documentId },
      details,
    });
  }
}

/** What an issue takes from one reservation: `quantity` out of the `held` it had. */
interface ConsumedReservation extends StockKey {
  id: string;
  originLineId: string;
  held: Prisma.Decimal;
  quantity: Prisma.Decimal;
}

function originColumns(origin: Origin | undefined) {
  return {
    originType: origin?.type ?? null,
    originId: origin?.id ?? null,
    originReference: origin?.reference ?? null,
  };
}

/** Whether the caller is the owner of the document's origin (same kind, same document). */
function sameOrigin(
  document: { originType: string | null; originId: string | null },
  origin: Origin | undefined,
): boolean {
  return (
    origin !== undefined && document.originType === origin.type && document.originId === origin.id
  );
}

function toPlanned(movement: StockMovement): PlannedMovement {
  return {
    lineNo: movement.lineNo,
    warehouseId: movement.warehouseId,
    itemId: movement.itemId,
    quantity: movement.quantity,
    countedQuantity: movement.countedQuantity,
  };
}

function link(
  doc: { id: string; series: string; year: number; number: number } | null,
): DocumentLinkDto | null {
  return doc ? { id: doc.id, reference: documentReference(doc) } : null;
}

function summary(document: DocumentRow, partyName: string | null): StockDocumentSummaryDto {
  const type = TYPE_OF_SERIES[document.series]!;
  return {
    id: document.id,
    reference: documentReference(document),
    reason: document.reason,
    type,
    documentDate: fromDbDate(document.documentDate),
    warehouseId: document.warehouseId,
    warehouseCode: document.warehouse.code,
    targetWarehouseId: document.targetWarehouseId,
    targetWarehouseCode: document.targetWarehouse?.code ?? null,
    partyId: document.partyId,
    partyName,
    partyDocumentRef: document.partyDocumentRef,
    lineCount: document._count.movements / (type === 'transfer' ? 2 : 1),
    reverses: link(document.reverses),
    reversedBy: link(document.reversedBy),
    origin:
      document.originType && document.originId && document.originReference
        ? { type: document.originType, id: document.originId, reference: document.originReference }
        : null,
    createdAt: document.createdAt.toISOString(),
  };
}

/** Whether a recorded document is what this request asks for (B33: same id, same content). */
function sameContent(
  existing: DocumentRow,
  movements: StockMovement[],
  dto: CreateStockDocumentDto,
): boolean {
  const direction = STOCK_REASONS[dto.reason]?.direction;
  const header =
    existing.reason === dto.reason &&
    (dto.documentDate === undefined || fromDbDate(existing.documentDate) === dto.documentDate) &&
    existing.warehouseId === dto.warehouseId &&
    existing.targetWarehouseId ===
      (direction === 'transfer' ? (dto.targetWarehouseId ?? null) : null) &&
    existing.partyId === (dto.partyId ?? null) &&
    existing.partyDocumentRef === optionalText(dto.partyDocumentRef) &&
    (existing.partyDocumentDate ? fromDbDate(existing.partyDocumentDate) : null) ===
      (dto.partyDocumentDate ?? null) &&
    existing.notes === optionalText(dto.notes);
  if (!header) return false;
  const origin = movements.filter((m) => m.warehouseId === existing.warehouseId);
  if (origin.length !== dto.lines.length) return false;
  return dto.lines.every((line, index) => {
    const movement = origin.find((m) => m.lineNo === index + 1);
    if (!movement || movement.itemId !== line.itemId) return false;
    return direction === 'counted'
      ? sameDecimal(movement.countedQuantity, line.countedQuantity)
      : sameDecimal(movement.quantity.abs(), line.quantity);
  });
}

/** "5" and "5.000" are the same quantity; text that is not a number is never the same. */
function sameDecimal(stored: Prisma.Decimal | null, sent: string | undefined): boolean {
  if (stored === null || sent === undefined) return false;
  try {
    return stored.equals(new Prisma.Decimal(sent));
  } catch {
    return false;
  }
}
