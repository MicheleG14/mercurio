import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { builtinRole } from '@/lib/auth/role';
import { json, me, mockApi, problem, session } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';
import type { CustomRole, Member, PermissionInfo, RoleList } from './queries';

// People and roles administered from the interface (phase 7).

const ADMIN = ['members:read', 'members:manage', 'roles:manage', 'companies:manage'];

const member = (overrides: Partial<Member> = {}): Member => ({
  id: 'm2',
  email: 'sara.neri@example.com',
  name: 'Sara Neri',
  role: builtinRole('ACCOUNTANT'),
  allCompanies: true,
  companyIds: [],
  status: 'ACTIVE',
  canIssueCode: false,
  isSelf: false,
  lastSeenAt: '2026-11-05T09:00:00.000Z',
  version: 1,
  createdAt: '2026-10-20T08:00:00.000Z',
  ...overrides,
});

const custom = (overrides: Partial<CustomRole> = {}): CustomRole => ({
  id: 'r1',
  name: 'Commerciale',
  description: 'Clienti e ordini',
  permissions: ['parties:read', 'parties:write'],
  basedOn: null,
  members: 0,
  version: 1,
  archivedAt: null,
  updatedAt: '2026-11-06T08:00:00.000Z',
  ...overrides,
});

const roles = (customRoles: CustomRole[] = []): RoleList => ({
  builtin: [
    { key: 'ADMIN', permissions: ['parties:read', 'members:manage'], members: 1 },
    { key: 'WAREHOUSE_KEEPER', permissions: ['parties:read'], members: 0 },
    { key: 'ACCOUNTANT', permissions: ['parties:read', 'invoicing:read'], members: 1 },
    { key: 'READ_ONLY', permissions: ['parties:read'], members: 0 },
  ],
  custom: customRoles,
});

const info = (
  key: PermissionInfo['key'],
  module: string | null,
  requires: string[] = [],
  extra: Partial<PermissionInfo> = {},
): PermissionInfo => ({ key, module, moduleEnabled: true, requires, reserved: false, ...extra });

const catalog = {
  permissions: [
    info('parties:read', 'registry'),
    info('parties:write', 'registry', ['parties:read']),
    info('invoicing:read', 'invoicing', [], { moduleEnabled: false }),
    info('invoicing:write', 'invoicing', ['invoicing:read'], { moduleEnabled: false }),
    info('members:read', null),
    info('members:manage', null, ['members:read'], { reserved: true }),
  ],
};

const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 25 });

const signedIn = (permissions = ADMIN) => ({
  'POST /auth/refresh': () => json(200, session('t-rossi')),
  'GET /auth/me': () => json(200, me({ permissions })),
  'GET /roles': () => json(200, roles([custom()])),
  'GET /roles/catalog': () => json(200, catalog),
});

