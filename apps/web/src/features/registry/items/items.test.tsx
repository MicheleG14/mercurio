import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { json, mockApi } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';
import { item, page, signedInWith } from '../registry-fixtures';

// Intl may use a narrow no-break space before the euro sign.
const plain = (text: string | null) => text?.replace(/\s/g, ' ');

describe('items', () => {
  it('shows prices as amounts in euro and VAT codes with their nature', async () => {
    mockApi({
      ...signedInWith(),
      'GET /items': () =>
        json(
          200,
          page([
            item(),
            item({ id: 'i2', code: 'CORSO', vatCode: 'N4', salePrice: null, stockManaged: false }),
          ]),
        ),
    });
    renderApp('/items');

    const row = (await screen.findByRole('link', { name: 'VT-M6-20' })).closest('tr')!;
    expect(plain(row.textContent)).toContain('0,12 €');
    expect(row.textContent).toContain('22%');
    const service = screen.getByRole('link', { name: 'CORSO' }).closest('tr')!;
    expect(service.textContent).toContain('0% · N4 Esenti');
    expect(service.textContent).toContain('Nessun prezzo');
  });

  it.each([
    ['it', '12,50', '12.50'],
    ['en', '12.50', '12.50'],
  ])('reads the price typed in %s (%s) as the decimal string %s', async (language, typed, sent) => {
    await i18n.changeLanguage(language);
    const user = userEvent.setup();
    const api = mockApi({
      ...signedInWith(),
      'POST /items': () => json(201, item({ id: 'i9', salePrice: '12.5000' })),
      'GET /items/i9': () => json(200, item({ id: 'i9', salePrice: '12.5000' })),
    });
    const { router } = renderApp('/items/new');

    const code = language === 'it' ? 'Codice' : 'Code';
    await user.type(await screen.findByLabelText(code), 'VT-NEW');
    await user.type(
      screen.getByLabelText(language === 'it' ? 'Descrizione' : 'Description'),
      'Vite',
    );
    await user.type(
      screen.getByLabelText(language === 'it' ? 'Prezzo di vendita (€)' : 'Sale price (€)'),
      typed,
    );
    await user.click(screen.getByRole('button', { name: language === 'it' ? 'Salva' : 'Save' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/items/i9'));
    const body = (await api.calls.find((c) => c.path === '/items')!.request.json()) as {
      salePrice: string;
    };
    expect(body.salePrice).toBe(sent);
  });

  it('refuses a price with the separator of another language, instead of guessing', async () => {
    const user = userEvent.setup();
    const api = mockApi(signedInWith());
    renderApp('/items/new');

    await user.type(await screen.findByLabelText('Codice'), 'VT-1');
    await user.type(screen.getByLabelText('Descrizione'), 'Vite');
    await user.type(screen.getByLabelText('Prezzo di vendita (€)'), '12.50');
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    expect(await screen.findByText(/usa la virgola per i decimali/)).toBeInTheDocument();
    expect(api.count('POST /items')).toBe(0);
  });

  it('shows a stored price in the input as typed in Italian, and keeps the code fixed', async () => {
    mockApi({
      ...signedInWith(),
      'GET /items/i1': () => json(200, item({ salePrice: '1234.5000' })),
    });
    renderApp('/items/i1');

    expect(await screen.findByLabelText('Prezzo di vendita (€)')).toHaveValue('1234,50');
    expect(screen.getByLabelText('Codice')).toHaveAttribute('readonly');
  });

  it('is read only for who cannot write items', async () => {
    mockApi({
      ...signedInWith(['parties:read', 'parties:write', 'items:read']),
      'GET /items/i1': () => json(200, item()),
    });
    renderApp('/items/i1');

    expect(await screen.findByText(/Sola lettura/)).toBeInTheDocument();
    expect(screen.getByLabelText('Descrizione')).toBeDisabled();
  });
});
