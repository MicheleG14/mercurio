import { HttpStatus, Injectable } from '@nestjs/common';
import type { Party, Prisma } from '../../generated/prisma/client.js';
import {
  isUniqueViolation,
  TenantContextService,
  TenantDatabase,
  type TenantTransaction,
} from '../../prisma/index.js';
import { DomainException } from '../../shared/errors/index.js';
import { compactIdentifier, stripItalianPrefix } from '../../shared/italian-identifiers.js';
import { type Page, parseSort, skipAndTake } from '../../shared/pagination.js';
import { escapeLike } from '../../shared/text.js';
import { type AuditEventType, AuditService } from '../audit/index.js';
import type {
  CreatePartyDto,
  PartiesQuery,
  PartyDto,
  PartyLookupDto,
  PartyLookupQuery,
  PartySummaryDto,
  UpdatePartyDto,
} from './parties.dto.js';
import { PartiesRepository } from './parties.repository.js';
import { legalNameOf, normalizeParty, type PartyData, type PartyInput } from './party-rules.js';
import { assertVersion, changedFields, definedOnly, editConflict } from './versioning.js';

/**
 * Customers and suppliers of the current tenant, shared by all its companies (S3). Every change
 * runs in one transaction with its audit event, carries the version it was based on (B29), and
 * nothing is ever deleted: parties are archived and restored (B31).
 */