describe('people', () => {
  it('adds a colleague and shows their activation code once, with a message to copy', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...signedIn(),
      'GET /members': () =>
        json(
          200,
          page([
            member({ id: 'm1', name: 'Anna Rossi', email: 'anna.rossi@example.com', isSelf: true }),
          ]),
        ),
      'POST /members': () =>
        json(201, {
          member: member({ id: 'm3', name: 'Elena Ferri', status: 'PENDING_ACTIVATION' }),
          activation: { code: 'CODE-123', expiresAt: '2026-11-13T09:00:00.000Z' },
          existingAccount: false,
        }),
    });
    renderApp('/members');

    // The name is in the side bar too: the row is found by email.
    const self = (await screen.findByText('anna.rossi@example.com')).closest('tr')!;
    expect(within(self).getByText('Sei tu')).toBeInTheDocument();
    expect(within(self).queryByRole('button', { name: 'Rimuovi' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Aggiungi persona' }));
    await user.type(screen.getByLabelText('Email'), 'elena.ferri@example.com');
    await user.type(screen.getByLabelText('Nome e cognome'), 'Elena Ferri');
    await user.selectOptions(screen.getByLabelText('Ruolo'), 'Commerciale');
    await user.click(screen.getByRole('radio', { name: 'Solo le aziende scelte' }));
    await user.click(screen.getByRole('checkbox', { name: 'Rossi Logistica Srl' }));
    await user.click(screen.getAllByRole('button', { name: 'Aggiungi persona' }).at(-1)!);

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByTestId('activation-code').textContent).toBe('CODE-123');
    expect(within(dialog).getByText(/13\/11\/2026/)).toBeInTheDocument();
    const body = await api.calls
      .find((c) => c.method === 'POST' && c.path === '/members')!
      .request.json();
    expect(body).toEqual({
      email: 'elena.ferri@example.com',
      name: 'Elena Ferri',
      role: { customRoleId: 'r1' },
      allCompanies: false,
      companyIds: ['c2'],
    });
    await user.click(within(dialog).getByRole('button', { name: 'Chiudi' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('says when the person already has an account, without a code', async () => {
    const user = userEvent.setup();
    mockApi({
      ...signedIn(),
      'GET /members': () => json(200, page([])),
      'POST /members': () =>
        json(201, {
          member: member({ id: 'm4', email: 'paola.conti@example.com', name: 'Paola Conti' }),
          activation: null,
          existingAccount: true,
        }),
    });
    renderApp('/members');

    await user.click(await screen.findByRole('button', { name: 'Aggiungi persona' }));
    await user.type(screen.getByLabelText('Email'), 'paola.conti@example.com');
    await user.type(screen.getByLabelText('Nome e cognome'), 'Paola');
    await user.click(screen.getAllByRole('button', { name: 'Aggiungi persona' }).at(-1)!);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'paola.conti@example.com ha già un account Mercurio',
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('offers a new code only to who is waiting for activation, and explains a refused change', async () => {
    const user = userEvent.setup();
    mockApi({
      ...signedIn(),
      'GET /members': () =>
        json(
          200,
          page([
            member(),
            member({
              id: 'm5',
              name: 'Giulia Moretti',
              status: 'PENDING_ACTIVATION',
              canIssueCode: true,
            }),
          ]),
        ),
      'POST /members/m2/remove': () => problem(409, 'LAST_ADMIN'),
    });
    renderApp('/members');

    const sara = (await screen.findByText('Sara Neri')).closest('tr')!;
    expect(within(sara).queryByRole('button', { name: 'Nuovo codice' })).not.toBeInTheDocument();
    const giulia = screen.getByText('Giulia Moretti').closest('tr')!;
    expect(within(giulia).getByText('In attesa di attivazione')).toBeInTheDocument();
    expect(within(giulia).getByRole('button', { name: 'Nuovo codice' })).toBeInTheDocument();

    await user.click(within(sara).getByRole('button', { name: 'Rimuovi' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Rimuovi' }),
    );
    expect(await screen.findByText(/resterebbe senza amministratori/)).toBeInTheDocument();
  });

  it('is read only without members:manage', async () => {
    mockApi({ ...signedIn(['members:read']), 'GET /members': () => json(200, page([member()])) });
    renderApp('/members');

    await screen.findByText('Sara Neri');
    expect(screen.queryByRole('button', { name: 'Aggiungi persona' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifica' })).not.toBeInTheDocument();
  });
});

describe('roles', () => {
  it('duplicates a built-in role into an editable one, never with reserved permissions', async () => {
    const user = userEvent.setup();
    const api = mockApi({ ...signedIn(), 'POST /roles': () => json(201, custom({ id: 'r2' })) });
    renderApp('/roles');

    // The role is in the side bar too, under the person's name: take the card.
    await screen.findByText('Magazziniere');
    const admin = screen
      .getAllByText('Amministratore')
      .map((e) => e.closest('[data-slot="card"]'))
      .find(Boolean) as HTMLElement;
    await user.click(within(admin).getByRole('button', { name: 'Duplica' }));
    expect(screen.getByLabelText('Nome')).toHaveValue('Amministratore (copia)');
    const manage = await screen.findByRole('checkbox', { name: /Aggiungere e gestire le persone/ });
    expect(manage).not.toBeChecked();
    expect(manage).toHaveAttribute('data-disabled');
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    await waitFor(() => expect(api.count('POST /roles')).toBe(1));
    const body = await api.calls
      .find((c) => c.path === '/roles' && c.method === 'POST')!
      .request.json();
    expect(body).toMatchObject({
      name: 'Amministratore (copia)',
      permissions: ['parties:read'],
      basedOn: 'ADMIN',
    });
  });

  it('ticks what a permission needs and marks the modules not enabled', async () => {
    const user = userEvent.setup();
    mockApi(signedIn());
    renderApp('/roles');

    await user.click(await screen.findByRole('button', { name: 'Nuovo ruolo' }));
    expect(
      screen.getByText('Modulo non attivo: il permesso varrà quando sarà attivato'),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('checkbox', { name: /Preparare bozze di fattura/ }));
    expect(screen.getByRole('checkbox', { name: /Vedere fatture e scadenze/ })).toBeChecked();
    expect(screen.getByText('Serve a: Preparare bozze di fattura')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Vedere fatture e scadenze/ }));
    expect(screen.getByRole('checkbox', { name: /Preparare bozze di fattura/ })).not.toBeChecked();
  });

  it('cannot archive a role someone holds', async () => {
    mockApi({ ...signedIn(), 'GET /roles': () => json(200, roles([custom({ members: 2 })])) });
    renderApp('/roles');

    const card = (await screen.findByText('Commerciale')).closest(
      '[data-slot="card"]',
    ) as HTMLElement;
    expect(within(card).getByRole('button', { name: 'Archivia' })).toBeDisabled();
    expect(within(card).getByText(/Lo hanno 2 persone/)).toBeInTheDocument();
  });
});
