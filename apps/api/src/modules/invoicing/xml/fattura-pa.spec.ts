import { fatturaPaErrors as errorsOf } from '../../../../test/support/fatturapa-schema.js';
import type { InvoiceDto } from '../invoicing.dto.js';
import { fatturaPa, latin1, sendingNumber } from './fattura-pa.js';

// FatturaPA files checked against the official schema (test/support/fatturapa-schema.ts).
const seller = {
  legalName: 'Rossi Srl',
  vatNumber: '02746510964',
  taxCode: null,
  country: 'IT',
  address: "Via dell'Industria 21",
  postalCode: '20141',
  city: 'Milano',
  province: 'MI',
  reaOffice: 'MI',
  reaNumber: '1987654',
  shareCapital: '50000.00',
  soleShareholder: false,
  inLiquidation: false,
  taxRegime: 'RF01',
  email: 'amministrazione@rossi.example.com',
  pecEmail: 'rossisrl@pec.example.com',
  phone: '02 1234567',
};
const company = {
  kind: 'COMPANY',
  name: 'Ferramenta Bruni Srl',
  firstName: null,
  lastName: null,
  vatNumber: '06123456786',
  taxCode: null,
  country: 'IT',
  address: 'Via Torino 12',
  postalCode: '20123',
  city: 'Milano',
  province: 'MI',
  sdiCode: 'M5UXCR1',
  pecEmail: null,
};

const line = (n: number, overrides: Partial<InvoiceDto['lines'][number]> = {}) => ({
  id: `l${n}`,
  lineNo: n,
  itemId: 'i1',
  itemCode: 'VT-M6-20',
  description: 'Vite a testa esagonale M6x20 zincata',
  unit: 'PZ',
  quantity: '500.000',
  unitPrice: '0.1200',
  discountPercent: '0.00',
  vatCode: '22',
  vatRate: '22.00',
  vatNature: null,
  lineAmount: '60.00',
  fulfilmentId: null,
  orderLineId: null,
  creditedLineId: null,
  stampDutyCharge: false,
  ...overrides,
});

function invoice(overrides: Partial<InvoiceDto> = {}): InvoiceDto {
  return {
    id: 'inv1',
    kind: 'INVOICE',
    reference: 'FT 12/2026',
    series: 'FT',
    year: 2026,
    number: 12,
    issueDate: '2026-10-31',
    partyId: 'p1',
    seller,
    customer: company,
    language: 'it',
    paymentTerms: '30FM',
    paymentMethod: 'MP05',
    iban: 'IT60X0542811101000000123456',
    notes: null,
    lines: [line(1)],
    vatSummary: [{ vatCode: '22', rate: '22.00', nature: null, taxable: '60.00', vat: '13.20' }],
    taxableTotal: '60.00',
    vatTotal: '13.20',
    stampDuty: '0.00',
    total: '73.20',
    dueDates: [
      {
        id: 'd1',
        seq: 1,
        dueDate: '2026-11-30',
        amount: '73.20',
        settledAmount: '0.00',
        openAmount: '73.20',
      },
    ],
    settledAmount: '0.00',
    openAmount: '73.20',
    paymentStatus: 'OPEN',
    overdue: false,
    creditedInvoice: null,
    creditNotes: [],
    creditable: [],
    creditableTotal: '73.20',
    shipments: [],
    issuedAt: '2026-10-31T11:00:00.000Z',
    ...overrides,
  } as InvoiceDto;
}

