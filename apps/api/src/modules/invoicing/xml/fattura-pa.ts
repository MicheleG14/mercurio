import { el, optional, serializeXml, type XmlElement } from '../../../shared/xml.js';
import type { InvoiceDto } from '../invoicing.dto.js';
import { IT } from '../pdf/labels.js';

/**
 * An issued invoice or credit note as a FatturaPA file, format FPR12 (between businesses and
 * towards private people), schema 1.2.3 (docs/adr/0033). Made from the saved document, so the
 * same document always gives the same file; nothing is transmitted.
 *
 * The order of the elements is the schema's; tests validate every case against the official XSD.
 */

/** What the seller and the customer copies hold (see the issue use case). */
interface Seller {
  legalName: string;
  vatNumber: string;
  taxCode: string | null;
  country: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  reaOffice: string | null;
  reaNumber: string | null;
  shareCapital: string | null;
  soleShareholder: boolean | null;
  inLiquidation: boolean | null;
  taxRegime: string | null;
  email: string | null;
  phone: string | null;
}

interface Customer {
  kind: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  vatNumber: string | null;
  taxCode: string | null;
  country: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  sdiCode: string | null;
  pecEmail: string | null;
}

export interface FatturaPaFile {
  fileName: string;
  xml: string;
}

const NAMESPACE = 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2';

/**
 * The text of a field in the characters FatturaPA accepts (Latin-1): typographic quotes and
 * dashes become their plain forms, anything else outside Latin-1 a question mark. Trimmed to the
 * field's length.
 */
export function latin1(text: string, max: number): string {
  const plain = text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/€/g, 'EUR')
    .replace(/[   ]/g, ' ')
    // oxlint-disable-next-line no-control-regex -- line breaks are not allowed in these fields
    .replace(/[\u0000-\u001F]/g, ' ')
    .replace(/[^ -ÿ]/g, '?')
    .trim();
  return plain.slice(0, max);
}

/**
 * The sending number of the file, five characters, derived from the document instead of saved:
 * F (invoice) or N (credit note), the year in base 36, the number in base 36 on three characters
 * (up to 46,655 a year and series). Unique per company for 36 years.
 */
export function sendingNumber(kind: InvoiceDto['kind'], year: number, number: number): string {
  if (number < 1 || number > 36 ** 3 - 1) throw new RangeError(`number out of range: ${number}`);
  return (
    (kind === 'INVOICE' ? 'F' : 'N') +
    (year % 36).toString(36) +
    number.toString(36).padStart(3, '0')
  ).toUpperCase();
}

/** "IT02746510964" → "02746510964"; "DE811234567" → "811234567": the code without the country. */
function vatCode(vat: string, country: string): string {
  return vat.toUpperCase().startsWith(country.toUpperCase()) ? vat.slice(country.length) : vat;
}

/** "FT 12/2026" → "12/2026", as the document is numbered. */
const printed = (reference: string) => reference.split(' ').at(-1)!;

function sede(party: {
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  country: string;
}): XmlElement {
  const italian = party.country === 'IT';
  return el('Sede', [
    el('Indirizzo', latin1(party.address ?? '', 60)),
    // Abroad the postal code is not Italian: the specifications ask for 00000.
    el('CAP', italian && /^\d{5}$/.test(party.postalCode ?? '') ? party.postalCode! : '00000'),
    el('Comune', latin1(party.city ?? '', 60)),
    italian && party.province ? el('Provincia', party.province.toUpperCase()) : null,
    el('Nazione', party.country.toUpperCase()),
  ]);
}

function cedente(seller: Seller): XmlElement {
  const rea =
    seller.reaOffice && seller.reaNumber
      ? el('IscrizioneREA', [
          el('Ufficio', seller.reaOffice.toUpperCase()),
          el('NumeroREA', latin1(seller.reaNumber, 20)),
          optional(
            'CapitaleSociale',
            seller.shareCapital ? Number(seller.shareCapital).toFixed(2) : null,
          ),
          seller.soleShareholder === null
            ? null
            : el('SocioUnico', seller.soleShareholder ? 'SU' : 'SM'),
          el('StatoLiquidazione', seller.inLiquidation ? 'LS' : 'LN'),
        ])
      : null;
  const phone = seller.phone && /^[\x20-\x7E]{5,12}$/.test(seller.phone) ? seller.phone : null;
  const contacts =
    phone || seller.email
      ? el('Contatti', [optional('Telefono', phone), optional('Email', seller.email)])
      : null;
  return el('CedentePrestatore', [
    el('DatiAnagrafici', [
      el('IdFiscaleIVA', [
        el('IdPaese', seller.country.toUpperCase()),
        el('IdCodice', vatCode(seller.vatNumber, seller.country)),
      ]),
      optional('CodiceFiscale', seller.taxCode),
      el('Anagrafica', [el('Denominazione', latin1(seller.legalName, 80))]),
      el('RegimeFiscale', seller.taxRegime ?? 'RF01'),
    ]),
    sede(seller),
    rea,
    contacts,
  ]);
}