@Injectable()
export class PartiesService {
  constructor(
    private readonly repository: PartiesRepository,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async list(query: PartiesQuery): Promise<Page<PartySummaryDto>> {
    const sort = parseSort(query.sort, ['name', 'createdAt'] as const) ?? {
      field: 'name',
      direction: 'asc',
    };
    const where: Prisma.PartyWhereInput = {
      archivedAt: query.archived ? { not: null } : null,
      ...(query.role === 'customer' ? { isCustomer: true } : {}),
      ...(query.role === 'supplier' ? { isSupplier: true } : {}),
      ...(query.q?.trim() ? { OR: searchParties(query.q.trim()) } : {}),
    };
    const { items, total } = await this.db.run((tx) =>
      this.repository.list(
        tx,
        where,
        [{ [sort.field]: sort.direction }, { id: 'asc' }],
        skipAndTake(query),
      ),
    );
    return { items: items.map(toSummary), total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: string): Promise<PartyDto> {
    return toDto(await this.db.run((tx) => this.require(tx, id)));
  }

  /**
   * Parties that already have this VAT number or tax code, archived ones included: the form
   * offers to open (or restore) them instead of entering the same subject twice.
   */
  async lookup(query: PartyLookupQuery): Promise<PartyLookupDto> {
    const vat = query.vatNumber?.trim();
    const taxCode = query.taxCode?.trim();
    if (!vat && !taxCode) {
      throw new DomainException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, {
        errors: [{ field: 'vatNumber', code: 'REQUIRED' }],
      });
    }
    // The country is not known yet: try the number as typed and without the IT prefix.
    const vatNumbers = vat ? [...new Set([compactIdentifier(vat), stripItalianPrefix(vat)])] : [];
    const found = await this.db.run((tx) =>
      this.repository.findByIdentifiers(tx, {
        vatNumbers,
        taxCode: taxCode ? compactIdentifier(taxCode) : undefined,
      }),
    );
    return {
      items: found.map((party) => ({
        id: party.id,
        name: party.name,
        vatNumber: party.vatNumber,
        taxCode: party.taxCode,
        archivedAt: party.archivedAt?.toISOString() ?? null,
      })),
    };
  }

  async create(dto: CreatePartyDto): Promise<PartyDto> {
    const data = normalizeParty(dto);
    return this.write(data.vatNumber, async (tx, tenantId) => {
      await this.assertVatFree(tx, data.vatNumber);
      const party = await this.repository.create(tx, tenantId, data);
      await this.record(tx, 'PARTY_CREATED', party);
      return party;
    });
  }

  /** Only the fields sent change; the result is checked again as a whole, with its kind's rules. */
  async update(id: string, dto: UpdatePartyDto): Promise<PartyDto> {
    const { version, ...changes } = dto;
    return this.write(undefined, async (tx) => {
      const current = await this.require(tx, id);
      assertVersion(current, version);
      if (current.archivedAt) throw new DomainException('ARCHIVED', HttpStatus.CONFLICT);

      const data = normalizeParty({ ...toInput(current), ...definedOnly(changes) });
      const fields = changedFields(dataOf(current), data);
      if (fields.length === 0) return current;
      if (fields.includes('vatNumber')) await this.assertVatFree(tx, data.vatNumber, id);

      const updated = await this.repository.updateAtVersion(tx, id, version, data);
      if (!updated) throw editConflict();
      await this.record(tx, 'PARTY_UPDATED', updated, { fields });
      return updated;
    });
  }

  async archive(id: string, version: number): Promise<PartyDto> {
    return this.write(undefined, async (tx) => {
      const current = await this.require(tx, id);
      assertVersion(current, version);
      if (current.archivedAt) throw new DomainException('ALREADY_ARCHIVED', HttpStatus.CONFLICT);
      const updated = await this.repository.updateAtVersion(tx, id, version, {
        archivedAt: new Date(),
      });
      if (!updated) throw editConflict();
      await this.record(tx, 'PARTY_ARCHIVED', updated);
      return updated;
    });
  }

  /** Refused while another active party has the same VAT number: there can be only one. */
  async restore(id: string, version: number): Promise<PartyDto> {
    return this.write(undefined, async (tx) => {
      const current = await this.require(tx, id);
      assertVersion(current, version);
      if (!current.archivedAt) throw new DomainException('NOT_ARCHIVED', HttpStatus.CONFLICT);
      await this.assertVatFree(tx, current.vatNumber, id);
      const updated = await this.repository.updateAtVersion(tx, id, version, { archivedAt: null });
      if (!updated) throw editConflict();
      await this.record(tx, 'PARTY_RESTORED', updated);
      return updated;
    });
  }

  /**
   * Runs a change and answers with the party. Two requests racing with the same VAT number both
   * pass assertVatFree; the unique index stops the second, answered here like the first check.
   */
  private async write(
    vatNumber: string | null | undefined,
    work: (tx: TenantTransaction, tenantId: string) => Promise<Party>,
  ): Promise<PartyDto> {
    try {
      return toDto(await this.db.run((tx) => work(tx, this.contexts.require().tenantId)));
    } catch (error) {
      if (isUniqueViolation(error)) throw vatTaken(vatNumber ?? undefined);
      throw error;
    }
  }

  private async require(tx: TenantTransaction, id: string): Promise<Party> {
    // Another tenant's party is invisible (Row-Level Security): it is "not found" like any other.
    const party = await this.repository.findById(tx, id);
    if (!party) throw new DomainException('PARTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    return party;
  }

  private async assertVatFree(tx: TenantTransaction, vatNumber: string | null, exceptId?: string) {
    if (!vatNumber) return;
    const existing = await this.repository.findActiveByVat(tx, vatNumber, exceptId);
    if (existing) throw vatTaken(existing.id);
  }

  private record(
    tx: TenantTransaction,
    type: AuditEventType,
    party: Party,
    details?: { fields: string[] },
  ) {
    const context = this.contexts.require();
    return this.audit.recordTenantEvent(tx, {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      source: 'API',
      type,
      subject: { type: 'party', id: party.id },
      details,
    });
  }
}

/** 409 with the id of the active party that has the number, when known, to lead the UI to it. */
function vatTaken(existingId?: string) {
  return new DomainException('PARTY_VAT_TAKEN', HttpStatus.CONFLICT, {
    errors: [{ field: 'vatNumber', code: 'PARTY_VAT_TAKEN' }],
    existingId,
  });
}

/** "Contains" on name, VAT number, tax code and city, served by the trigram indexes. */
function searchParties(text: string): Prisma.PartyWhereInput[] {
  const contains = (value: string) => ({
    contains: escapeLike(value),
    mode: 'insensitive' as const,
  });
  const identifier = compactIdentifier(text);
  return [
    { name: contains(text) },
    { city: contains(text) },
    { vatNumber: contains(identifier) },
    { taxCode: contains(identifier) },
  ];
}

/** The stored fields a person controls, as normalizeParty returns them. */
function dataOf(party: Party): PartyData {
  return {
    kind: party.kind,
    isCustomer: party.isCustomer,
    isSupplier: party.isSupplier,
    name: party.name,
    firstName: party.firstName,
    lastName: party.lastName,
    legalForm: party.legalForm,
    vatNumber: party.vatNumber,
    taxCode: party.taxCode,
    country: party.country,
    address: party.address,
    postalCode: party.postalCode,
    city: party.city,
    province: party.province,
    email: party.email,
    phone: party.phone,
    pecEmail: party.pecEmail,
    sdiCode: party.sdiCode,
    notes: party.notes,
  };
}

/** A stored party as the form that would produce it, to apply a partial change on top. */
function toInput(party: Party): PartyInput {
  return { ...dataOf(party), legalName: legalNameOf(party) };
}

function toSummary(party: Party): PartySummaryDto {
  return {
    id: party.id,
    kind: party.kind,
    isCustomer: party.isCustomer,
    isSupplier: party.isSupplier,
    name: party.name,
    vatNumber: party.vatNumber,
    taxCode: party.taxCode,
    country: party.country,
    city: party.city,
    province: party.province,
    version: party.version,
    archivedAt: party.archivedAt?.toISOString() ?? null,
    createdAt: party.createdAt.toISOString(),
  };
}

function toDto(party: Party): PartyDto {
  return {
    ...dataOf(party),
    id: party.id,
    legalName: legalNameOf(party),
    version: party.version,
    archivedAt: party.archivedAt?.toISOString() ?? null,
    createdAt: party.createdAt.toISOString(),
    updatedAt: party.updatedAt.toISOString(),
  };
}
