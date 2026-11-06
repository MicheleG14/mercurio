import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { businessToday } from '@/lib/format';
import { json, me, mockApi, session } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

// The overview's charts (docs/adr/0032): each module only with its module and read permission,
// the same figures as a table, and an empty state for a year without documents.
const year = Number(businessToday().slice(0, 4));
const zeroMonths = (extra: (month: number) => object) =>
  Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...extra(i + 1) }));

const invoicingStats = (empty = false) => ({
  year,
  years: empty ? [] : [year],
  months: zeroMonths((month) =>
    !empty && month === 3
      ? { taxable: '1000.00', vat: '220.00', total: '1220.00', collected: '500.00' }
      : { taxable: '0.00', vat: '0.00', total: '0.00', collected: '0.00' },
  ),
  topCustomers: empty
    ? []
    : [{ partyId: 'p1', name: 'Edilnord Spa', taxable: '1000.00', open: '720.00' }],
});

const routes = (permissions: string[], empty = false) => ({
  'POST /auth/refresh': () => json(200, session('t-rossi')),
  'GET /auth/me': () =>
    json(200, me({ permissions, modules: ['registry', 'warehouse', 'orders', 'invoicing'] })),
  'GET /stock/summary': () => json(200, { belowReorder: 2, documentsToday: 1 }),
  'GET /orders/summary': () =>
    json(200, {
      salesOpen: 1,
      salesUncovered: 0,
      salesLate: 0,
      purchaseOpen: 0,
      purchaseLate: 0,
    }),
  'GET /invoicing/summary': () =>
    json(200, {
      toInvoice: 0,
      drafts: 0,
      overdue: '0.00',
      dueSoon: '0.00',
      invoicedThisMonth: '0.00',
    }),
  'GET /invoicing/stats': () => json(200, invoicingStats(empty)),
  'GET /invoicing/aging': () =>
    json(200, {
      asOf: `${year}-11-05`,
      total: empty ? '0.00' : '720.00',
      buckets: ['NOT_DUE', 'DAYS_1_30', 'DAYS_31_60', 'DAYS_61_90', 'OVER_90'].map((bucket) => ({
        bucket,
        amount: !empty && bucket === 'DAYS_31_60' ? '720.00' : '0.00',
        count: !empty && bucket === 'DAYS_31_60' ? 1 : 0,
      })),
    }),
  'GET /orders/stats': () =>
    json(200, {
      year,
      years: [year],
      months: zeroMonths(() => ({ ordered: '0.00', shipped: '0.00' })),
      backlog: '0.00',
      backlogCustomers: [],
    }),
  'GET /stock/stats': () =>
    json(200, {
      year,
      years: [year],
      months: zeroMonths((month) => ({
        receipt: month === 3 ? 4 : 0,
        issue: month === 3 ? 2 : 0,
        adjustment: 0,
        transfer: 0,
      })),
    }),
});

describe('overview charts', () => {
  it('shows invoicing to whoever reads invoices, with the figures as a table too', async () => {
    mockApi(routes(['invoicing:read']));
    renderApp('/');
    const card = (await screen.findByText(`Fatturato e incassato nel ${year}`)).closest(
      '[data-slot="card"]',
    ) as HTMLElement;
    expect(screen.getByText('Da incassare per ritardo')).toBeInTheDocument();
    expect(screen.getByText(`Primi clienti nel ${year}`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edilnord Spa' })).toHaveAttribute(
      'href',
      '/parties/p1',
    );
    // No warehouse permission, no warehouse chart.
    expect(screen.queryByText(`Documenti di magazzino nel ${year}`)).not.toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: 'Mostra come tabella' }));
    const table = within(card).getByRole('table');
    const march = within(table).getByRole('link', { name: /marzo/i });
    expect(march).toHaveAttribute(
      'href',
      `/invoicing/invoices?from=${year}-03-01&to=${year}-03-31`,
    );
    const row = march.closest('tr') as HTMLElement;
    expect(within(row).getByText('1000,00 €')).toBeInTheDocument();
    expect(within(row).getByText('1220,00 €')).toBeInTheDocument();
    expect(within(row).getByText('500,00 €')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(13);
  });

  it('opens the payment schedule of a delay bucket from the table', async () => {
    mockApi(routes(['invoicing:read']));
    renderApp('/');
    const card = (await screen.findByText('Da incassare per ritardo')).closest(
      '[data-slot="card"]',
    ) as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: 'Mostra come tabella' }));
    expect(within(card).getByRole('link', { name: '31-60 giorni' })).toHaveAttribute(
      'href',
      `/invoicing/due-dates?status=overdue&from=${year}-09-06&to=${year}-10-05`,
    );
  });

  it('shows the warehouse keeper movements but no invoiced amounts', async () => {
    mockApi(routes(['stock:read', 'orders:read']));
    renderApp('/');
    expect(await screen.findByText(`Documenti di magazzino nel ${year}`)).toBeInTheDocument();
    expect(screen.getByText(`Ordinato ed evaso nel ${year}`)).toBeInTheDocument();
    expect(screen.queryByText(`Fatturato e incassato nel ${year}`)).not.toBeInTheDocument();
    expect(screen.queryByText('Da incassare per ritardo')).not.toBeInTheDocument();
    // Nothing ordered this year: the card says so instead of drawing flat bars.
    expect(screen.getByText('Nessun ordine cliente da evadere.')).toBeInTheDocument();
  });

  it('holds the place of the charts while their figures load', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const all = routes(['invoicing:read']);
    mockApi({
      ...all,
      'GET /invoicing/stats': async () => {
        await held;
        return all['GET /invoicing/stats']();
      },
    });
    renderApp('/');
    const section = await screen.findByRole('region', { name: 'Andamento' });
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(section.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByText(`Fatturato e incassato nel ${year}`)).not.toBeInTheDocument();

    release();
    expect(await screen.findByText(`Fatturato e incassato nel ${year}`)).toBeInTheDocument();
    expect(section).toHaveAttribute('aria-busy', 'false');
    expect(section.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
  });

  it('says when a year has no documents', async () => {
    mockApi(routes(['invoicing:read'], true));
    renderApp('/');
    expect(await screen.findAllByText(`Nessun documento nel ${year}.`)).toHaveLength(2);
    expect(screen.getByText('Nessuna fattura da incassare.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mostra come tabella' })).not.toBeInTheDocument();
  });
});
