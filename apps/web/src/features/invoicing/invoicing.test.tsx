import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { json, me, mockApi, problem, session } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';
import type { DocumentLine, Invoice, InvoiceDraft, InvoiceSummary, ScheduleRow } from './queries';

// Component tests of the invoicing screens, against a fake API. Figures are the API's strings.
// Ids the browser chooses (B33) are fixed here, so the fake API knows the new draft as d1.
vi.mock('@/lib/uuid', () => ({ uuidv7: () => 'd1' }));

const ALL = [
  'parties:read',
  'items:read',
  'stock:read',
  'orders:read',
  'invoicing:read',
  'invoicing:write',
  'invoicing:issue',
  'payments:write',
];

const signedIn = (
  permissions = ALL,
  modules = ['registry', 'warehouse', 'orders', 'invoicing'],
) => ({
  'POST /auth/refresh': () => json(200, session('t-rossi')),
  'GET /auth/me': () => json(200, me({ permissions, modules })),
  'GET /registry/reference-data': () =>
    json(200, {
      vatCodes: [
        { code: '22', rate: '22.00', nature: null },
        { code: 'N4', rate: '0.00', nature: 'N4' },
        { code: 'N1', rate: '0.00', nature: 'N1' },
      ],
      units: [{ code: 'PZ', decimals: 0 }],
      legalForms: [],
      paymentTerms: [
        { code: 'RD', instalments: [{ days: 0, endOfMonth: false }] },
        { code: '30FM', instalments: [{ days: 30, endOfMonth: true }] },
      ],
      paymentMethods: ['MP01', 'MP05'],
      taxRegimes: ['RF01'],
      documentLanguages: ['it', 'en'],
    }),
  'GET /companies/current': () =>
    json(200, {
      id: 'c1',
      legalName: 'Rossi Srl',
      vatNumber: '02746510960',
      taxCode: null,
      country: 'IT',
      address: 'Via Roma 1',
      postalCode: '20121',
      city: 'Milano',
      province: 'MI',
      reaOffice: null,
      reaNumber: null,
      shareCapital: null,
      soleShareholder: null,
      inLiquidation: false,
      taxRegime: 'RF01',
      iban: 'IT60X0542811101000000123456',
      email: null,
      pecEmail: null,
      phone: null,
      chargeStampDuty: true,
      missingForInvoices: [],
      version: 2,
    }),
});

const line = (overrides: Partial<DocumentLine> = {}): DocumentLine => ({
  id: 'l1',
  lineNo: 1,
  itemId: 'i1',
  itemCode: 'VT-M6-20',
  description: 'Vite M6x20',
  unit: 'PZ',
  quantity: '500.000',
  unitPrice: '0.1200',
  discountPercent: '0.00',
  vatCode: '22',
  vatRate: '22.00',
  vatNature: null,
  lineAmount: '60.00',
  fulfilmentId: 'f1',
  orderLineId: 'ol1',
  creditedLineId: null,
  stampDutyCharge: false,
  ...overrides,
});