describe('FatturaPA', () => {
  it('numbers the files from the document: kind, year and number in base 36', () => {
    expect(sendingNumber('INVOICE', 2026, 12)).toBe('FA00C');
    expect(sendingNumber('CREDIT_NOTE', 2026, 1)).toBe('NA001');
    expect(sendingNumber('INVOICE', 2027, 46655)).toBe('FBZZZ');
    expect(sendingNumber('INVOICE', 2026, 46655)).not.toBe(
      sendingNumber('INVOICE', 2062, 46655 - 1),
    );
    expect(() => sendingNumber('INVOICE', 2026, 46656)).toThrow(RangeError);
    expect(fatturaPa(invoice()).fileName).toBe('IT02746510964_FA00C.xml');
  });

  it('keeps the text to the characters FatturaPA accepts', () => {
    expect(latin1('Calusco d’Adda – “centro” … 10 €', 100)).toBe(
      'Calusco d\'Adda - "centro" ... 10 EUR',
    );
    expect(latin1('Città\nalta 東', 100)).toBe('Città alta ?');
    expect(latin1('x'.repeat(300), 200)).toHaveLength(200);
  });

  it('makes the same file from the same document', () => {
    expect(fatturaPa(invoice()).xml).toBe(fatturaPa(invoice()).xml);
  });

  it('writes an immediate invoice the schema accepts', async () => {
    const { xml } = fatturaPa(invoice());
    expect(await errorsOf(xml)).toEqual([]);
    expect(xml).toContain('<CodiceDestinatario>M5UXCR1</CodiceDestinatario>');
    expect(xml).toContain('<CondizioniPagamento>TP02</CondizioniPagamento>');
    expect(xml).toContain('<IBAN>IT60X0542811101000000123456</IBAN>');
    expect(xml).toContain('<StatoLiquidazione>LN</StatoLiquidazione>');
  });

  it('writes a deferred invoice with its orders, delivery notes and instalments', async () => {
    const { xml } = fatturaPa(
      invoice({
        paymentTerms: '30-60FM',
        paymentMethod: 'MP12',
        lines: [
          line(1, {
            itemId: null,
            itemCode: null,
            description: 'DDT SC-2026/0031 del 12/10/2026 – OC-2026/0012 (ORD 311)',
            unit: null,
            quantity: null,
            unitPrice: null,
            vatCode: null,
            vatRate: null,
            lineAmount: null,
          }),
          line(2, { fulfilmentId: 'f1', discountPercent: '5.00', lineAmount: '57.00' }),
          line(3, {
            fulfilmentId: 'f2',
            itemCode: 'TS-8',
            quantity: '2.000',
            unitPrice: '4.9000',
            lineAmount: '9.80',
          }),
        ],
        shipments: [
          {
            fulfilmentId: 'f1',
            orderId: 'o1',
            orderReference: 'OC-2026/0012',
            partyReference: 'ORD 311',
            documentReference: 'SC-2026/0031',
            documentDate: '2026-10-12',
          },
          {
            fulfilmentId: 'f2',
            orderId: 'o2',
            orderReference: 'OC-2026/0015',
            partyReference: null,
            documentReference: 'SC-2026/0040',
            documentDate: '2026-10-20',
          },
        ],
        vatSummary: [
          { vatCode: '22', rate: '22.00', nature: null, taxable: '66.80', vat: '14.70' },
        ],
        taxableTotal: '66.80',
        vatTotal: '14.70',
        total: '81.50',
        dueDates: [
          {
            id: 'd1',
            seq: 1,
            dueDate: '2026-11-30',
            amount: '40.75',
            settledAmount: '0.00',
            openAmount: '40.75',
          },
          {
            id: 'd2',
            seq: 2,
            dueDate: '2026-12-31',
            amount: '40.75',
            settledAmount: '0.00',
            openAmount: '40.75',
          },
        ],
      }),
    );
    expect(await errorsOf(xml)).toEqual([]);
    expect(xml).toContain('<NumeroDDT>SC-2026/0031</NumeroDDT>');
    expect(xml).toContain('<IdDocumento>ORD 311</IdDocumento>');
    expect(xml).toContain('<IdDocumento>OC-2026/0015</IdDocumento>');
    expect(xml).toContain('<CondizioniPagamento>TP01</CondizioniPagamento>');
    expect(xml).toContain('<Percentuale>5.00</Percentuale>');
    expect(xml).not.toContain('<IBAN>'); // a bank receipt (RIBA), not a transfer
  });

  it('writes an exempt invoice with the stamp duty and its charge', async () => {
    const { xml } = fatturaPa(
      invoice({
        customer: {
          ...company,
          kind: 'ORGANIZATION',
          name: 'Associazione Sportiva Lario',
          vatNumber: null,
          taxCode: '93012345671',
          sdiCode: '0000000',
          pecEmail: 'aslario@pec.example.com',
        },
        lines: [
          line(1, {
            itemCode: 'CORSO-SIC',
            description: 'Corso di formazione sulla sicurezza',
            unit: 'H',
            quantity: '6.000',
            unitPrice: '50.0000',
            vatCode: 'N4',
            vatRate: '0.00',
            vatNature: 'N4',
            lineAmount: '300.00',
          }),
          line(2, {
            itemId: null,
            itemCode: null,
            description: 'Rivalsa imposta di bollo',
            unit: null,
            quantity: '1.000',
            unitPrice: '2.0000',
            vatCode: 'N1',
            vatRate: '0.00',
            vatNature: 'N1',
            lineAmount: '2.00',
            stampDutyCharge: true,
          }),
        ],
        vatSummary: [
          { vatCode: 'N1', rate: '0.00', nature: 'N1', taxable: '2.00', vat: '0.00' },
          { vatCode: 'N4', rate: '0.00', nature: 'N4', taxable: '300.00', vat: '0.00' },
        ],
        taxableTotal: '302.00',
        vatTotal: '0.00',
        stampDuty: '2.00',
        total: '302.00',
      }),
    );
    expect(await errorsOf(xml)).toEqual([]);
    expect(xml).toContain('<BolloVirtuale>SI</BolloVirtuale>');
    expect(xml).toContain('<CodiceFiscale>93012345671</CodiceFiscale>');
    expect(xml).toContain('<PECDestinatario>aslario@pec.example.com</PECDestinatario>');
    expect(xml).toContain('<RiferimentoNormativo>Esenti</RiferimentoNormativo>');
  });

  it('writes an invoice to a customer abroad and one to a private person', async () => {
    const abroad = fatturaPa(
      invoice({
        customer: {
          ...company,
          name: 'Baustoffe Müller GmbH',
          vatNumber: 'DE811234567',
          country: 'DE',
          address: 'Hauptstraße 5',
          postalCode: '80331',
          city: 'München',
          province: null,
          sdiCode: null,
        },
        lines: [
          line(1, { vatCode: 'N2.1', vatRate: '0.00', vatNature: 'N2.1', lineAmount: '60.00' }),
        ],
        vatSummary: [
          { vatCode: 'N2.1', rate: '0.00', nature: 'N2.1', taxable: '60.00', vat: '0.00' },
        ],
        notes: 'Operazione non soggetta, art. 7-ter DPR 633/72.',
        vatTotal: '0.00',
        total: '60.00',
      }),
    ).xml;
    expect(await errorsOf(abroad)).toEqual([]);
    expect(abroad).toContain('<CodiceDestinatario>XXXXXXX</CodiceDestinatario>');
    expect(abroad).toContain('<IdCodice>811234567</IdCodice>');
    expect(abroad).toContain('<CAP>00000</CAP>');
    expect(abroad).not.toContain('<Provincia>MI</Provincia>\n        <Nazione>DE');

    const person = fatturaPa(
      invoice({
        customer: {
          ...company,
          kind: 'PRIVATE',
          name: 'Giulia Ferri',
          firstName: 'Giulia',
          lastName: 'Ferri',
          vatNumber: null,
          taxCode: 'FRRGLI85C52C933W',
          sdiCode: '0000000',
        },
        paymentMethod: 'MP08',
      }),
    ).xml;
    expect(await errorsOf(person)).toEqual([]);
    expect(person).toContain('<Nome>Giulia</Nome>');
    expect(person).toContain('<CodiceDestinatario>0000000</CodiceDestinatario>');
  });

  it('writes a credit note with the invoice it corrects and no payment terms', async () => {
    const { xml, fileName } = fatturaPa(
      invoice({
        kind: 'CREDIT_NOTE',
        reference: 'NC 3/2026',
        series: 'NC',
        number: 3,
        creditedInvoice: {
          id: 'inv0',
          kind: 'INVOICE',
          reference: 'FT 12/2026',
          issueDate: '2026-10-31',
        } as InvoiceDto['creditedInvoice'],
        lines: [
          line(1, {
            itemId: null,
            itemCode: null,
            description: 'A storno della fattura n. 12/2026 del 31/10/2026',
            unit: null,
            quantity: null,
            unitPrice: null,
            vatCode: null,
            vatRate: null,
            lineAmount: null,
          }),
          line(2, { quantity: '100.000', lineAmount: '12.00', creditedLineId: 'l1' }),
        ],
        vatSummary: [{ vatCode: '22', rate: '22.00', nature: null, taxable: '12.00', vat: '2.64' }],
        total: '14.64',
        dueDates: [],
      }),
    );
    expect(await errorsOf(xml)).toEqual([]);
    expect(fileName).toBe('IT02746510964_NA003.xml');
    expect(xml).toContain('<TipoDocumento>TD04</TipoDocumento>');
    expect(xml).toContain('<IdDocumento>12/2026</IdDocumento>');
    expect(xml).not.toContain('DatiPagamento');
  });

  it('is refused by the schema when a field is wrong (the check is real)', async () => {
    const { xml } = fatturaPa(invoice());
    expect(
      await errorsOf(xml.replace('<Divisa>EUR</Divisa>', '<Divisa>EURO</Divisa>')),
    ).not.toEqual([]);
  });
});
