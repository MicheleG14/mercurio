import { HttpStatus, Injectable } from '@nestjs/common';
import { companyOf, TenantContextService, TenantDatabase } from '../../prisma/index.js';
import { DomainException } from '../../shared/errors/index.js';
import { PdfDocument } from '../../shared/pdf/index.js';
import { type BillingParty, RegistryService } from '../registry/index.js';
import { TenancyService } from '../tenancy/index.js';
import type { StockDocumentDto, StockLineDto } from './stock-documents.dto.js';
import { StockDocumentsService } from './stock-documents.service.js';

// The labels of the delivery note, in the language of the customer's documents (G2b, an exception
// to G2a as for invoices: docs/adr/0031). Both languages have the same type.
const IT = {
  locale: 'it-IT',
  title: 'Documento di trasporto',
  number: 'n.',
  date: 'del',
  sender: 'Mittente',
  recipient: 'Destinatario',
  vatNumber: 'P. IVA',
  order: 'Ordine',
  columns: { code: 'Codice', description: 'Descrizione', quantity: 'Quantità', unit: 'U.m.' },
  reason: 'Causale del trasporto',
  by: 'Trasporto a cura del',
  byValues: { SENDER: 'Mittente', RECIPIENT: 'Destinatario', CARRIER: 'Vettore' } as Record<
    string,
    string
  >,
  carrier: 'Vettore',
  packages: 'Colli',
  appearance: 'Aspetto dei beni',
  weight: 'Peso (kg)',
  signatures:
    'Firma del conducente ______________________     Firma del destinatario ______________________',
  page: (n: number, of: number) => `Pagina ${n} di ${of}`,
  defaultReason: 'Vendita',
};
type Labels = typeof IT;
const EN: Labels = {
  locale: 'en-GB',
  title: 'Delivery note',
  number: 'no.',
  date: 'of',
  sender: 'Sender',
  recipient: 'Recipient',
  vatNumber: 'VAT no.',
  order: 'Order',
  columns: { code: 'Code', description: 'Description', quantity: 'Quantity', unit: 'Unit' },
  reason: 'Reason for transport',
  by: 'Transport by',
  byValues: { SENDER: 'Sender', RECIPIENT: 'Recipient', CARRIER: 'Carrier' },
  carrier: 'Carrier',
  packages: 'Packages',
  appearance: 'Appearance of goods',
  weight: 'Weight (kg)',
  signatures:
    "Driver's signature ______________________     Recipient's signature ______________________",
  page: (n: number, of: number) => `Page ${n} of ${of}`,
  defaultReason: 'Sale',
};

const date = (value: string) => value.split('-').reverse().join('/');

/**
 * The delivery note (DDT) of a sale (DPR 472/96): the stock document that moved the goods, with
 * sender, recipient, what left and how it travels. Its number is the document's (SC-2026/0031).
 * Made on every request from the saved document, never stored.
 */
@Injectable()
export class DeliveryNoteService {
  constructor(
    private readonly documents: StockDocumentsService,
    private readonly registry: RegistryService,
    private readonly tenancy: TenancyService,
    private readonly db: TenantDatabase,
    private readonly contexts: TenantContextService,
  ) {}

  async print(id: string): Promise<{ fileName: string; bytes: Buffer }> {
    const { companyId } = companyOf(this.contexts.require());
    const document = await this.documents.get(id);
    if (document.reason !== 'SALE_ISSUE' || !document.partyId) {
      throw new DomainException('NOT_A_SALE', HttpStatus.CONFLICT);
    }
    const { seller, recipient } = await this.db.run(async (tx) => ({
      seller: await this.tenancy.getCompany(tx, companyId),
      recipient: (await this.registry.findBillingParty(tx, document.partyId!))!,
    }));
    const bytes = await render(document, seller, recipient);
    return { fileName: `${document.reference.replace('/', '-')}.pdf`, bytes };
  }
}

function place(party: {
  postalCode: string | null;
  city: string | null;
  province: string | null;
}): string | null {
  return (
    [party.postalCode, party.city, party.province ? `(${party.province})` : null]
      .filter(Boolean)
      .join(' ') || null
  );
}

function render(
  document: StockDocumentDto,
  seller: Awaited<ReturnType<TenancyService['getCompany']>>,
  recipient: BillingParty,
): Promise<Buffer> {
  const labels = recipient.documentLanguage === 'en' ? EN : IT;
  const quantity = new Intl.NumberFormat(labels.locale, { maximumFractionDigits: 3 });
  const pdf = new PdfDocument({
    title: `${labels.title} ${document.reference}`,
    footer: (n, of) => `${seller.legalName} · ${document.reference} · ${labels.page(n, of)}`,
  });
  pdf.heading(
    `${labels.title} ${labels.number} ${document.reference}`,
    `${labels.date} ${date(document.documentDate)}`,
  );
  pdf.blocks(
    {
      title: labels.sender,
      lines: [
        seller.legalName,
        seller.address,
        place(seller),
        `${labels.vatNumber} ${seller.country === 'IT' ? 'IT' : ''}${seller.vatNumber}`,
      ],
    },
    {
      title: labels.recipient,
      lines: [
        recipient.name,
        recipient.address,
        place(recipient),
        recipient.vatNumber ? `${labels.vatNumber} ${recipient.vatNumber}` : null,
      ],
    },
  );
  if (document.origin) pdf.facts([[labels.order, document.origin.reference]]);
  pdf.table<StockLineDto>(
    [
      { label: labels.columns.code, width: 1.4, value: (l) => l.itemCode },
      { label: labels.columns.description, width: 5, value: (l) => l.itemDescription },
      {
        label: labels.columns.quantity,
        width: 1.2,
        align: 'right',
        value: (l) => quantity.format(Number(l.quantity)),
      },
      { label: labels.columns.unit, width: 0.8, value: (l) => l.unit },
    ],
    document.lines,
  );
  const transport = document.transport;
  pdf.facts([
    [labels.reason, transport?.reason ?? labels.defaultReason],
    [labels.by, transport?.by ? labels.byValues[transport.by] : null],
    [labels.carrier, transport?.carrier],
    [labels.packages, transport?.packages ? String(transport.packages) : null],
    [labels.appearance, transport?.appearance],
    [labels.weight, transport?.weightKg ? quantity.format(Number(transport.weightKg)) : null],
  ]);
  if (document.notes) pdf.paragraph(document.notes);
  pdf.paragraph(labels.signatures, true);
  return pdf.toBuffer();
}
