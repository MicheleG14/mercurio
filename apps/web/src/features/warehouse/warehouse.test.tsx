import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { json, me, mockApi, problem, session } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';
import type { ItemOption, ItemStock, StockDocument, StockRow, Warehouse } from './queries';

// Fictitious records for the component tests of the warehouse.

const WAREHOUSE_PERMISSIONS = ['parties:read', 'items:read', 'stock:read', 'stock:write'];

const warehouse = (overrides: Partial<Warehouse> = {}): Warehouse => ({
  id: 'w1',
  code: 'SEDE',
  name: 'Magazzino della sede',
  version: 1,
  archivedAt: null,
  createdAt: '2026-10-21T08:00:00.000Z',
  updatedAt: '2026-10-21T08:00:00.000Z',
  ...overrides,
});

const row = (overrides: Partial<StockRow> = {}): StockRow => ({
  itemId: 'i1',
  itemCode: 'CM-PORT',
  itemDescription: 'Cemento Portland',
  unit: 'KG',
  unitDecimals: 3,
  itemArchived: false,
  quantity: '1250.500',
  reorderPoint: null,
  reorderQuantity: null,
  belowReorder: false,
  ...overrides,
});

const option = (overrides: Partial<ItemOption> = {}): ItemOption => ({
  id: 'i1',
  code: 'CM-PORT',
  description: 'Cemento Portland',
  unit: 'KG',
  unitDecimals: 3,
  archived: false,
  quantity: '7.000',
  ...overrides,
});

const itemStock = (quantity = '7.000'): ItemStock => ({
  itemId: 'i1',
  itemCode: 'CM-PORT',
  itemDescription: 'Cemento Portland',
  unit: 'KG',
  unitDecimals: 3,
  itemArchived: false,
  stockManaged: true,
  quantity,
  warehouses: [
    {
      warehouseId: 'w1',
      warehouseCode: 'SEDE',
      warehouseName: 'Magazzino della sede',
      warehouseArchived: false,
      quantity,
      reorderPoint: null,
      reorderQuantity: null,
      reorderVersion: null,
      belowReorder: false,
    },
  ],
});

const document = (overrides: Partial<StockDocument> = {}): StockDocument => ({
  id: 'd1',
  reference: 'CA-2026/0042',
  reason: 'PURCHASE_RECEIPT',
  type: 'receipt',
  documentDate: '2026-10-22',
  warehouseId: 'w1',
  warehouseCode: 'SEDE',
  targetWarehouseId: null,
  targetWarehouseCode: null,
  partyId: 'p1',
  partyName: 'Viteria Lombarda Srl',
  partyDocumentRef: 'VL-815',
  partyDocumentDate: null,
  lineCount: 1,
  reverses: null,
  reversedBy: null,
  createdAt: '2026-10-22T08:00:00.000Z',
  notes: null,
  createdByName: 'Marco Verdi',
  reversedReason: null,
  lines: [
    {
      lineNo: 1,
      itemId: 'i1',
      itemCode: 'CM-PORT',
      itemDescription: 'Cemento Portland',
      unit: 'KG',
      quantity: '2.500',
      countedQuantity: null,
    },
  ],
  ...overrides,
});

const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 25 });

const signedIn = (permissions = WAREHOUSE_PERMISSIONS, modules = ['registry', 'warehouse']) => ({
  'POST /auth/refresh': () => json(200, session('t-rossi')),
  'GET /auth/me': () => json(200, me({ permissions, modules })),
  'GET /warehouses': () => json(200, page([warehouse()])),
});

