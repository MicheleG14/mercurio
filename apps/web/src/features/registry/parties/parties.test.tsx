import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { json, mockApi, problem } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';
import { page, party, signedInWith } from '../registry-fixtures';

const query = (request: Request) => new URL(request.url).searchParams;

describe('parties list', () => {
  it('searches after typing stops, and keeps search and filters in the address', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...signedInWith(),
      'GET /parties': (request) =>
        json(200, page(query(request).get('q') === 'bruni' ? [party()] : [])),
    });
    const { router } = renderApp('/parties');
    expect(await screen.findByText('Nessun soggetto trovato.')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: /Cerca per nome/ }), 'bruni');
    expect(await screen.findByRole('link', { name: 'Ferramenta Bruni Srl' })).toBeInTheDocument();
    // One search for the whole word, not one per letter.
    const searches = api.calls.filter((c) => c.path === '/parties').map((c) => query(c.request));
    expect(searches.map((q) => q.get('q'))).toEqual([null, 'bruni']);
    expect(router.state.location.search).toBe('?q=bruni');

    await user.selectOptions(screen.getByRole('combobox', { name: /Mostra/ }), 'Fornitori');
    await waitFor(() => expect(router.state.location.search).toBe('?q=bruni&role=supplier'));
    await user.click(screen.getByRole('checkbox', { name: 'Mostra archiviati' }));
    await waitFor(() =>
      expect(router.state.location.search).toBe('?q=bruni&role=supplier&archived=true'),
    );
    const last = query(api.calls.filter((c) => c.path === '/parties').at(-1)!.request);
    expect([last.get('role'), last.get('archived'), last.get('q')]).toEqual([
      'supplier',
      'true',
      'bruni',
    ]);
  });

  it('opens on the list described by the address', async () => {
    const api = mockApi({ ...signedInWith(), 'GET /parties': () => json(200, page([party()])) });
    renderApp('/parties?q=milano&role=customer&page=2');
    expect(await screen.findByRole('searchbox')).toHaveValue('milano');
    const sent = query(api.calls.find((c) => c.path === '/parties')!.request);
    expect([sent.get('q'), sent.get('role'), sent.get('page')]).toEqual([
      'milano',
      'customer',
      '2',
    ]);
  });

  it('sorts from the header, with the keyboard too', async () => {
    const user = userEvent.setup();
    const api = mockApi({ ...signedInWith(), 'GET /parties': () => json(200, page([party()])) });
    const { router } = renderApp('/parties');
    const header = await screen.findByRole('columnheader', { name: /Nome/ });
    expect(header).toHaveAttribute('aria-sort', 'ascending');

    within(header).getByRole('button').focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /Nome/ })).toHaveAttribute(
        'aria-sort',
        'descending',
      ),
    );
    expect(router.state.location.search).toBe('?sort=name%3Adesc');
    expect(query(api.calls.at(-1)!.request).get('sort')).toBe('name:desc');
  });

  it('offers "new" only to who can write', async () => {
    mockApi({
      ...signedInWith(['parties:read']),
      'GET /parties': () => json(200, page([party()])),
    });
    renderApp('/parties');
    expect(await screen.findByRole('link', { name: 'Ferramenta Bruni Srl' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Nuovo soggetto/ })).not.toBeInTheDocument();
  });
});

