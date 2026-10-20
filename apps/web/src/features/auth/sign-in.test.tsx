import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { json, me, mockApi, problem, session } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

describe('signing in', () => {
  it('sends a visitor without a session to the login page', async () => {
    mockApi({ 'POST /auth/refresh': () => problem(401, 'SESSION_EXPIRED') });
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Accedi a Mercurio' })).toBeInTheDocument();
  });

  it('goes from password to code to the overview', async () => {
    const api = mockApi({
      'POST /auth/refresh': () => problem(401, 'SESSION_EXPIRED'),
      'POST /auth/login': () => json(200, { status: 'MFA_REQUIRED', token: 'challenge-1' }),
      'POST /auth/mfa/verify': () => json(200, session('t-rossi')),
      'GET /auth/me': () => json(200, me()),
    });
    const user = userEvent.setup();
    renderApp('/login');

    await user.type(await screen.findByLabelText('Email'), 'anna.rossi@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Accedi' }));

    const code = await screen.findByLabelText('Codice');
    await user.type(code, '12345');
    await user.click(screen.getByRole('button', { name: 'Verifica' }));
    expect(await screen.findByText('Inserisci il codice a 6 cifre.')).toBeInTheDocument();
    expect(api.count('POST /auth/mfa/verify')).toBe(0);

    await user.type(code, '6');
    await user.click(screen.getByRole('button', { name: 'Verifica' }));

    expect(await screen.findByRole('heading', { name: 'Ciao, Anna Rossi' })).toBeInTheDocument();
    const verify = api.calls.find((c) => c.path === '/auth/mfa/verify')!;
    expect(await verify.request.json()).toEqual({ challengeToken: 'challenge-1', code: '123456' });
  });

  it('shows the translated reason of a refusal', async () => {
    mockApi({
      'POST /auth/refresh': () => problem(401, 'SESSION_EXPIRED'),
      'POST /auth/login': () => problem(401, 'INVALID_CREDENTIALS'),
    });
    const user = userEvent.setup();
    renderApp('/login');

    await user.type(await screen.findByLabelText('Email'), 'anna.rossi@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Accedi' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email o password non corrette.');
  });

  it('asks which customer to open when there are several', async () => {
    const api = mockApi({
      'POST /auth/refresh': () => json(200, session(null)),
      'POST /auth/tenant': () => json(200, session('t-bianchi', 'access-2')),
      'GET /auth/me': () =>
        json(200, me({ tenant: { id: 't-bianchi', name: 'Bianchi Snc', slug: 'bianchi' } })),
    });
    const user = userEvent.setup();
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Scegli il cliente' })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Apri' })[1]!);

    expect(await screen.findByText(/Stai lavorando su Bianchi Snc/)).toBeInTheDocument();
    const choice = api.calls.find((c) => c.path === '/auth/tenant')!;
    expect(await choice.request.json()).toEqual({ tenantId: 't-bianchi' });
  });

  it('never sends the access token to the sign-in routes', async () => {
    const api = mockApi({
      'POST /auth/refresh': () => json(200, session('t-rossi')),
      'GET /auth/me': () => json(200, me()),
    });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Ciao, Anna Rossi' });

    const meCall = api.calls.find((c) => c.path === '/auth/me')!;
    const refreshCall = api.calls.find((c) => c.path === '/auth/refresh')!;
    expect(meCall.request.headers.get('Authorization')).toBe('Bearer access-1');
    expect(refreshCall.request.headers.get('Authorization')).toBeNull();
  });
});

describe('the session in use', () => {
  it('signs the person out when the session cannot be renewed', async () => {
    let first = true;
    mockApi({
      'POST /auth/refresh': () => {
        const answer = first ? json(200, session('t-rossi')) : problem(401, 'SESSION_EXPIRED');
        first = false;
        return answer;
      },
      'GET /auth/me': () => problem(401, 'SESSION_EXPIRED'),
    });
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Accedi a Mercurio' })).toBeInTheDocument();
  });
});

describe('the signed-in shell', () => {
  it('shows the company selector only when there is more than one company', async () => {
    const api = mockApi({
      'POST /auth/refresh': () => json(200, session('t-rossi')),
      'GET /auth/me': () => json(200, me()),
    });
    const user = userEvent.setup();
    renderApp('/');

    const select = await screen.findByLabelText('Azienda:');
    await user.selectOptions(select, 'c2');
    await waitFor(() => {
      const last = api.calls.filter((c) => c.path === '/auth/me').at(-1)!;
      expect(last.request.headers.get('X-Company-Id')).toBe('c2');
    });
  });

  it('shows the single company as text, and hides Activity without the permission', async () => {
    mockApi({
      'POST /auth/refresh': () => json(200, session('t-rossi')),
      'GET /auth/me': () =>
        json(
          200,
          me({
            role: 'READ_ONLY',
            permissions: ['registry:read'],
            companies: [{ id: 'c1', legalName: 'Rossi Srl', vatNumber: '02746510960' }],
          }),
        ),
    });
    renderApp('/');

    expect(await screen.findByText('Rossi Srl')).toBeInTheDocument();
    expect(screen.queryByLabelText('Azienda:')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Attività' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Il mio account' })).toBeInTheDocument();
  });
});
