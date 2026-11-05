import { PdfDocument } from '../../../shared/pdf/index.js';
import { PAYMENT_TERMS } from '../../registry/index.js';
import type { DocumentLineDto, VatRowDto } from '../invoicing.dto.js';
import { type Labels, labelsFor } from './labels.js';

/** A seller or a customer as the document prints it (the copies saved when it was issued). */
export interface PrintedParty {
  name?: string;
  legalName?: string;
  vatNumber?: string | null;
  taxCode?: string | null;
  country?: string;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  sdiCode?: string | null;
  pecEmail?: string | null;
  reaOffice?: string | null;
  reaNumber?: string | null;
  shareCapital?: string | null;
  soleShareholder?: boolean | null;
  inLiquidation?: boolean;
  taxRegime?: string;
  email?: string | null;
  phone?: string | null;
}

/** Everything a printed invoice or credit note shows, issued or still a draft. */
export interface PrintableInvoice {
  kind: 'INVOICE' | 'CREDIT_NOTE';
  /** "12/2026", or null for a draft. */
  number: string | null;
  issueDate: string | null;
  language: string;
  seller: PrintedParty;
  customer: PrintedParty;
  credited: { number: string; issueDate: string } | null;
  lines: DocumentLineDto[];
  vatSummary: VatRowDto[];
  taxableTotal: string;
  vatTotal: string;
  stampDuty: string;
  total: string;
  dueDates: { dueDate: string; amount: string }[];
  paymentTerms: string;
  paymentMethod: string;
  iban: string | null;
  notes: string | null;
}

/** Numbers and dates in the document's language: "1.234,50 €", "05/11/2026". */
function formats(labels: Labels) {
  const amount = new Intl.NumberFormat(labels.locale, {
    style: 'currency',
    currency: 'EUR',
  });
  const plain = (digits: number) =>
    new Intl.NumberFormat(labels.locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    });
  // Day, month, year in both languages: 05/11/2026.
  const date = (value: string) => value.split('-').reverse().join('/');
  return {
    money: (value: string) => amount.format(Number(value)),
    quantity: (value: string) => plain(3).format(Number(value)),
    price: (value: string) =>
      new Intl.NumberFormat(labels.locale, {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }).format(Number(value)),
    percent: (value: string) => `${plain(2).format(Number(value))}%`,
    date,
  };
}

function termsLabel(labels: Labels, code: string): string {
  const terms = PAYMENT_TERMS.find((t) => t.code === code);
  if (!terms || terms.instalments.every((i) => i.days === 0)) return labels.terms_.immediate;
  const days = terms.instalments.map((i) => i.days).join('-');
  return terms.instalments[0]!.endOfMonth
    ? labels.terms_.endOfMonth(days)
    : labels.terms_.days(days);
}

function partyLines(labels: Labels, party: PrintedParty, seller: boolean): (string | null)[] {
  const place = [party.postalCode, party.city, party.province ? `(${party.province})` : null]
    .filter(Boolean)
    .join(' ');
  return [
    party.address ?? null,
    [place, party.country && party.country !== 'IT' ? party.country : null]
      .filter(Boolean)
      .join(' – ') || null,
    party.vatNumber
      ? `${labels.vatNumber} ${party.country === 'IT' ? 'IT' : ''}${party.vatNumber}`
      : null,
    party.taxCode && party.taxCode !== party.vatNumber
      ? `${labels.taxCode} ${party.taxCode}`
      : null,
    seller && party.reaOffice ? `${labels.rea} ${party.reaOffice}-${party.reaNumber}` : null,
    seller && party.shareCapital
      ? `${labels.shareCapital} ${new Intl.NumberFormat(labels.locale, { style: 'currency', currency: 'EUR' }).format(Number(party.shareCapital))}`
      : null,
    seller && party.soleShareholder !== null && party.soleShareholder !== undefined
      ? party.soleShareholder
        ? labels.soleShareholder
        : labels.severalShareholders
      : null,
    seller && party.inLiquidation ? labels.inLiquidation : null,
    seller && party.taxRegime
      ? `${labels.taxRegime} ${party.taxRegime}${labels.regimes[party.taxRegime] ? ` – ${labels.regimes[party.taxRegime]}` : ''}`
      : null,
    !seller && party.sdiCode ? `${labels.sdiCode} ${party.sdiCode}` : null,
    party.pecEmail ? `${labels.pec} ${party.pecEmail}` : null,
  ];
}

