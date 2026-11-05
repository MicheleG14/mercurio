import { Injectable } from '@nestjs/common';
import { companyOf, TenantContextService, TenantDatabase } from '../../../prisma/index.js';
import { RegistryService } from '../../registry/index.js';
import { TenancyService } from '../../tenancy/index.js';
import { InvoiceQueriesService } from '../invoice-queries.service.js';
import type { InvoiceDto } from '../invoicing.dto.js';
import { renderInvoice } from './invoice-pdf.js';

/** "FT 12/2026" → "12/2026": what the document prints as its number. */
const printedNumber = (reference: string) => reference.split(' ').at(-1)!;

/** A printed document: its bytes and the name of the file. */
export interface PdfFile {
  fileName: string;
  bytes: Buffer;
}

/**
 * Invoices and credit notes on paper (docs/adr/0031): made on every request from the saved data
 * of the document, never stored. A draft prints with what it would copy now, and a watermark.
 */
@Injectable()
export class InvoicePdfService {
  constructor(
    private readonly queries: InvoiceQueriesService,
    private readonly registry: RegistryService,
    private readonly tenancy: TenancyService,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
  ) {}

  async invoice(id: string): Promise<PdfFile> {
    const invoice: InvoiceDto = await this.queries.getInvoice(id);
    const bytes = await renderInvoice({
      kind: invoice.kind,
      number: `${invoice.number}/${invoice.year}`,
      issueDate: invoice.issueDate,
      language: invoice.language,
      seller: invoice.seller,
      customer: invoice.customer,
      credited: invoice.creditedInvoice
        ? {
            number: printedNumber(invoice.creditedInvoice.reference),
            issueDate: invoice.creditedInvoice.issueDate,
          }
        : null,
      lines: invoice.lines,
      vatSummary: invoice.vatSummary,
      taxableTotal: invoice.taxableTotal,
      vatTotal: invoice.vatTotal,
      stampDuty: invoice.stampDuty,
      total: invoice.total,
      dueDates: invoice.dueDates,
      paymentTerms: invoice.paymentTerms,
      paymentMethod: invoice.paymentMethod,
      iban: invoice.iban,
      notes: invoice.notes,
    });
    return {
      fileName: `${invoice.series}-${invoice.year}-${String(invoice.number).padStart(4, '0')}.pdf`,
      bytes,
    };
  }

  async draft(id: string): Promise<PdfFile> {
    const { companyId } = companyOf(this.contexts.require());
    const { draft, seller, customer } = await this.db.run(async (tx) => {
      const draft = await this.queries.draft(tx, companyId, id);
      return {
        draft,
        seller: await this.tenancy.getCompany(tx, companyId),
        customer: draft.partyId ? await this.registry.findBillingParty(tx, draft.partyId) : null,
      };
    });
    const bytes = await renderInvoice({
      kind: draft.kind,
      number: null,
      issueDate: null,
      language: draft.language ?? customer?.documentLanguage ?? 'it',
      seller: { ...seller, shareCapital: seller.shareCapital?.toFixed(2) ?? null },
      customer: customer ?? {},
      credited: draft.creditedInvoice
        ? {
            number: printedNumber(draft.creditedInvoice.reference),
            issueDate: draft.creditedInvoice.issueDate,
          }
        : null,
      lines: draft.lines,
      vatSummary: draft.vatSummary,
      taxableTotal: draft.taxableTotal,
      vatTotal: draft.vatTotal,
      stampDuty: draft.stampDutyRequired ? '2.00' : '0.00',
      total: draft.total,
      dueDates: draft.dueDatesPreview,
      paymentTerms: draft.paymentTerms ?? customer?.paymentTerms ?? 'RD',
      paymentMethod: draft.paymentMethod ?? customer?.paymentMethod ?? 'MP05',
      iban: seller.iban,
      notes: draft.notes,
    });
    return { fileName: `bozza-${id.slice(0, 8)}.pdf`, bytes };
  }
}