function cessionario(customer: Customer): XmlElement {
  const person = customer.kind === 'PRIVATE' && customer.firstName && customer.lastName;
  return el('CessionarioCommittente', [
    el('DatiAnagrafici', [
      customer.vatNumber
        ? el('IdFiscaleIVA', [
            el('IdPaese', customer.country.toUpperCase()),
            el('IdCodice', vatCode(customer.vatNumber, customer.country)),
          ])
        : null,
      customer.country === 'IT' ? optional('CodiceFiscale', customer.taxCode) : null,
      el(
        'Anagrafica',
        person
          ? [
              el('Nome', latin1(customer.firstName!, 60)),
              el('Cognome', latin1(customer.lastName!, 60)),
            ]
          : [el('Denominazione', latin1(customer.name, 80))],
      ),
    ]),
    sede(customer),
  ]);
}

/** Where the file goes: the customer's code, its PEC, or XXXXXXX abroad. */
function destination(customer: Customer): XmlElement[] {
  if (customer.country !== 'IT') return [el('CodiceDestinatario', 'XXXXXXX')];
  if (customer.sdiCode && customer.sdiCode !== '0000000') {
    return [el('CodiceDestinatario', customer.sdiCode.toUpperCase())];
  }
  const pec = customer.pecEmail ? [el('PECDestinatario', customer.pecEmail)] : [];
  return [el('CodiceDestinatario', '0000000'), ...pec];
}

/** The 200-character pieces of the notes: FatturaPA has one Causale per piece. */
function causali(notes: string | null): XmlElement[] {
  const text = notes ? latin1(notes, 4000) : '';
  const pieces: XmlElement[] = [];
  for (let i = 0; i < text.length; i += 200)
    pieces.push(el('Causale', text.slice(i, i + 200).trim() || '-'));
  return pieces;
}

function lines(invoice: InvoiceDto): XmlElement[] {
  // A line of text has no price: it travels at zero, with the VAT of the document's first line.
  const priced = invoice.lines.find((line) => line.vatRate !== null);
  return invoice.lines.map((line) => {
    const rate = line.vatRate ?? priced?.vatRate ?? '0.00';
    const nature = line.vatRate !== null ? line.vatNature : (priced?.vatNature ?? null);
    const discount = line.discountPercent !== '0.00' && line.unitPrice !== null;
    return el('DettaglioLinee', [
      el('NumeroLinea', String(line.lineNo)),
      line.itemCode
        ? el('CodiceArticolo', [
            el('CodiceTipo', 'INTERNO'),
            el('CodiceValore', latin1(line.itemCode, 35)),
          ])
        : null,
      el('Descrizione', latin1(line.description, 1000) || '-'),
      optional('Quantita', line.quantity),
      line.quantity ? optional('UnitaMisura', line.unit ? latin1(line.unit, 10) : null) : null,
      el('PrezzoUnitario', line.unitPrice ?? '0.00'),
      discount
        ? el('ScontoMaggiorazione', [el('Tipo', 'SC'), el('Percentuale', line.discountPercent)])
        : null,
      el('PrezzoTotale', line.lineAmount ?? '0.00'),
      el('AliquotaIVA', rate),
      optional('Natura', nature),
    ]);
  });
}

function summary(invoice: InvoiceDto): XmlElement[] {
  return invoice.vatSummary.map((row) =>
    el('DatiRiepilogo', [
      el('AliquotaIVA', row.rate),
      optional('Natura', row.nature),
      el('ImponibileImporto', row.taxable),
      el('Imposta', row.vat),
      // Exempt, excluded and not subject operations have no VAT to collect.
      row.nature ? null : el('EsigibilitaIVA', 'I'),
      row.nature
        ? el('RiferimentoNormativo', latin1(IT.natures[row.nature] ?? row.nature, 100))
        : null,
    ]),
  );
}

