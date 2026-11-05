import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type CompanyContext,
  companyOf,
  isUniqueViolation,
  TenantContextService,
  TenantDatabase,
  type TenantTransaction,
} from '../../prisma/index.js';
import { businessToday, fromDbDate } from '../../shared/dates.js';
import { DomainException, FieldErrors } from '../../shared/errors/index.js';
import { Money } from '../../shared/money.js';
import { editConflict } from '../../shared/versioning.js';
import { RegistryService } from '../registry/index.js';
import { type CheckedContent, creditableOf, InvoiceContentChecker } from './invoice-content.js';
import { InvoiceQueriesService } from './invoice-queries.service.js';
import { invoiceReference } from './invoice-rules.js';
import type {
  CreateCreditNoteDto,
  CreateDraftDto,
  DraftLineInputDto,
  InvoiceDraftDto,
  UpdateDraftDto,
} from './invoicing.dto.js';
import { InvoicingEvents } from './invoicing-events.js';
import { type InvoiceableRow, InvoicingRepository } from './invoicing.repository.js';

/** The line that heads the lines of a shipment: required on a deferred invoice (art. 21 c. 4). */
function shipmentHeading(shipment: InvoiceableRow): string {
  const reference = shipment.partyReference ? ` (${shipment.partyReference})` : '';
  return `DDT ${shipment.documentReference} ${fromDbDate(shipment.documentDate)} – ${shipment.orderReference}${reference}`;
}

/** The lines a shipment brings to a draft: its heading, then what was shipped. */
function shipmentLines(shipment: InvoiceableRow): DraftLineInputDto[] {
  return [
    { description: shipmentHeading(shipment) },
    ...shipment.lines.map((line) => ({
      fulfilmentId: shipment.fulfilmentId,
      orderLineId: line.orderLineId,
    })),
  ];
}

/**
 * Drafts of invoices and credit notes: created by hand, from shipments of one customer, or from
 * an issued invoice; saved whole at a version (B29); deleted. A shipment is in one draft at most:
 * its row is locked and marked, and released when the draft lets it go (B34: draft, then
 * shipments).
 */
@Injectable()
export class InvoiceDraftsService {
  constructor(
    private readonly repository: InvoicingRepository,
    private readonly checker: InvoiceContentChecker,
    private readonly queries: InvoiceQueriesService,
    private readonly registry: RegistryService,
    private readonly events: InvoicingEvents,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
  ) {}

