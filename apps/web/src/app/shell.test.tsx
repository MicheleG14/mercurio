import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { json, me, mockApi, session } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';
import { PHONE_WIDTH, setScreenWidth, TABLET_WIDTH } from '@/test/screen';
import { visibleNavigation } from './navigation';

const signedIn = (overrides: Record<string, unknown> = {}) => ({
  'POST /auth/refresh': () => json(200, session('t-rossi')),
  'GET /auth/me': () => json(200, me(overrides)),
});

describe('navigation', () => {
  it('shows only the items the person may see, in the tenant modules, without empty groups', () => {
    const labels = (groups: ReturnType<typeof visibleNavigation>) =>
      groups.flatMap((g) => g.items.map((i) => i.label));

    expect(
      labels(visibleNavigation({ permissions: ['parties:read'], modules: ['registry'] })),
    ).toEqual(['home', 'parties']);
    expect(
      labels(visibleNavigation({ permissions: ['parties:read', 'audit:read'], modules: [] })),
    ).toEqual(['home', 'activity']);
    expect(
      visibleNavigation({ permissions: [], modules: ['registry'] }).map((g) => g.label),
    ).toEqual([undefined]);
  });
});

describe('app shell', () => {
  beforeEach(() => localStorage.clear());

  it('on a desktop: a sidebar grouped by module, with the person and the context', async () => {
    mockApi(signedIn());
    renderApp('/');

    const menu = await screen.findByRole('navigation', { name: 'Menu principale' });
    expect(within(menu).getByText('Anagrafiche')).toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'Clienti e fornitori' })).toBeInTheDocument();
    expect(within(menu).getByText('Amministrazione')).toBeInTheDocument();
    const footer = screen.getByText('Anna Rossi').closest('[data-slot="sidebar-footer"]')!;
    expect(footer).toHaveTextContent('Amministratore');
    expect(screen.getByLabelText('Azienda:')).toHaveValue('c1');
    // On a desktop the menu is always there: no button to open it.
    expect(screen.queryByRole('button', { name: 'Apri il menu' })).not.toBeInTheDocument();
  });

  it('remembers a collapsed sidebar, and opens it again from the same button', async () => {
    const user = userEvent.setup();
    mockApi(signedIn());
    const { unmount } = renderApp('/');

    await user.click(await screen.findByRole('button', { name: 'Riduci o espandi il menu' }));
    expect(localStorage.getItem('mercurio.sidebar')).toBe('collapsed');
    unmount();

    mockApi(signedIn());
    const { container } = renderApp('/');
    await screen.findByRole('navigation', { name: 'Menu principale' });
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar).toHaveAttribute('data-state', 'collapsed');

    // Collapsed, the button is still there (it is the only way back) and says the menu is closed.
    const toggle = screen.getByRole('button', { name: 'Riduci o espandi il menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(sidebar).toHaveAttribute('data-state', 'expanded');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(localStorage.getItem('mercurio.sidebar')).toBe('expanded');
  });

  it('on a tablet: icons only, and the whole menu in a panel over the content', async () => {
    setScreenWidth(TABLET_WIDTH);
    const user = userEvent.setup();
    mockApi(signedIn());
    const { container } = renderApp('/');

    await screen.findByRole('navigation', { name: 'Menu principale' });
    expect(container.querySelector('[data-slot="sidebar"]')).toHaveAttribute(
      'data-collapsible',
      'icon',
    );
    await user.click(screen.getByRole('button', { name: 'Apri il menu' }));
    const panel = await screen.findByRole('dialog', { name: 'Menu principale' });
    expect(within(panel).getByRole('link', { name: 'Articoli' })).toBeInTheDocument();
  });

  it('on a phone: the context in the top bar, the menu in a panel that closes after a choice', async () => {
    setScreenWidth(PHONE_WIDTH);
    const user = userEvent.setup();
    mockApi({
      ...signedIn(),
      'GET /parties': () => json(200, { items: [], total: 0, page: 1, pageSize: 25 }),
    });
    const { router } = renderApp('/');

    expect(await screen.findByText('Gruppo Rossi · Rossi Srl')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Menu principale' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apri il menu' }));
    const panel = await screen.findByRole('dialog', { name: 'Menu principale' });
    // The context moves into the panel, with the company choice.
    expect(within(panel).getByLabelText('Azienda:')).toBeInTheDocument();
    await user.click(within(panel).getByRole('link', { name: 'Clienti e fornitori' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/parties'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Menu principale' })).not.toBeInTheDocument(),
    );
  });

  it('shows the registry only to tenants that enabled it', async () => {
    mockApi(signedIn({ modules: ['warehouse'] }));
    renderApp('/');
    const menu = await screen.findByRole('navigation', { name: 'Menu principale' });
    expect(within(menu).queryByText('Anagrafiche')).not.toBeInTheDocument();
  });
});