const draft = (overrides: Partial<InvoiceDraft> = {}): InvoiceDraft => ({
  id: 'd1',
  kind: 'INVOICE',
  partyId: 'p1',
  partyName: 'Ferramenta Bruni Srl',
  creditedInvoice: null,
  language: null,
  paymentTerms: '30FM',
  paymentMethod: 'MP05',
  notes: null,
  lines: [
    line({
      id: 'h1',
      itemId: null,
      itemCode: null,
      description: 'DDT SC-2026/0003 2026-10-15 – OC-2026/0001',
      unit: null,
      quantity: null,
      unitPrice: null,
      vatCode: null,
      vatRate: null,
      lineAmount: null,
      fulfilmentId: null,
      orderLineId: null,
    }),
    line({ lineNo: 2 }),
  ],
  vatSummary: [{ vatCode: '22', rate: '22.00', nature: null, taxable: '60.00', vat: '13.20' }],
  taxableTotal: '60.00',
  vatTotal: '13.20',
  total: '73.20',
  stampDutyRequired: false,
  dueDatesPreview: [{ seq: 1, dueDate: '2026-12-31', amount: '73.20' }],
  shipments: [
    {
      fulfilmentId: 'f1',
      orderId: 'o1',
      orderReference: 'OC-2026/0001',
      partyReference: null,
      documentReference: 'SC-2026/0003',
      documentDate: '2026-10-15',
    },
  ],
  deferredDeadline: '2026-11-15',
  version: 1,
  createdAt: '2026-11-05T08:00:00.000Z',
  updatedAt: '2026-11-05T08:00:00.000Z',
  ...overrides,
});

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 'd1',
  kind: 'INVOICE',
  reference: 'FT 7/2026',
  series: 'FT',
  year: 2026,
  number: 7,
  issueDate: '2026-11-05',
  partyId: 'p1',
  seller: { legalName: 'Rossi Srl', address: 'Via Roma 1', city: 'Milano' },
  customer: { name: 'Ferramenta Bruni Srl', address: 'Via Torino 12', city: 'Milano' },
  language: 'it',
  paymentTerms: '30FM',
  paymentMethod: 'MP05',
  iban: 'IT60X0542811101000000123456',
  notes: null,
  lines: [
    line(),
    line({
      id: 'l2',
      lineNo: 2,
      itemCode: 'TS-8',
      description: 'Tasselli',
      quantity: '10.000',
      unitPrice: '4.9000',
      lineAmount: '49.00',
    }),
  ],
  vatSummary: [{ vatCode: '22', rate: '22.00', nature: null, taxable: '109.00', vat: '23.98' }],
  taxableTotal: '109.00',
  vatTotal: '23.98',
  stampDuty: '0.00',
  total: '132.98',
  dueDates: [
    {
      id: 'dd1',
      seq: 1,
      dueDate: '2026-12-31',
      amount: '132.98',
      settledAmount: '0.00',
      openAmount: '132.98',
    },
  ],
  settledAmount: '0.00',
  openAmount: '132.98',
  paymentStatus: 'UNPAID',
  overdue: false,
  creditedInvoice: null,
  creditNotes: [],
  creditable: [
    { lineId: 'l1', quantity: '500.000', amount: '60.00' },
    { lineId: 'l2', quantity: '10.000', amount: '49.00' },
  ],
  creditableTotal: '132.98',
  shipments: draft().shipments,
  issuedAt: '2026-11-05T09:00:00.000Z',
  ...overrides,
});

const summary = (overrides: Partial<InvoiceSummary> = {}): InvoiceSummary => ({
  id: 'i1',
  kind: 'INVOICE',
  reference: 'FT 1/2026',
  issueDate: '2026-10-02',
  partyId: 'p1',
  partyName: 'Ferramenta Bruni Srl',
  total: '85.40',
  openAmount: '85.40',
  paymentStatus: 'UNPAID',
  overdue: true,
  nextDueDate: '2026-10-02',
  ...overrides,
});

const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 25 });

const bodies = (api: ReturnType<typeof mockApi>, key: string) =>
  Promise.all(
    api.calls.filter((c) => `${c.method} ${c.path}` === key).map((c) => c.request.json()),
  );