describe('warehouse', () => {
  it('lists stock with the decimals of each unit and flags what to reorder', async () => {
    mockApi({
      ...signedIn(),
      'GET /stock': () =>
        json(
          200,
          page([
            row(),
            row({
              itemId: 'i2',
              itemCode: 'TR-18V',
              itemDescription: 'Trapano',
              unit: 'PZ',
              unitDecimals: 0,
              quantity: '3.000',
              reorderPoint: '5.000',
              belowReorder: true,
            }),
          ]),
        ),
    });
    renderApp('/stock');

    const cement = (await screen.findByRole('link', { name: 'CM-PORT' })).closest('tr')!;
    expect(cement.textContent).toContain('1250,5 KG');
    const drill = screen.getByRole('link', { name: 'TR-18V' }).closest('tr')!;
    expect(drill.textContent).toContain('3 PZ');
    expect(within(drill).getByText('Sotto scorta')).toBeInTheDocument();
  });

  it('sends the company with every warehouse call', async () => {
    const api = mockApi({ ...signedIn(), 'GET /stock': () => json(200, page([])) });
    renderApp('/stock');

    await screen.findByText('Nessun articolo in giacenza.');
    const call = api.calls.find((c) => c.path === '/stock')!;
    expect(call.request.headers.get('X-Company-Id')).toBe('c1');
  });

  it('records an issue once: the same id goes again after a stock error, on the right line', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = mockApi({
      ...signedIn(),
      'GET /stock/items-search': () => json(200, [option()]),
      'GET /stock/items/i1': () => json(200, itemStock()),
      'POST /stock-documents': () =>
        ++attempts === 1
          ? problem(409, 'STOCK_INSUFFICIENT', [
              { field: 'lines[0].quantity', code: 'STOCK_INSUFFICIENT' },
            ])
          : json(201, document({ id: 'd2', reason: 'INTERNAL_USE', type: 'issue' })),
      'GET /stock-documents/d2': () => json(200, document({ id: 'd2' })),
    });
    const { router } = renderApp('/stock/documents/new?type=issue');

    const reason = await screen.findByLabelText('Causale');
    await user.selectOptions(reason, 'INTERNAL_USE');
    await user.click(screen.getByRole('combobox', { name: /Riga 1/ }));
    await user.click(await screen.findByRole('option', { name: /CM-PORT/ }));
    await user.type(screen.getByLabelText('Quantità (KG)'), '9,5');
    await user.click(screen.getByRole('button', { name: 'Registra' }));

    expect(await screen.findByText('Giacenza insufficiente.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Quantità (KG)'));
    await user.type(screen.getByLabelText('Quantità (KG)'), '2,5');
    await user.click(screen.getByRole('button', { name: 'Registra' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/stock/documents/d2'));
    const bodies = await Promise.all(
      api.calls
        .filter((c) => c.method === 'POST' && c.path === '/stock-documents')
        .map((c) => c.request.json() as Promise<{ id: string; lines: object[] }>),
    );
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(bodies[1]!.id).toBe(bodies[0]!.id);
    expect(bodies[0]!.lines).toEqual([{ itemId: 'i1', quantity: '9.5' }]);
    expect(bodies[1]!.lines).toEqual([{ itemId: 'i1', quantity: '2.5' }]);
  });

  it('shows the difference an inventory count will make', async () => {
    const user = userEvent.setup();
    mockApi({
      ...signedIn(),
      'GET /stock/items-search': () => json(200, [option()]),
      'GET /stock/items/i1': () => json(200, itemStock('7.000')),
    });
    renderApp('/stock/documents/new?type=adjustment');

    await user.click(await screen.findByRole('combobox', { name: /Riga 1/ }));
    await user.click(await screen.findByRole('option', { name: /CM-PORT/ }));
    await user.type(screen.getByLabelText('Contata (KG)'), '4,5');

    expect(await screen.findByText(/In giacenza: 7 KG/)).toBeInTheDocument();
    expect(screen.getByText(/Differenza: -2,5/)).toBeInTheDocument();
  });

  it('asks the supplier of a receipt before sending it', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...signedIn(),
      'GET /stock/items-search': () => json(200, [option()]),
      'GET /stock/items/i1': () => json(200, itemStock()),
    });
    renderApp('/stock/documents/new?type=receipt');

    await user.click(await screen.findByRole('combobox', { name: /Riga 1/ }));
    await user.click(await screen.findByRole('option', { name: /CM-PORT/ }));
    await user.type(screen.getByLabelText('Quantità (KG)'), '1,2345');
    await user.click(screen.getByRole('button', { name: 'Registra' }));

    expect(await screen.findByText('Campo obbligatorio.')).toBeInTheDocument();
    expect(screen.getByText(/Quantità non valida/)).toBeInTheDocument();
    expect(api.count('POST /stock-documents')).toBe(0);
  });

  it('reverses a document after asking, and opens the reversal', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...signedIn(),
      'GET /stock-documents/d1': () => json(200, document()),
      'POST /stock-documents/d1/reverse': () =>
        json(
          201,
          document({
            id: 'd9',
            reference: 'CA-2026/0043',
            reason: 'REVERSAL',
            reverses: { id: 'd1', reference: 'CA-2026/0042' },
          }),
        ),
      'GET /stock-documents/d9': () =>
        json(200, document({ id: 'd9', reason: 'REVERSAL', reference: 'CA-2026/0043' })),
    });
    const { router } = renderApp('/stock/documents/d1');

    await user.click(await screen.findByRole('button', { name: 'Storna' }));
    await user.click(await screen.findByRole('button', { name: 'Storna il documento' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/stock/documents/d9'));
    expect(api.count('POST /stock-documents/d1/reverse')).toBe(1);
  });

  it('offers no reversal to who only reads, nor of a document already reversed', async () => {
    mockApi({
      ...signedIn(['stock:read']),
      'GET /stock-documents/d1': () => json(200, document()),
    });
    renderApp('/stock/documents/d1');
    expect(await screen.findByText('Documento CA-2026/0042')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Storna' })).not.toBeInTheDocument();
  });

  it('shows the warehouse in the menu only with the module and the permission', async () => {
    mockApi({
      ...signedIn(),
      'GET /stock/summary': () => json(200, { belowReorder: 3, documentsToday: 1 }),
    });
    const first = renderApp('/');
    expect(await screen.findByRole('link', { name: 'Giacenze' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Magazzini' })).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '3' })).toHaveAttribute(
      'href',
      '/stock/below-reorder',
    );
    first.unmount();

    mockApi(signedIn(WAREHOUSE_PERMISSIONS, ['registry']));
    renderApp('/');
    await screen.findByRole('link', { name: 'Articoli' });
    expect(screen.queryByRole('link', { name: 'Giacenze' })).not.toBeInTheDocument();
  });
});
