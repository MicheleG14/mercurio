import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../prisma/index.js';
import { fromDecimal, PRICE, toDecimal } from '../../shared/decimal.js';
import { FieldErrors } from '../../shared/errors/index.js';
import { type ItemInput, normalizeItem, normalizeItemCode } from './item-rules.js';
import { ItemsRepository } from './items.repository.js';
import { PartiesRepository } from './parties.repository.js';
import { normalizeParty, type PartyInput } from './party-rules.js';

/** What other modules may know of an item (the columns of the view registry_item_refs). */
export interface ItemRef {
  id: string;
  code: string;
  description: string;
  unit: string;
  stockManaged: boolean;
  archived: boolean;
  /** List price, unit price precision (B8, B30): what an order line proposes. */
  salePrice: string | null;
  vatCode: string;
}

/** What other modules may know of a party (the columns of the view registry_party_refs). */
export interface PartyRef {
  id: string;
  name: string;
  isCustomer: boolean;
  isSupplier: boolean;
  archived: boolean;
}

/**
 * Public service of the registry module (B3): for terminal commands such as the demo seed, and
 * for other modules that need to check an item or a party (the warehouse, from phase 3). Input
 * goes through the same rules as the API. Methods take the database client, so a caller can
 * combine several modules in one transaction.
 */
@Injectable()
export class RegistryService {
  constructor(
    private readonly parties: PartiesRepository,
    private readonly items: ItemsRepository,
  ) {}

  /** Adds the party unless the tenant already has the same subject. True when added. */
  async addPartyIfMissing(
    db: DbClient,
    tenantId: string,
    input: PartyInput & { archived?: boolean },
  ): Promise<boolean> {
    const data = normalizeParty(input);
    if (await this.parties.findSame(db, tenantId, data)) return false;
    const party = await this.parties.create(db, tenantId, data);
    if (input.archived) {
      await this.parties.updateAtVersion(db, party.id, party.version, { archivedAt: new Date() });
    }
    return true;
  }

  /** Adds the item unless the tenant already has its code. True when added. */
  async addItemIfMissing(
    db: DbClient,
    tenantId: string,
    input: ItemInput & { code: string },
  ): Promise<boolean> {
    const errors = new FieldErrors();
    const code = normalizeItemCode(input.code, errors);
    const data = normalizeItem(input, errors);
    if (await this.items.codeExists(db, tenantId, code)) return false;
    await this.items.create(db, {
      tenantId,
      code,
      ...data,
      salePrice: data.salePrice === null ? null : toDecimal(data.salePrice),
    });
    return true;
  }

  /** Items of the current tenant among these ids; missing ones are simply absent. */
  async findItemRefs(db: DbClient, ids: readonly string[]): Promise<ItemRef[]> {
    if (ids.length === 0) return [];
    const items = await this.items.findMany(db, [...new Set(ids)]);
    return items.map((item) => ({
      id: item.id,
      code: item.code,
      description: item.description,
      unit: item.unit,
      stockManaged: item.stockManaged,
      archived: item.archivedAt !== null,
      salePrice: fromDecimal(item.salePrice, PRICE),
      vatCode: item.vatCode,
    }));
  }

  /** Parties of the current tenant among these ids; missing ones are simply absent. */
  async findPartyRefs(db: DbClient, ids: readonly string[]): Promise<PartyRef[]> {
    if (ids.length === 0) return [];
    const parties = await this.parties.findMany(db, [...new Set(ids)]);
    return parties.map((party) => ({
      id: party.id,
      name: party.name,
      isCustomer: party.isCustomer,
      isSupplier: party.isSupplier,
      archived: party.archivedAt !== null,
    }));
  }

  /** Ids of the tenant's items with these codes (any case), by code as given. */
  async itemIdsByCode(
    db: DbClient,
    tenantId: string,
    codes: readonly string[],
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const code of codes) {
      const id = await this.items.findIdByCode(db, tenantId, code);
      if (id) ids.set(code, id);
    }
    return ids;
  }

  /** The id of the tenant's active party with this VAT number, or null. */
  async partyIdByVat(db: DbClient, tenantId: string, vatNumber: string): Promise<string | null> {
    return (await this.parties.findActiveInTenantByVat(db, tenantId, vatNumber))?.id ?? null;
  }
}