/**
 * Lays out an invoice or a credit note (docs/adr/0031): what art. 21 DPR 633/72 asks the document
 * to show, from the data saved when it was issued, so the same document always prints the same.
 */
export function renderInvoice(doc: PrintableInvoice): Promise<Buffer> {
  const labels = labelsFor(doc.language);
  const f = formats(labels);
  const title = doc.kind === 'INVOICE' ? labels.invoice : labels.creditNote;
  const pdf = new PdfDocument({
    title: doc.number ? `${title} ${doc.number}` : `${title} – ${labels.draft}`,
    footer: (n, of) =>
      [
        doc.seller.legalName,
        doc.number ? `${title} ${doc.number}` : labels.draftNotice,
        labels.page(n, of),
      ]
        .filter(Boolean)
        .join(' · '),
    watermark: doc.number ? undefined : labels.draft,
  });

  pdf.heading(
    doc.number ? `${title} n. ${doc.number}` : title,
    doc.issueDate ? `${labels.date} ${f.date(doc.issueDate)}` : labels.draftNotice,
  );
  pdf.blocks(
    {
      title: labels.seller,
      lines: [doc.seller.legalName ?? null, ...partyLines(labels, doc.seller, true)],
    },
    {
      title: labels.customer,
      lines: [doc.customer.name ?? null, ...partyLines(labels, doc.customer, false)],
    },
  );
  if (doc.credited) {
    pdf.paragraph(labels.credits(doc.credited.number, f.date(doc.credited.issueDate)));
  }

  pdf.table(
    [
      { label: labels.columns.code, width: 1.2, value: (l) => l.itemCode ?? '' },
      { label: labels.columns.description, width: 4, value: (l) => l.description },
      {
        label: labels.columns.quantity,
        width: 1,
        align: 'right',
        value: (l) => (l.quantity ? `${f.quantity(l.quantity)}${l.unit ? ` ${l.unit}` : ''}` : ''),
      },
      {
        label: labels.columns.price,
        width: 1.2,
        align: 'right',
        value: (l) => (l.unitPrice ? f.price(l.unitPrice) : ''),
      },
      {
        label: labels.columns.discount,
        width: 0.8,
        align: 'right',
        value: (l) =>
          l.quantity && Number(l.discountPercent) > 0 ? f.percent(l.discountPercent) : '',
      },
      {
        label: labels.columns.vat,
        width: 0.8,
        align: 'right',
        value: (l) => (l.vatCode ? (l.vatNature ?? f.percent(l.vatRate ?? '0')) : ''),
      },
      {
        label: labels.columns.amount,
        width: 1.2,
        align: 'right',
        value: (l) => (l.lineAmount ? f.money(l.lineAmount) : ''),
      },
    ],
    doc.lines,
  );

  pdf.table(
    [
      {
        label: labels.vatColumns.rate,
        width: 4,
        value: (r: VatRowDto) =>
          r.nature ? `${r.nature} – ${labels.natures[r.nature] ?? ''}` : f.percent(r.rate),
      },
      {
        label: labels.vatColumns.taxable,
        width: 1.2,
        align: 'right',
        value: (r) => f.money(r.taxable),
      },
      { label: labels.vatColumns.vat, width: 1.2, align: 'right', value: (r) => f.money(r.vat) },
    ],
    doc.vatSummary,
  );
  pdf.totals([
    [labels.taxable, f.money(doc.taxableTotal)],
    [labels.vat, f.money(doc.vatTotal)],
    [labels.total, f.money(doc.total)],
  ]);
  if (Number(doc.stampDuty) > 0) {
    pdf.paragraph(`${labels.stampDuty}: ${f.money(doc.stampDuty)}`);
  }

  pdf.facts([
    [labels.terms, termsLabel(labels, doc.paymentTerms)],
    [labels.method, labels.methods[doc.paymentMethod] ?? doc.paymentMethod],
    [labels.iban, doc.paymentMethod === 'MP05' ? doc.iban : null],
  ]);
  if (doc.dueDates.length > 0) {
    pdf.table(
      [
        {
          label: labels.dueColumns.date,
          width: 1,
          value: (d: PrintableInvoice['dueDates'][number]) => f.date(d.dueDate),
        },
        {
          label: labels.dueColumns.amount,
          width: 1,
          align: 'right',
          value: (d) => f.money(d.amount),
        },
        { label: '', width: 3, value: () => '' },
      ],
      doc.dueDates,
    );
  }
  if (doc.notes) pdf.paragraph(`${labels.notes}: ${doc.notes}`);
  return pdf.toBuffer();
}