/** Orders and delivery notes of a deferred invoice, with the lines that come from each. */
function references(invoice: InvoiceDto): { orders: XmlElement[]; ddt: XmlElement[] } {
  const orders: XmlElement[] = [];
  const ddt: XmlElement[] = [];
  for (const shipment of invoice.shipments) {
    const numbers = invoice.lines
      .filter((line) => line.fulfilmentId === shipment.fulfilmentId)
      .map((line) => el('RiferimentoNumeroLinea', String(line.lineNo)));
    orders.push(
      el('DatiOrdineAcquisto', [
        ...numbers,
        el('IdDocumento', latin1(shipment.partyReference ?? shipment.orderReference, 20)),
      ]),
    );
    ddt.push(
      el('DatiDDT', [
        el('NumeroDDT', latin1(shipment.documentReference, 20)),
        el('DataDDT', shipment.documentDate),
        ...numbers,
      ]),
    );
  }
  return { orders, ddt };
}

function payments(invoice: InvoiceDto): XmlElement | null {
  // A credit note owes the customer at most a refund: it carries no payment terms.
  if (invoice.kind !== 'INVOICE' || invoice.dueDates.length === 0) return null;
  return el('DatiPagamento', [
    el('CondizioniPagamento', invoice.dueDates.length > 1 ? 'TP01' : 'TP02'),
    ...invoice.dueDates.map((due) =>
      el('DettaglioPagamento', [
        el('ModalitaPagamento', invoice.paymentMethod),
        el('DataScadenzaPagamento', due.dueDate),
        el('ImportoPagamento', due.amount),
        invoice.paymentMethod === 'MP05' ? optional('IBAN', invoice.iban) : null,
      ]),
    ),
  ]);
}

/** The file of an issued document: its name and its XML. */
export function fatturaPa(invoice: InvoiceDto): FatturaPaFile {
  const seller = invoice.seller as unknown as Seller;
  const customer = invoice.customer as unknown as Customer;
  const progressive = sendingNumber(invoice.kind, invoice.year, invoice.number);
  const { orders, ddt } = references(invoice);
  const stamp = invoice.stampDuty !== '0.00';
  const root = el(
    'p:FatturaElettronica',
    [
      el('FatturaElettronicaHeader', [
        el('DatiTrasmissione', [
          el('IdTrasmittente', [
            el('IdPaese', seller.country.toUpperCase()),
            el('IdCodice', vatCode(seller.vatNumber, seller.country)),
          ]),
          el('ProgressivoInvio', progressive),
          el('FormatoTrasmissione', 'FPR12'),
          ...destination(customer),
        ]),
        cedente(seller),
        cessionario(customer),
      ]),
      el('FatturaElettronicaBody', [
        el('DatiGenerali', [
          el('DatiGeneraliDocumento', [
            el('TipoDocumento', invoice.kind === 'INVOICE' ? 'TD01' : 'TD04'),
            el('Divisa', 'EUR'),
            el('Data', invoice.issueDate),
            el('Numero', `${invoice.number}/${invoice.year}`),
            stamp
              ? el('DatiBollo', [el('BolloVirtuale', 'SI'), el('ImportoBollo', invoice.stampDuty)])
              : null,
            el('ImportoTotaleDocumento', invoice.total),
            ...causali(invoice.notes),
          ]),
          ...orders,
          invoice.creditedInvoice
            ? el('DatiFattureCollegate', [
                el('IdDocumento', printed(invoice.creditedInvoice.reference)),
                el('Data', invoice.creditedInvoice.issueDate),
              ])
            : null,
          ...ddt,
        ]),
        el('DatiBeniServizi', [...lines(invoice), ...summary(invoice)]),
        payments(invoice),
      ]),
    ],
    {
      versione: 'FPR12',
      'xmlns:p': NAMESPACE,
      'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    },
  );
  return {
    fileName: `${seller.country.toUpperCase()}${vatCode(seller.vatNumber, seller.country)}_${progressive}.xml`,
    xml: serializeXml(root),
  };
}
