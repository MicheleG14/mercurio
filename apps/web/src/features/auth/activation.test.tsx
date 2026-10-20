import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { json, mockApi, problem, session } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

const anonymous = { 'POST /auth/refresh': () => problem(401, 'SESSION_EXPIRED') };

describe('activation', () => {
  it('takes the code from the address fragment, never from the query string', async () => {
    mockApi(anonymous);
    renderApp('/activate#the-code-from-the-link');

    expect(await screen.findByLabelText('Codice di attivazione')).toHaveValue(
      'the-code-from-the-link',
    );
  });

  it('checks the two passwords and shows the rule the server applied', async () => {
    const api = mockApi({
      ...anonymous,
      'POST /auth/activate': () =>
        problem(400, 'PASSWORD_TOO_WEAK', [{ field: 'password', code: 'TOO_SIMPLE' }]),
    });
    const user = userEvent.setup();
    renderApp('/activate#code-1');

    await user.type(await screen.findByLabelText('Nuova password'), 'aaaaaaaaaaaab');
    await user.type(screen.getByLabelText('Ripeti la password'), 'different-one');
    await user.click(screen.getByRole('button', { name: 'Imposta la password' }));
    expect(await screen.findByText('Le due password non coincidono.')).toBeInTheDocument();
    expect(api.count('POST /auth/activate')).toBe(0);

    await user.clear(screen.getByLabelText('Ripeti la password'));
    await user.type(screen.getByLabelText('Ripeti la password'), 'aaaaaaaaaaaab');
    await user.click(screen.getByRole('button', { name: 'Imposta la password' }));
    expect(await screen.findByText('Usa caratteri più vari.')).toBeInTheDocument();
  });

  it('enrols the authenticator and requires saving the recovery codes before entering', async () => {
    const api = mockApi({
      ...anonymous,
      'POST /auth/activate': () => json(201, { enrollToken: 'enroll-1' }),
      'POST /auth/mfa/enroll/start': () =>
        json(200, {
          secret: 'JBSWY3DPEHPK3PXP',
          uri: 'otpauth://totp/Mercurio:a?secret=JBSWY3DPEHPK3PXP',
        }),
      'POST /auth/mfa/enroll/confirm': () =>
        json(200, {
          ...session('t-rossi'),
          recoveryCodes: ['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH'],
        }),
      'GET /auth/me': () =>
        json(200, {
          user: { name: 'Anna' },
          tenant: { id: 't-rossi', name: 'Gruppo Rossi' },
          role: 'ADMIN',
          permissions: [],
          modules: [],
          companies: [],
          tenants: [],
        }),
    });
    const user = userEvent.setup();
    renderApp('/activate#code-1');

    await user.type(await screen.findByLabelText('Nuova password'), 'a long enough password');
    await user.type(screen.getByLabelText('Ripeti la password'), 'a long enough password');
    await user.click(screen.getByRole('button', { name: 'Imposta la password' }));

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(screen.getByTitle("Codice QR per l'app di autenticazione")).toBeInTheDocument();
    await user.type(screen.getByLabelText('Codice a 6 cifre'), '123456');
    await user.click(screen.getByRole('button', { name: 'Conferma' }));

    expect(await screen.findByText('AAAA-BBBB-CCCC-DDDD')).toBeInTheDocument();
    const enter = screen.getByRole('button', { name: 'Entra in Mercurio' });
    expect(enter).toBeDisabled();
    await user.click(screen.getByLabelText('Ho salvato i codici in un posto sicuro'));
    await user.click(enter);

    expect(await screen.findByRole('heading', { name: 'Ciao, Anna' })).toBeInTheDocument();
    // The secret was requested once, even with React's double effects in development.
    expect(api.count('POST /auth/mfa/enroll/start')).toBe(1);
  });
});