describe('party record', () => {
  it('checks the VAT number while filling in the form, before asking the server', async () => {
    const user = userEvent.setup();
    const api = mockApi({ ...signedInWith(), 'POST /parties': () => json(201, party()) });
    renderApp('/parties/new');

    await user.type(await screen.findByLabelText('Ragione sociale'), 'Nuova Srl');
    await user.type(screen.getByLabelText('Partita IVA'), '12345678901');
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    expect(await screen.findByText(/Partita IVA non valida/)).toBeInTheDocument();
    expect(screen.getByLabelText('Partita IVA')).toHaveAttribute('aria-invalid', 'true');
    expect(api.count('POST /parties')).toBe(0);
  });

  it('shows the fields of the chosen kind', async () => {
    const user = userEvent.setup();
    mockApi(signedInWith());
    renderApp('/parties/new');

    await user.selectOptions(await screen.findByLabelText('Tipologia'), 'Privato');
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
    expect(screen.getByLabelText('Cognome')).toBeInTheDocument();
    expect(screen.queryByLabelText('Partita IVA')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Forma giuridica')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Paese'), 'DE');
    expect(screen.queryByLabelText('Provincia')).not.toBeInTheDocument();
  });

  it("puts the server's field errors on the field, and leads to the existing party", async () => {
    const user = userEvent.setup();
    mockApi({
      ...signedInWith(),
      'GET /parties/lookup': () => json(200, { items: [] }),
      'POST /parties': () =>
        json(409, {
          type: 'about:blank',
          status: 409,
          title: 'Conflict',
          code: 'PARTY_VAT_TAKEN',
          errors: [{ field: 'vatNumber', code: 'PARTY_VAT_TAKEN' }],
          existingId: 'p9',
        }),
    });
    renderApp('/parties/new');

    await user.type(await screen.findByLabelText('Ragione sociale'), 'Copia Srl');
    await user.type(screen.getByLabelText('Partita IVA'), '12345678903');
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    expect(await screen.findByText(/già presente in un altro soggetto/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apri il soggetto esistente' })).toHaveAttribute(
      'href',
      '/parties/p9',
    );
  });

  it('proposes the party that already has the VAT number, when the field is left', async () => {
    const user = userEvent.setup();
    mockApi({
      ...signedInWith(),
      'GET /parties/lookup': () =>
        json(200, {
          items: [
            {
              id: 'p7',
              name: 'Ferramenta Bruni Srl',
              vatNumber: '12345678903',
              taxCode: null,
              archivedAt: '2026-10-01T00:00:00.000Z',
            },
          ],
        }),
    });
    renderApp('/parties/new');

    await user.type(await screen.findByLabelText('Partita IVA'), 'IT 12345678903');
    await user.tab();

    expect(await screen.findByText(/ha questo identificativo ed è archiviata/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apri per ripristinarla' })).toHaveAttribute(
      'href',
      '/parties/p7',
    );
  });

  it('is read only without the write permission', async () => {
    mockApi({
      ...signedInWith(['parties:read']),
      'GET /parties/p1': () => json(200, party()),
    });
    renderApp('/parties/p1');

    expect(await screen.findByText(/Sola lettura/)).toBeInTheDocument();
    expect(screen.getByLabelText('Ragione sociale')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Salva' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archivia' })).not.toBeInTheDocument();
  });

  it('reports a conflicting edit and reloads the latest version on request', async () => {
    const user = userEvent.setup();
    let latest = party();
    const api = mockApi({
      ...signedInWith(),
      'GET /parties/p1': () => json(200, latest),
      'PATCH /parties/p1': () => problem(409, 'EDIT_CONFLICT'),
    });
    renderApp('/parties/p1');

    const city = await screen.findByLabelText('Città');
    await user.clear(city);
    await user.type(city, 'Bergamo');
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    expect(await screen.findByText(/Qualcun altro ha modificato/)).toBeInTheDocument();
    // What was typed stays until the person chooses.
    expect(screen.getByLabelText('Città')).toHaveValue('Bergamo');
    const sent = (await api.calls.find((c) => c.method === 'PATCH')!.request.json()) as {
      version: number;
    };
    expect(sent.version).toBe(3);

    latest = party({ city: 'Como', version: 4 });
    await user.click(screen.getByRole('button', { name: 'Ricarica' }));
    await waitFor(() => expect(screen.getByLabelText('Città')).toHaveValue('Como'));
    expect(screen.queryByText(/Qualcun altro ha modificato/)).not.toBeInTheDocument();
  });

  it('asks before leaving with unsaved changes', async () => {
    const user = userEvent.setup();
    mockApi({
      ...signedInWith(),
      'GET /parties/p1': () => json(200, party()),
      'GET /parties': () => json(200, page([party()])),
    });
    const { router } = renderApp('/parties/p1');

    await user.type(await screen.findByLabelText('Note'), 'da richiamare');
    await user.click(screen.getByRole('link', { name: 'Clienti e fornitori' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Uscire senza salvare?');
    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }));
    expect(router.state.location.pathname).toBe('/parties/p1');
    expect(screen.getByLabelText('Note')).toHaveValue('da richiamare');

    await user.click(screen.getByRole('link', { name: 'Clienti e fornitori' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Esci senza salvare',
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/parties'));
  });

  it('asks before choosing another company with unsaved changes', async () => {
    const user = userEvent.setup();
    mockApi({ ...signedInWith(), 'GET /parties/p1': () => json(200, party()) });
    renderApp('/parties/p1');

    await user.type(await screen.findByLabelText('Note'), 'x');
    await user.selectOptions(screen.getByLabelText('Azienda:'), 'Rossi Logistica Srl');

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.getByLabelText('Azienda:')).toHaveValue('c1');
  });

  it('archives after a question that repeats the name', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...signedInWith(),
      'GET /parties/p1': () => json(200, party()),
      'POST /parties/p1/archive': () =>
        json(200, party({ archivedAt: '2026-10-21T09:00:00.000Z', version: 4 })),
    });
    renderApp('/parties/p1');

    await user.click(await screen.findByRole('button', { name: 'Archivia' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Archiviare «Ferramenta Bruni Srl»?');
    await user.click(within(dialog).getByRole('button', { name: 'Archivia' }));

    expect(await screen.findByText(/Questa scheda è archiviata/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ripristina' })).toBeInTheDocument();
    expect(screen.getByLabelText('Ragione sociale')).toBeDisabled();
    const sent = (await api.calls
      .find((c) => c.path === '/parties/p1/archive')!
      .request.json()) as object;
    expect(sent).toEqual({ version: 3 });
  });
});