  /** `created` is false when a draft with this id already exists (B33). */
  async create(dto: CreateDraftDto): Promise<{ draft: InvoiceDraftDto; created: boolean }> {
    const company = companyOf(this.contexts.require());
    try {
      return await this.db.run((tx) => this.createIn(tx, company, dto));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainException('DOCUMENT_ID_REUSED', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async createIn(
    tx: TenantTransaction,
    company: CompanyContext,
    dto: CreateDraftDto,
    today = businessToday(),
  ): Promise<{ draft: InvoiceDraftDto; created: boolean }> {
    const existing = await this.repository.findAnyDraft(tx, dto.id);
    if (existing) {
      if (existing.companyId !== company.companyId) {
        throw new DomainException('DOCUMENT_ID_REUSED', HttpStatus.CONFLICT);
      }
      return {
        draft: await this.queries.draft(tx, company.companyId, dto.id, today),
        created: false,
      };
    }
    if (await this.repository.findAnyInvoice(tx, dto.id)) {
      throw new DomainException('DOCUMENT_ID_REUSED', HttpStatus.CONFLICT);
    }

    const shipments = await this.takeShipments(tx, company, dto.fulfilmentIds ?? [], null);
    const partyId = this.partyOf(dto.partyId ?? null, shipments);
    const customer = partyId ? await this.registry.findBillingParty(tx, partyId) : null;
    const inputs = [...shipments.flatMap(shipmentLines), ...(dto.lines ?? [])];
    const content = await this.checker.check(
      tx,
      'INVOICE',
      {
        partyId,
        language: dto.language,
        notes: dto.notes,
        paymentTerms: dto.paymentTerms ?? customer?.paymentTerms ?? null,
        paymentMethod: dto.paymentMethod ?? customer?.paymentMethod ?? null,
      },
      inputs,
      { shipments: new Map(shipments.map((s) => [s.fulfilmentId, s])) },
    );
    await this.repository.createDraft(
      tx,
      {
        id: dto.id,
        tenantId: company.tenantId,
        companyId: company.companyId,
        kind: 'INVOICE',
        ...content.header,
        ...totalsOf(content),
        createdById: company.userId,
      },
      content.lines,
    );
    await this.repository.setDraftOf(tx, content.fulfilmentIds, dto.id);
    await this.events.record(
      tx,
      company,
      'INVOICE_DRAFT_CREATED',
      { type: 'invoice_draft', id: dto.id },
      { shipments: shipments.map((s) => s.documentReference) },
    );
    return { draft: await this.queries.draft(tx, company.companyId, dto.id, today), created: true };
  }

  update(id: string, dto: UpdateDraftDto): Promise<InvoiceDraftDto> {
    const company = companyOf(this.contexts.require());
    return this.db.run((tx) => this.updateIn(tx, company, id, dto));
  }

  async updateIn(
    tx: TenantTransaction,
    company: CompanyContext,
    id: string,
    dto: UpdateDraftDto,
    today = businessToday(),
  ): Promise<InvoiceDraftDto> {
    const draft = await this.repository.lockDraft(tx, company.companyId, id);
    if (!draft) throw new DomainException('DRAFT_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (draft.version !== dto.version) throw editConflict();

    const held = (await this.repository.invoiceablesOfDraft(tx, id)).map((s) => s.fulfilmentId);
    const wanted = dto.lines.flatMap((line) => (line.fulfilmentId ? [line.fulfilmentId] : []));
    const shipments = await this.takeShipments(tx, company, [...held, ...wanted], id);
    const partyId = this.partyOf(
      dto.partyId === undefined ? draft.partyId : dto.partyId,
      shipments.filter((s) => wanted.includes(s.fulfilmentId)),
    );
    const header = {
      partyId,
      language: dto.language,
      paymentTerms: dto.paymentTerms,
      paymentMethod: dto.paymentMethod,
      notes: dto.notes,
    };
    const content = await this.checker.check(tx, draft.kind, header, dto.lines, {
      shipments: new Map(shipments.map((s) => [s.fulfilmentId, s])),
      credit: await this.creditContext(tx, company, draft.creditedInvoiceId),
    });
    const saved = await this.repository.replaceDraft(
      tx,
      draft,
      dto.version,
      { ...content.header, ...totalsOf(content) },
      content.lines,
    );
    if (!saved) throw editConflict();
    const kept = new Set(content.fulfilmentIds);
    await this.repository.setDraftOf(
      tx,
      held.filter((fulfilmentId) => !kept.has(fulfilmentId)),
      null,
    );
    await this.repository.setDraftOf(tx, content.fulfilmentIds, id);
    await this.events.record(
      tx,
      company,
      'INVOICE_DRAFT_UPDATED',
      { type: 'invoice_draft', id },
      { lines: content.lines.length },
    );
    return this.queries.draft(tx, company.companyId, id, today);
  }

  remove(id: string, version: number): Promise<void> {
    const company = companyOf(this.contexts.require());
    return this.db.run((tx) => this.removeIn(tx, company, id, version));
  }

  async removeIn(tx: TenantTransaction, company: CompanyContext, id: string, version: number) {
    const draft = await this.repository.lockDraft(tx, company.companyId, id);
    if (!draft) throw new DomainException('DRAFT_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (draft.version !== version) throw editConflict();
    await this.repository.deleteDraft(tx, id);
    await this.events.record(
      tx,
      company,
      'INVOICE_DRAFT_DELETED',
      { type: 'invoice_draft', id },
      {},
    );
  }

  /** A draft credit note for an issued invoice: what is left of the chosen lines, or of all. */
  creditNote(invoiceId: string, dto: CreateCreditNoteDto) {
    const company = companyOf(this.contexts.require());
    return this.db.run((tx) => this.creditNoteIn(tx, company, invoiceId, dto));
  }

  async creditNoteIn(
    tx: TenantTransaction,
    company: CompanyContext,
    invoiceId: string,
    dto: CreateCreditNoteDto,
    today = businessToday(),
  ): Promise<{ draft: InvoiceDraftDto; created: boolean }> {
    const existing = await this.repository.findAnyDraft(tx, dto.id);
    if (existing?.companyId === company.companyId && existing.creditedInvoiceId === invoiceId) {
      return {
        draft: await this.queries.draft(tx, company.companyId, dto.id, today),
        created: false,
      };
    }
    if (existing || (await this.repository.findAnyInvoice(tx, dto.id))) {
      throw new DomainException('DOCUMENT_ID_REUSED', HttpStatus.CONFLICT);
    }
    const credit = await this.creditContext(tx, company, invoiceId);
    const { invoice, creditable } = credit!;
    if (invoice.kind !== 'INVOICE') {
      throw new DomainException('NOT_AN_INVOICE', HttpStatus.CONFLICT);
    }
    if (!creditable.total.greaterThan(Money.ZERO)) {
      throw new DomainException('NOTHING_TO_CREDIT', HttpStatus.CONFLICT);
    }
    const chosen = dto.lineIds ? new Set(dto.lineIds) : null;
    const errors = new FieldErrors();
    for (const [index, lineId] of (dto.lineIds ?? []).entries()) {
      if (!creditable.lines.has(lineId)) errors.add(`lineIds[${index}]`, 'CREDITED_LINE_NOT_FOUND');
    }
    errors.throwIfAny();
    const inputs: DraftLineInputDto[] = invoice.lines.flatMap((line) => {
      const left = creditable.lines.get(line.id);
      if (!left || (chosen && !chosen.has(line.id)) || !left.amount.greaterThan(Money.ZERO)) {
        return [];
      }
      return [
        {
          creditedLineId: line.id,
          quantity: (left.quantity ?? line.quantity)!.toString(),
        },
      ];
    });
    if (inputs.length === 0) throw new DomainException('NOTHING_TO_CREDIT', HttpStatus.CONFLICT);

    const content = await this.checker.check(
      tx,
      'CREDIT_NOTE',
      {
        partyId: invoice.partyId,
        language: invoice.language,
        paymentTerms: 'RD',
        paymentMethod: invoice.paymentMethod,
      },
      [
        {
          description:
            invoice.language === 'en'
              ? `Credit note for invoice ${invoice.number}/${invoice.year} of ${fromDbDate(invoice.issueDate)}`
              : `A storno della fattura n. ${invoice.number}/${invoice.year} del ${fromDbDate(invoice.issueDate)}`,
        },
        ...inputs,
      ],
      { shipments: new Map(), credit },
    );
    await this.repository.createDraft(
      tx,
      {
        id: dto.id,
        tenantId: company.tenantId,
        companyId: company.companyId,
        kind: 'CREDIT_NOTE',
        creditedInvoiceId: invoice.id,
        ...content.header,
        ...totalsOf(content),
        createdById: company.userId,
      },
      content.lines,
    );
    await this.events.record(
      tx,
      company,
      'INVOICE_DRAFT_CREATED',
      { type: 'invoice_draft', id: dto.id },
      { credits: invoiceReference(invoice) },
    );
    return { draft: await this.queries.draft(tx, company.companyId, dto.id, today), created: true };
  }

  /** The invoice a credit note corrects, with what is left to credit of it. */
  async creditContext(tx: TenantTransaction, company: CompanyContext, invoiceId: string | null) {
    if (!invoiceId) return undefined;
    const invoice = await this.repository.findInvoice(tx, company.companyId, invoiceId);
    if (!invoice) throw new DomainException('INVOICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const notes = await this.repository.creditNotesOf(tx, invoice.id);
    return { invoice, creditable: creditableOf(invoice, notes) };
  }

  /**
   * Locks the shipments a draft wants (B34: after the draft) and checks each is free, or already
   * this draft's. Field errors on `fulfilmentIds` when creating, on the lines when saving.
   */
  private async takeShipments(
    tx: TenantTransaction,
    company: CompanyContext,
    fulfilmentIds: readonly string[],
    draftId: string | null,
  ): Promise<InvoiceableRow[]> {
    const shipments = await this.repository.lockInvoiceables(tx, company.companyId, fulfilmentIds);
    const byId = new Map(shipments.map((s) => [s.fulfilmentId, s]));
    for (const fulfilmentId of new Set(fulfilmentIds)) {
      const shipment = byId.get(fulfilmentId);
      if (!shipment) {
        throw new DomainException('FULFILMENT_NOT_FOUND', HttpStatus.NOT_FOUND, {
          detail: fulfilmentId,
        });
      }
      if (shipment.invoiceId) {
        throw new DomainException('FULFILMENT_INVOICED', HttpStatus.CONFLICT, {
          detail: shipment.documentReference,
        });
      }
      if (shipment.draftId && shipment.draftId !== draftId) {
        throw new DomainException('FULFILMENT_ALREADY_DRAFTED', HttpStatus.CONFLICT, {
          detail: shipment.documentReference,
        });
      }
    }
    return shipments;
  }

  /** The customer of a draft: the one given, or that of its shipments, all the same one. */
  private partyOf(partyId: string | null, shipments: readonly InvoiceableRow[]): string | null {
    const parties = new Set(shipments.map((s) => s.partyId));
    if (partyId) parties.add(partyId);
    if (parties.size > 1) throw new DomainException('MIXED_CUSTOMERS', HttpStatus.BAD_REQUEST);
    return [...parties][0] ?? null;
  }
}

export function totalsOf(content: CheckedContent) {
  return {
    taxableTotal: content.summary.taxableTotal.toDecimal(),
    vatTotal: content.summary.vatTotal.toDecimal(),
    total: content.summary.total.toDecimal(),
  };
}