describe('invoicing', () => {
  it('lists drafts and issued documents with what is paid, in words', async () => {
    mockApi({
      ...signedIn(),
      'GET /invoice-drafts': () =>
        json(
          200,
          page([
            {
              id: 'd1',
              kind: 'INVOICE',
              partyName: null,
              total: '0.00',
              version: 1,
              updatedAt: '2026-11-05T08:00:00.000Z',
            },
          ]),
        ),
      'GET /invoices': () =>
        json(
          200,
          page([
            summary(),
            summary({
              id: 'i2',
              reference: 'FT 3/2026',
              paymentStatus: 'PAID',
              overdue: false,
              openAmount: '0.00',
            }),
            summary({
              id: 'i3',
              kind: 'CREDIT_NOTE',
              reference: 'NC 2/2026',
              paymentStatus: 'SETTLED',
              overdue: false,
            }),
          ]),
        ),
    });
    renderApp('/invoicing/invoices');

    const overdue = (await screen.findByRole('link', { name: 'FT 1/2026' })).closest('tr')!;
    expect(within(overdue).getByText('Da incassare')).toBeInTheDocument();
    expect(within(overdue).getByText('Scaduta')).toBeInTheDocument();
    const paid = screen.getByRole('link', { name: 'FT 3/2026' }).closest('tr')!;
    expect(within(paid).getByText('Saldata')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fattura · Bozza' })).toHaveAttribute(
      'href',
      '/invoicing/drafts/d1',
    );
    expect(screen.getByText('Cliente non scelto')).toBeInTheDocument();
  });

  it('shows invoicing in the menu only with the module, and To invoice only with orders too', async () => {
    const first = mockApi(signedIn());
    const view = renderApp('/');
    expect(await screen.findByRole('link', { name: 'Fatture' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Da fatturare' })).toBeInTheDocument();
    view.unmount();
    first.spy.mockRestore();

    mockApi(signedIn(['parties:read', 'invoicing:read'], ['registry', 'invoicing']));
    const second = renderApp('/');
    await screen.findByRole('link', { name: 'Fatture' });
    expect(screen.queryByRole('link', { name: 'Da fatturare' })).not.toBeInTheDocument();
    // The modules the customer lacks, with what they would add.
    expect(screen.getByText('Altri moduli')).toBeInTheDocument();
    expect(screen.getByText(/Ordini clienti e fornitori, prenotazione/)).toBeInTheDocument();
    second.unmount();

    mockApi(signedIn(['parties:read'], ['registry', 'warehouse']));
    renderApp('/');
    await screen.findByText('Altri moduli');
    expect(screen.queryByRole('link', { name: 'Fatture' })).not.toBeInTheDocument();
  });

  it('makes a draft from shipments of one customer, never of two', async () => {
    const user = userEvent.setup();
    const shipment = (id: string, partyId: string, partyName: string, document: string) => ({
      fulfilmentId: id,
      orderId: `o-${id}`,
      orderReference: `OC-2026/${id}`,
      partyReference: null,
      documentReference: document,
      documentDate: '2026-10-15',
      partyId,
      partyName,
      taxableAmount: '10.00',
      draftId: null,
    });
    const api = mockApi({
      ...signedIn(),
      'GET /invoicing/to-invoice': () =>
        json(
          200,
          page([
            shipment('f1', 'p1', 'Ferramenta Bruni Srl', 'SC-2026/0003'),
            shipment('f2', 'p1', 'Ferramenta Bruni Srl', 'SC-2026/0005'),
            shipment('f3', 'p2', 'Edilnord Spa', 'SC-2026/0007'),
          ]),
        ),
      'POST /invoice-drafts': () => json(201, draft()),
      'GET /invoice-drafts/d1': () => json(200, draft()),
    });
    const { router } = renderApp('/invoicing/to-invoice');

    const create = await screen.findByRole('button', { name: 'Crea fattura' });
    expect(create).toBeDisabled();
    await user.click(await screen.findByRole('checkbox', { name: 'Scegli SC-2026/0003' }));
    await user.click(screen.getByRole('checkbox', { name: 'Scegli SC-2026/0007' }));
    expect(screen.getByText(/Si fattura un cliente alla volta/)).toBeInTheDocument();
    expect(create).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Scegli SC-2026/0007' }));
    await user.click(screen.getByRole('checkbox', { name: 'Scegli SC-2026/0005' }));
    expect(screen.getByText('2 spedizioni scelte')).toBeInTheDocument();
    await user.click(create);

    await waitFor(() => expect(router.state.location.pathname).toBe('/invoicing/drafts/d1'));
    expect(await bodies(api, 'POST /invoice-drafts')).toEqual([
      { id: 'd1', fulfilmentIds: ['f1', 'f2'] },
    ]);
  });

  it(
    'keeps a shipped quantity fixed, saves a new price and issues after asking',
    { timeout: 20000 },
    async () => {
      const user = userEvent.setup();
      let saved = draft();
      const api = mockApi({
        ...signedIn(),
        'GET /invoice-drafts/d1': () => json(200, saved),
        'PUT /invoice-drafts/d1': async (request) => {
          const body = (await request.json()) as { lines: { unitPrice?: string }[] };
          saved = draft({
            version: 2,
            lines: [
              draft().lines[0]!,
              line({ unitPrice: body.lines[1]!.unitPrice, lineAmount: '75.00' }),
            ],
            total: '91.50',
          });
          return json(200, saved);
        },
        'POST /invoice-drafts/d1/issue': () => json(201, invoice()),
        'GET /invoices/d1': () => json(200, invoice()),
      });
      const { router } = renderApp('/invoicing/drafts/d1');

      expect(
        await screen.findByText(/Fattura differita: va emessa entro il 15\/11\/2026/),
      ).toBeInTheDocument();
      expect(screen.getByText('Spedito con SC-2026/0003: quantità fissa')).toBeInTheDocument();
      const quantity = screen.getAllByLabelText('Quantità')[0]!;
      expect(quantity).toHaveAttribute('readonly');
      expect(quantity).toHaveValue('500');

      const price = screen.getAllByLabelText('Prezzo')[0]!;
      await user.clear(price);
      await user.type(price, '0,15');
      // 500 × 0,15 = 75,00 as typed, before saving.
      expect(await screen.findAllByText(/75,00\s€/)).not.toHaveLength(0);
      await user.click(screen.getByRole('button', { name: 'Salva bozza' }));
      await waitFor(() => expect(api.count('PUT /invoice-drafts/d1')).toBe(1));
      const [body] = await bodies(api, 'PUT /invoice-drafts/d1');
      expect(body).toMatchObject({
        version: 1,
        partyId: 'p1',
        paymentTerms: '30FM',
        lines: [
          { description: 'DDT SC-2026/0003 2026-10-15 – OC-2026/0001' },
          { fulfilmentId: 'f1', orderLineId: 'ol1', unitPrice: '0.15', discountPercent: '0' },
        ],
      });
      expect(body.lines[1]).not.toHaveProperty('quantity');

      await user.click(screen.getByRole('button', { name: 'Emetti' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(
        within(dialog).getByText(/Intestata da Rossi Srl a Ferramenta Bruni Srl, totale 91,50/),
      ).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Emetti' }));

      await waitFor(() => expect(router.state.location.pathname).toBe('/invoicing/invoices/d1'));
      const [issued] = await bodies(api, 'POST /invoice-drafts/d1/issue');
      expect(issued).toMatchObject({ version: 2, issueDate: expect.stringMatching(/^\d{4}-/) });
    },
  );

  it('proposes to charge the stamp duty when the exempt operations need it', async () => {
    const user = userEvent.setup();
    const exempt = draft({
      shipments: [],
      deferredDeadline: null,
      stampDutyRequired: true,
      lines: [
        line({
          fulfilmentId: null,
          orderLineId: null,
          itemCode: 'CORSO-SIC',
          description: 'Corso sicurezza',
          unit: 'H',
          quantity: '4.000',
          unitPrice: '50.0000',
          vatCode: 'N4',
          vatRate: '0.00',
          vatNature: 'N4',
          lineAmount: '200.00',
        }),
      ],
    });
    const api = mockApi({
      ...signedIn(),
      'GET /invoice-drafts/d1': () => json(200, exempt),
      'PUT /invoice-drafts/d1': () => json(200, { ...exempt, version: 2 }),
    });
    renderApp('/invoicing/drafts/d1');

    expect(await screen.findByText(/la fattura porta il bollo da 2 €/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Addebita il bollo al cliente' }));
    expect(screen.getByText('Rivalsa imposta di bollo · N1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salva bozza' }));
    await waitFor(() => expect(api.count('PUT /invoice-drafts/d1')).toBe(1));
    const [body] = await bodies(api, 'PUT /invoice-drafts/d1');
    expect(body.lines.at(-1)).toEqual({ stampDutyCharge: true });
  });

  it('makes a credit note of the chosen lines of an issued invoice', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...signedIn(),
      'GET /invoices/d1': () => json(200, invoice()),
      'POST /invoices/d1/credit-note': () =>
        json(
          201,
          draft({
            kind: 'CREDIT_NOTE',
            creditedInvoice: {
              id: 'd1',
              kind: 'INVOICE',
              reference: 'FT 7/2026',
              issueDate: '2026-11-05',
              total: '132.98',
            },
          }),
        ),
      'GET /invoice-drafts/d1': () =>
        json(
          200,
          draft({
            kind: 'CREDIT_NOTE',
            creditedInvoice: {
              id: 'd1',
              kind: 'INVOICE',
              reference: 'FT 7/2026',
              issueDate: '2026-11-05',
              total: '132.98',
            },
          }),
        ),
    });
    const { router } = renderApp('/invoicing/invoices/d1');

    expect(await screen.findByRole('link', { name: 'Registra incasso' })).toHaveAttribute(
      'href',
      '/invoicing/payments/new?party=p1&kind=RECEIPT',
    );
    await user.click(screen.getByRole('button', { name: 'Nota di credito' }));
    expect(screen.getByRole('button', { name: 'Storna tutto' })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Tasselli' }));
    await user.click(screen.getByRole('button', { name: 'Storna le righe scelte' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/invoicing/drafts/d1'));
    expect(await bodies(api, 'POST /invoices/d1/credit-note')).toEqual([
      { id: 'd1', lineIds: ['l2'] },
    ]);
  });

  it('downloads the FatturaPA file, and says what is missing when the API refuses it', async () => {
    const user = userEvent.setup();
    const saved: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    });
    let refuse = false;
    const api = mockApi({
      ...signedIn(),
      'GET /invoices/d1': () => json(200, invoice()),
      'GET /invoices/d1/xml': () =>
        refuse
          ? problem(409, 'XML_DATA_INCOMPLETE', [{ field: 'customer.address', code: 'REQUIRED' }])
          : new Response('<?xml version="1.0"?><p:FatturaElettronica/>', {
              status: 200,
              headers: {
                'content-type': 'application/xml; charset=utf-8',
                'content-disposition': 'attachment; filename="IT02746510964_FA007.xml"',
              },
            }),
    });
    renderApp('/invoicing/invoices/d1');

    await user.click(await screen.findByRole('button', { name: 'Scarica XML' }));
    await waitFor(() => expect(saved).toEqual(['IT02746510964_FA007.xml']));
    expect(api.count('GET /invoices/d1/xml')).toBe(1);

    refuse = true;
    await user.click(screen.getByRole('button', { name: 'Scarica XML' }));
    expect(
      await screen.findByText(/Mancano dati che il file FatturaPA richiede/),
    ).toBeInTheDocument();
  });

  it('spreads a payment on the open due dates from the oldest', async () => {
    const user = userEvent.setup();
    const due = (id: string, date: string, open: string): ScheduleRow => ({
      dueDateId: id,
      invoiceId: `inv-${id}`,
      kind: 'INVOICE',
      reference: `FT ${id}/2026`,
      issueDate: '2026-10-01',
      partyId: 'p1',
      partyName: 'Ferramenta Bruni Srl',
      seq: 1,
      dueDate: date,
      amount: open,
      settledAmount: '0.00',
      openAmount: open,
      overdue: false,
    });
    const api = mockApi({
      ...signedIn(),
      'GET /invoicing/due-dates': () =>
        json(200, {
          ...page([due('1', '2026-10-31', '85.40'), due('2', '2026-11-30', '132.98')]),
          openTotal: '218.38',
          overdueTotal: '85.40',
        }),
      'POST /payments': () => json(201, {}),
      'GET /payments': () => json(200, page([])),
    });
    const { router } = renderApp('/invoicing/payments/new?party=p1&kind=RECEIPT');

    await screen.findByText('FT 1/2026');
    await user.type(screen.getByLabelText('Importo'), '100');
    expect(screen.getByLabelText('FT 1/2026 31/10/2026')).toHaveValue('85,40');
    expect(screen.getByLabelText('FT 2/2026 30/11/2026')).toHaveValue('14,60');
    expect(screen.getByRole('status')).toHaveTextContent(/Ripartito 100(,00)? su 100/);
    await user.click(screen.getByRole('button', { name: 'Registra' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/invoicing/payments'));
    expect(await bodies(api, 'POST /payments')).toEqual([
      expect.objectContaining({
        id: 'd1',
        kind: 'RECEIPT',
        partyId: 'p1',
        amount: '100',
        method: 'MP05',
        allocations: [
          { dueDateId: '1', amount: '85.40' },
          { dueDateId: '2', amount: '14.60' },
        ],
      }),
    ]);
  });
});
