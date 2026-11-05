import { Injectable } from '@nestjs/common';
import type { CompanyContext, TenantTransaction } from '../../prisma/index.js';
import { InvoiceDraftsService } from './invoice-drafts.service.js';
import { InvoiceIssueService } from './invoice-issue.service.js';
import type {
  CreateCreditNoteDto,
  CreateDraftDto,
  InvoiceDraftDto,
  InvoiceDto,
  UpdateDraftDto,
} from './invoicing.dto.js';
import { InvoicingRepository } from './invoicing.repository.js';

/**
 * Public service of the invoicing module (B3) for code outside a request: the demo seed. Every
 * action goes through the same use case as the API, so the seed obeys the same rules, locks and
 * numbering. `today` lets a seed date what it records.
 */
@Injectable()
export class InvoicingService {
  constructor(
    private readonly drafts: InvoiceDraftsService,
    private readonly issuing: InvoiceIssueService,
    private readonly repository: InvoicingRepository,
  ) {}

  async createDraft(
    tx: TenantTransaction,
    company: CompanyContext,
    dto: CreateDraftDto,
    today?: string,
  ): Promise<InvoiceDraftDto> {
    return (await this.drafts.createIn(tx, company, dto, today)).draft;
  }

  updateDraft(
    tx: TenantTransaction,
    company: CompanyContext,
    id: string,
    dto: UpdateDraftDto,
    today?: string,
  ): Promise<InvoiceDraftDto> {
    return this.drafts.updateIn(tx, company, id, dto, today);
  }

  async creditNote(
    tx: TenantTransaction,
    company: CompanyContext,
    invoiceId: string,
    dto: CreateCreditNoteDto,
    today?: string,
  ): Promise<InvoiceDraftDto> {
    return (await this.drafts.creditNoteIn(tx, company, invoiceId, dto, today)).draft;
  }

  async issue(
    tx: TenantTransaction,
    company: CompanyContext,
    id: string,
    version: number,
    issueDate: string,
  ): Promise<InvoiceDto> {
    return (await this.issuing.issueIn(tx, company, id, { version, issueDate }, issueDate)).invoice;
  }

  /** Shipments of a company still to invoice, oldest first (ids, customer, date). */
  async toInvoice(tx: TenantTransaction, companyId: string) {
    const { rows } = await this.repository.listToInvoice(tx, { companyId, skip: 0, take: 1000 });
    return rows.map((row) => ({
      fulfilmentId: row.fulfilmentId,
      partyId: row.partyId,
      documentDate: row.documentDate,
      draftId: row.draftId,
    }));
  }

  async hasInvoices(tx: TenantTransaction, companyId: string): Promise<boolean> {
    return (await tx.invoice.count({ where: { companyId } })) > 0;
  }
}
