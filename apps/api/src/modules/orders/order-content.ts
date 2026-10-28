import { Injectable } from '@nestjs/common';
import { type OrderKind, Prisma } from '../../generated/prisma/client.js';
import type { CompanyContext, TenantTransaction } from '../../prisma/index.js';
import { isCalendarDate } from '../../shared/dates.js';
import { quantityError } from '../../shared/decimal.js';
import { FieldErrors, optionalText } from '../../shared/errors/index.js';
import {
  isVatCode,
  RegistryService,
  unitDecimals,
  type VatCode,
  vatCodeInfo,
} from '../registry/index.js';
import { ORDER_KINDS } from './order-kinds.js';
import {
  discountError,
  lineAmount,
  orderDateError,
  orderTotals,
  priceError,
} from './order-rules.js';
import type { OrderContentDto } from './orders.dto.js';
import { OrdersRepository } from './orders.repository.js';

/** The header of an order once checked: what the table stores. */
export interface CheckedHeader {
  orderDate: string;
  partyId: string;
  warehouseId: string | null;
  partyReference: string | null;
  partyReferenceDate: string | null;
  requestedDate: string | null;
  notes: string | null;
}

/** A line once checked: item data copied, VAT copied from the catalog, amount computed (B36). */
export interface CheckedLine {
  itemId: string;
  description: string;
  unit: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal | null;
  discountPercent: Prisma.Decimal;
  vatCode: VatCode;
  vatRate: Prisma.Decimal;
  vatNature: string | null;
  lineAmount: Prisma.Decimal | null;
}

export interface CheckedContent {
  header: CheckedHeader;
  lines: CheckedLine[];
  totals: { taxableTotal: Prisma.Decimal; vatTotal: Prisma.Decimal; total: Prisma.Decimal };
}

/**
 * The rules of an order's content, for a draft and again when it is confirmed (the party or an
 * item may have been archived in between). A draft may be incomplete: no warehouse, no lines, no
 * prices. Confirming requires them. Field errors use the request's names (B17).
 */
@Injectable()
export class OrderContentChecker {
  constructor(
    private readonly registry: RegistryService,
    private readonly repository: OrdersRepository,
  ) {}

  async check(
    tx: TenantTransaction,
    company: CompanyContext,
    kind: OrderKind,
    dto: OrderContentDto,
    today: string,
    forConfirm = false,
  ): Promise<CheckedContent> {
    const rule = ORDER_KINDS[kind];
    const errors = new FieldErrors();

    const orderDate = dto.orderDate ?? today;
    const dateError = orderDateError(orderDate, today);
    if (dateError) errors.add('orderDate', dateError);
    const partyReferenceDate = dto.partyReferenceDate ?? null;
    if (partyReferenceDate && !isCalendarDate(partyReferenceDate)) {
      errors.add('partyReferenceDate', 'DATE_INVALID');
    }
    const requestedDate = dto.requestedDate ?? null;
    if (requestedDate) {
      if (!isCalendarDate(requestedDate)) errors.add('requestedDate', 'DATE_INVALID');
      else if (requestedDate < orderDate) errors.add('requestedDate', 'REQUESTED_BEFORE_ORDER');
    }

    const [party] = await this.registry.findPartyRefs(tx, [dto.partyId]);
    if (!party) errors.add('partyId', 'PARTY_NOT_FOUND');
    else if (party.archived) errors.add('partyId', 'PARTY_ARCHIVED');
    else if (rule.party === 'supplier' ? !party.isSupplier : !party.isCustomer) {
      errors.add('partyId', 'PARTY_WRONG_ROLE');
    }

    const warehouseId = dto.warehouseId ?? null;
    if (warehouseId) {
      const warehouse = await this.repository.warehouseRef(tx, company.companyId, warehouseId);
      if (!warehouse) errors.add('warehouseId', 'WAREHOUSE_NOT_FOUND');
      else if (warehouse.archived) errors.add('warehouseId', 'WAREHOUSE_ARCHIVED');
    } else if (forConfirm) {
      errors.add('warehouseId', 'REQUIRED');
    }

    if (forConfirm && dto.lines.length === 0) errors.add('lines', 'NO_LINES');
    const items = new Map(
      (
        await this.registry.findItemRefs(
          tx,
          dto.lines.map((line) => line.itemId),
        )
      ).map((item) => [item.id, item]),
    );
    const lines = dto.lines.map((line, index): CheckedLine | null => {
      const at = (field: string) => `lines[${index}].${field}`;
      const item = items.get(line.itemId);
      if (!item) errors.add(at('itemId'), 'ITEM_NOT_FOUND');
      else if (!item.stockManaged) errors.add(at('itemId'), 'ITEM_NOT_STOCK_MANAGED');
      else if (item.archived) errors.add(at('itemId'), 'ITEM_ARCHIVED');

      const quantityProblem = quantityError(line.quantity, item ? unitDecimals(item.unit) : 3);
      if (quantityProblem) errors.add(at('quantity'), quantityProblem);
      const price = line.unitPrice ?? null;
      const priceProblem = price === null ? null : priceError(price);
      if (priceProblem) errors.add(at('unitPrice'), priceProblem);
      else if (price === null && forConfirm && rule.priceRequired) {
        errors.add(at('unitPrice'), 'REQUIRED');
      }
      const discount = line.discountPercent ?? '0';
      const discountProblem = discountError(discount);
      if (discountProblem) errors.add(at('discountPercent'), discountProblem);
      const vatCode = line.vatCode ?? item?.vatCode;
      if (vatCode !== undefined && !isVatCode(vatCode))
        errors.add(at('vatCode'), 'VAT_CODE_UNKNOWN');
      const description = optionalText(line.description) ?? item?.description ?? null;
      if (item && !description) errors.add(at('description'), 'REQUIRED');

      if (
        !item ||
        quantityProblem ||
        priceProblem ||
        discountProblem ||
        !vatCode ||
        !isVatCode(vatCode)
      ) {
        return null;
      }
      const vat = vatCodeInfo(vatCode)!;
      const priced = {
        quantity: new Prisma.Decimal(line.quantity),
        unitPrice: price === null ? null : new Prisma.Decimal(price),
        discountPercent: new Prisma.Decimal(discount),
        vatCode,
      };
      return {
        ...priced,
        itemId: item.id,
        description: description!,
        unit: item.unit,
        vatRate: new Prisma.Decimal(vat.rate),
        vatNature: vat.nature,
        lineAmount: lineAmount(priced)?.toDecimal() ?? null,
      };
    });
    errors.throwIfAny();

    const checked = lines as CheckedLine[];
    const totals = orderTotals(checked);
    return {
      header: {
        orderDate,
        partyId: dto.partyId,
        warehouseId,
        partyReference: optionalText(dto.partyReference),
        partyReferenceDate,
        requestedDate,
        notes: optionalText(dto.notes),
      },
      lines: checked,
      totals: {
        taxableTotal: totals.taxableTotal.toDecimal(),
        vatTotal: totals.vatTotal.toDecimal(),
        total: totals.total.toDecimal(),
      },
    };
  }
}
