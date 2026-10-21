import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../prisma/index.js';
import { toDecimal } from '../../shared/decimal.js';
import { FieldErrors } from './field-errors.js';
import { type ItemInput, normalizeItem, normalizeItemCode } from './item-rules.js';
import { ItemsRepository } from './items.repository.js';
import { PartiesRepository } from './parties.repository.js';
import { normalizeParty, type PartyInput } from './party-rules.js';

/**
 * Public service of the registry module (B3) for code outside a request: terminal commands such
 * as the demo seed. Input goes through the same rules as the API. Methods take the database
 * client, so a caller can combine several modules in one transaction.
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
}
