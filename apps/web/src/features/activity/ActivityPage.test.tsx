import { screen } from '@testing-library/react';
import { json, me, mockApi, problem, session } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

const signedIn = {
  'POST /auth/refresh': () => json(200, session('t-rossi')),
  'GET /auth/me': () => json(200, me()),
};

describe('ActivityPage', () => {
  it('lists the events with who did them', async () => {
    mockApi({
      ...signedIn,
      'GET /audit-events': () =>
        json(200, {
          items: [
            {
              id: 'e1',
              at: '2026-10-20T10:00:00.000Z',
              type: 'MEMBER_ADDED',
              source: 'CLI',
              actor: null,
              subjectType: null,
              subjectId: null,
              details: null,
            },
            {
              id: 'e2',
              at: '2026-10-20T11:00:00.000Z',
              type: 'TENANT_SELECTED',
              source: 'API',
              actor: { name: 'Anna Rossi', email: 'a@example.com' },
              subjectType: null,
              subjectId: null,
              details: null,
            },
          ],
          total: 2,
          page: 1,
          pageSize: 25,
        }),
    });
    renderApp('/activity');

    expect(await screen.findByRole('cell', { name: 'Persona aggiunta' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Operatore (terminale)' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Anna Rossi' })).toBeInTheDocument();
  });

  it('shows the empty and the error states', async () => {
    mockApi({
      ...signedIn,
      'GET /audit-events': () => json(200, { items: [], total: 0, page: 1, pageSize: 25 }),
    });
    const { unmount } = renderApp('/activity');
    expect(await screen.findByText('Nessun evento.')).toBeInTheDocument();
    unmount();

    mockApi({ ...signedIn, 'GET /audit-events': () => problem(503, 'SERVICE_UNAVAILABLE') });
    renderApp('/activity');
    expect(await screen.findByRole('alert')).toHaveTextContent('Il servizio non è disponibile');
  });
});
