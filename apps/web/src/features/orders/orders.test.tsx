import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { json, me, mockApi, problem, session } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';
import type { Order, OrderItemOption, OrderLine, OrderSummary } from './queries';

// Component tests of the orders screens, against a fake API. Figures are the API's strings.
// Ids the browser chooses (B33) are fixed here, so the fake API knows the new order as o1.
vi.mock('@/lib/uuid', () => ({ uuidv7: () => 'o1' }));

const ALL = [
  'parties:read',
  'items:read',
  'stock:read',
  'orders:read',
  'orders:write',
  'orders:fulfil',
];

const signedIn = (permissions = ALL, modules = ['registry', 'warehouse', 'orders']) => ({
  'POST /auth/refresh': () => json(200, session('t-rossi')),
  'GET /auth/me': () => json(200, me({ permissions, modules })),
  'GET /warehouses': () =>
    json(200, {
      items: [
        {
          id: 'w1',
          code: 'SEDE',
          name: 'Magazzino della sede',
          version: 1,
          archivedAt: null,
          createdAt: '2026-10-21T08:00:00.000Z',
          updatedAt: '2026-10-21T08:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    }),
  'GET /registry/reference-data': () =>
    json(200, {
      vatCodes: [
        { code: '22', rate: '22.00', nature: null },
        { code: '4', rate: '4.00', nature: null },
      ],
      units: [{ code: 'PZ', decimals: 0 }],
      legalForms: [],
    }),
});

const line = (overrides: Partial<OrderLine> = {}): OrderLine => ({
  id: 'l1',
  lineNo: 1,
  itemId: 'i1',
  itemCode: 'SM-125',
  description: 'Smerigliatrice angolare 125 mm',
  unit: 'PZ',
  unitDecimals: 0,
  quantity: '5.000',
  unitPrice: '64.9000',
  discountPercent: '0.00',
  vatCode: '22',
  vatRate: '22.00',
  vatNature: null,
  lineAmount: '324.50',
  doneQuantity: '0.000',
  closedQuantity: '0.000',
  remainingQuantity: '5.000',
  reservedQuantity: '3.000',
  availableQuantity: '0.000',
  ...overrides,
});

const order = (overrides: Partial<Order> = {}): Order => ({
  id: 'o1',
  kind: 'SALES',
  status: 'CONFIRMED',
  reference: 'OC-2026/0012',
  orderDate: '2026-10-23',
  partyId: 'p1',
  partyName: 'Baustoffe Müller GmbH',
  warehouseId: 'w1',
  warehouseCode: 'SEDE',
  warehouseName: 'Magazzino della sede',
  partyReference: 'PO 77812',
  partyReferenceDate: null,
  requestedDate: '2026-10-25',
  notes: null,
  taxableTotal: '324.50',
  vatTotal: '71.39',
  total: '395.89',
  vatSummary: [{ vatCode: '22', rate: '22.00', nature: null, taxable: '324.50', vat: '71.39' }],
  lineCount: 1,
  late: true,
  uncovered: true,
  version: 2,
  lines: [line()],
  fulfilments: [],
  createdByName: 'Anna Rossi',
  confirmedAt: '2026-10-23T09:00:00.000Z',
  cancelledAt: null,
  createdAt: '2026-10-23T08:00:00.000Z',
  ...overrides,
});

const summary = (o: Order): OrderSummary => {
  const {
    warehouseName: _w,
    partyReferenceDate: _p,
    notes: _n,
    vatTotal: _v,
    vatSummary: _s,
    lines: _l,
    fulfilments: _f,
    createdByName: _c,
    confirmedAt: _a,
    cancelledAt: _x,
    createdAt: _t,
    ...rest
  } = o;
  return rest;
};

const item = (overrides: Partial<OrderItemOption> = {}): OrderItemOption => ({
  id: 'i1',
  code: 'SM-125',
  description: 'Smerigliatrice angolare 125 mm',
  unit: 'PZ',
  unitDecimals: 0,
  salePrice: '64.9000',
  vatCode: '22',
  availableQuantity: '3.000',
  ...overrides,
});

const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 25 });

describe('orders', () => {
  it('lists sales orders with their status in words, late and uncovered', async () => {
    mockApi({
      ...signedIn(),
      'GET /orders': () =>
        json(
          200,
          page([
            summary(order()),
            summary(
              order({ id: 'o2', status: 'DRAFT', reference: null, late: false, uncovered: false }),
            ),
          ]),
        ),
    });
    renderApp('/orders/sales');

    const confirmed = (await screen.findByRole('link', { name: 'OC-2026/0012' })).closest('tr')!;
    expect(within(confirmed).getByText('Da evadere')).toBeInTheDocument();
    expect(within(confirmed).getByText('In ritardo')).toBeInTheDocument();
    expect(within(confirmed).getByText('Scoperto')).toBeInTheDocument();
    const draft = screen.getByRole('link', { name: 'Bozza' }).closest('tr')!;
    expect(within(draft).getAllByText('Bozza').length).toBeGreaterThan(1);
  });

  it('shows the orders in the menu only with the module', async () => {
    mockApi({
      ...signedIn(),
      'GET /orders/summary': () =>
        json(200, {
          salesOpen: 4,
          salesUncovered: 1,
          salesLate: 1,
          purchaseOpen: 2,
          purchaseLate: 0,
        }),
    });
    const first = renderApp('/');
    expect(await screen.findByRole('link', { name: 'Ordini clienti' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '4' })).toHaveAttribute(
      'href',
      '/orders/sales?status=OPEN',
    );
    first.unmount();

    mockApi(signedIn(ALL, ['registry', 'warehouse']));
    renderApp('/');
    await screen.findByRole('link', { name: 'Giacenze' });
    expect(screen.queryByRole('link', { name: 'Ordini clienti' })).not.toBeInTheDocument();
  });

  it(
    'writes a sales order with the list price, shows totals as typed, saves it and confirms it',
    { timeout: 20000 },
    async () => {
      const user = userEvent.setup();
      const api = mockApi({
        ...signedIn(),
        'GET /orders/parties-search': () =>
          json(200, [{ id: 'p1', name: 'Baustoffe Müller GmbH', vatNumber: 'DE811234567' }]),
        'GET /orders/items-search': () => json(200, [item()]),
        'POST /orders': () => json(201, order({ status: 'DRAFT', reference: null, version: 1 })),
        'POST /orders/o1/confirm': () => json(200, order()),
        'GET /orders/o1': () => json(200, order()),
      });
      const { router } = renderApp('/orders/new?kind=SALES');

      await user.click(await screen.findByRole('combobox', { name: 'Cliente' }));
      await user.click(await screen.findByRole('option', { name: /Baustoffe/ }));
      await user.click(screen.getByRole('combobox', { name: /Riga 1/ }));
      await user.click(await screen.findByRole('option', { name: /SM-125/ }));
      expect(screen.getByLabelText('Prezzo')).toHaveValue('64,90');
      await user.type(screen.getByLabelText('Quantità (PZ)'), '5');
      await user.type(screen.getByLabelText('Sconto %'), '10');

      // 5 × 64,90 less 10% = 292,05; VAT 22% = 64,25.
      expect(await screen.findAllByText(/292,05\s€/)).not.toHaveLength(0);
      expect(screen.getByText(/356,30\s€/)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Salva e conferma' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/orders/o1'));
      const [body] = await Promise.all(
        api.calls
          .filter((c) => c.method === 'POST' && c.path === '/orders')
          .map((c) => c.request.json()),
      );
      expect(body).toMatchObject({
        kind: 'SALES',
        partyId: 'p1',
        warehouseId: 'w1',
        lines: [
          { itemId: 'i1', quantity: '5', unitPrice: '64.90', discountPercent: '10', vatCode: '22' },
        ],
      });
      expect(api.count('POST /orders/o1/confirm')).toBe(1);
    },
  );

  it('asks for the prices of a sale before confirming, without calling the API', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...signedIn(),
      'GET /orders/parties-search': () =>
        json(200, [{ id: 'p1', name: 'Ferramenta Bruni Srl', vatNumber: null }]),
      'GET /orders/items-search': () => json(200, [item({ salePrice: null })]),
    });
    renderApp('/orders/new?kind=SALES');

    await user.click(await screen.findByRole('combobox', { name: 'Cliente' }));
    await user.click(await screen.findByRole('option', { name: /Ferramenta/ }));
    await user.click(screen.getByRole('combobox', { name: /Riga 1/ }));
    await user.click(await screen.findByRole('option', { name: /SM-125/ }));
    await user.type(screen.getByLabelText('Quantità (PZ)'), '2');
    await user.click(screen.getByRole('button', { name: 'Salva e conferma' }));

    expect(await screen.findByText('Campo obbligatorio.')).toBeInTheDocument();
    expect(api.count('POST /orders')).toBe(0);
  });

  it('offers each action only in the right status and with the right permission', async () => {
    mockApi({ ...signedIn(), 'GET /orders/o1': () => json(200, order()) });
    const first = renderApp('/orders/o1');
    expect(await screen.findByRole('link', { name: 'Evadi' })).toHaveAttribute(
      'href',
      '/orders/o1/fulfil',
    );
    expect(screen.getByRole('button', { name: 'Prenota disponibile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chiudi residuo' })).toBeInTheDocument();
    expect(screen.getByLabelText('evasi 0 su 5')).toBeInTheDocument();
    first.unmount();

    // An accountant takes orders but moves no goods.
    mockApi({
      ...signedIn(['orders:read', 'orders:write']),
      'GET /orders/o1': () => json(200, order()),
    });
    const second = renderApp('/orders/o1');
    await screen.findByRole('button', { name: 'Chiudi residuo' });
    expect(screen.queryByRole('link', { name: 'Evadi' })).not.toBeInTheDocument();
    second.unmount();

    mockApi({
      ...signedIn(['orders:read']),
      'GET /orders/o1': () => json(200, order({ status: 'DRAFT', reference: null })),
    });
    renderApp('/orders/o1');
    await screen.findByText('Bozza di ordine');
    expect(screen.queryByRole('button', { name: 'Conferma' })).not.toBeInTheDocument();
  });

  it('ships the reserved goods by default, and shows a stock error on its line', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = mockApi({
      ...signedIn(),
      'GET /orders/o1': () =>
        json(
          200,
          order({
            lines: [
              line({
                id: 'l0',
                lineNo: 1,
                itemCode: 'TR-18V',
                reservedQuantity: '0.000',
                remainingQuantity: '2.000',
                quantity: '2.000',
              }),
              line({ lineNo: 2 }),
            ],
          }),
        ),
      'POST /orders/o1/fulfilments': () =>
        ++attempts === 1
          ? problem(409, 'STOCK_INSUFFICIENT', [
              { field: 'lines[1].quantity', code: 'STOCK_INSUFFICIENT' },
            ])
          : json(201, order()),
    });
    const { router } = renderApp('/orders/o1/fulfil');

    const fields = await screen.findAllByLabelText('Da spedire (PZ)');
    // Nothing reserved for the first line: 0 proposed; three of five for the second.
    expect(fields.map((f) => (f as HTMLInputElement).value)).toEqual(['0', '3']);
    await user.clear(fields[1]!);
    await user.type(fields[1]!, '5');
    await user.click(screen.getByRole('button', { name: "Registra l'evasione" }));
    expect(await screen.findByText('Giacenza disponibile insufficiente.')).toBeInTheDocument();

    await user.clear(fields[1]!);
    await user.type(fields[1]!, '3');
    await user.click(screen.getByRole('button', { name: "Registra l'evasione" }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/orders/o1'));
    const bodies = await Promise.all(
      api.calls
        .filter((c) => c.method === 'POST' && c.path === '/orders/o1/fulfilments')
        .map((c) => c.request.json() as Promise<{ id: string; lines: object[] }>),
    );
    expect(bodies[1]!.id).toBe(bodies[0]!.id);
    expect(bodies[1]!.lines).toEqual([
      { orderLineId: 'l0', quantity: '0' },
      { orderLineId: 'l1', quantity: '3' },
    ]);
  });

  it('undoes a shipment after asking', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...signedIn(),
      'GET /orders/o1': () =>
        json(
          200,
          order({
            status: 'PARTIAL',
            fulfilments: [
              {
                id: 'f1',
                documentDate: '2026-10-24',
                stockDocumentId: 'd1',
                stockDocumentReference: 'SC-2026/0007',
                reversalDocumentId: null,
                reversalDocumentReference: null,
                reversedAt: null,
                createdByName: 'Marco Verdi',
                createdAt: '2026-10-24T09:00:00.000Z',
                lines: [{ orderLineId: 'l1', quantity: '2.000' }],
              },
            ],
          }),
        ),
      'POST /orders/o1/fulfilments/f1/reverse': () => json(200, order()),
    });
    renderApp('/orders/o1');

    expect(await screen.findByRole('link', { name: 'SC-2026/0007' })).toHaveAttribute(
      'href',
      '/stock/documents/d1',
    );
    expect(screen.queryByRole('button', { name: "Annulla l'ordine" })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Annulla la registrazione' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Annulla la registrazione' }));
    await waitFor(() => expect(api.count('POST /orders/o1/fulfilments/f1/reverse')).toBe(1));
  });
});
