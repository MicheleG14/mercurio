import { api, unwrap } from '@/lib/api-client';
import { json, me, mockApi, problem, session } from '@/test/api-mock';
import { installAuthClient } from './client';
import { sessionStore } from './session';

describe('auth client', () => {
  beforeAll(() => installAuthClient());
  beforeEach(() => sessionStore.signIn(session('t-rossi', 'access-1')));

  it('renews an expired token once for simultaneous requests and repeats each of them', async () => {
    let refreshes = 0;
    const refused = (request: Request) =>
      request.headers.get('Authorization') === 'Bearer access-1';
    const mock = mockApi({
      'POST /auth/refresh': async () => {
        refreshes += 1;
        // Slow enough that both refused requests are waiting for it.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return json(200, session('t-rossi', `access-${refreshes + 1}`));
      },
      'GET /auth/me': (r) => (refused(r) ? problem(401, 'UNAUTHORIZED') : json(200, me())),
      'GET /auth/events': (r) =>
        refused(r)
          ? problem(401, 'UNAUTHORIZED')
          : json(200, { items: [], total: 0, page: 1, pageSize: 10 }),
    });

    const [who, events] = await Promise.all([
      unwrap(api.GET('/auth/me')),
      unwrap(api.GET('/auth/events')),
    ]);

    expect(refreshes).toBe(1);
    expect(who.user.name).toBe('Anna Rossi');
    expect(events.total).toBe(0);
    expect(sessionStore.get().accessToken).toBe('access-2');
    expect(mock.count('GET /auth/me')).toBe(2);
  });

  it('gives up and signs out when the session cannot be renewed', async () => {
    mockApi({
      'POST /auth/refresh': () => problem(401, 'SESSION_EXPIRED'),
      'GET /auth/me': () => problem(401, 'UNAUTHORIZED'),
    });

    await expect(unwrap(api.GET('/auth/me'))).rejects.toMatchObject({ status: 401 });
    expect(sessionStore.get().status).toBe('anonymous');
  });

  it('repeats a refused write with its body intact', async () => {
    const bodies: unknown[] = [];
    mockApi({
      'POST /auth/refresh': () => json(200, session('t-rossi', 'access-2')),
      'POST /auth/password': async (r) => {
        bodies.push(await r.json());
        return r.headers.get('Authorization') === 'Bearer access-1'
          ? problem(401, 'UNAUTHORIZED')
          : new Response(null, { status: 204 });
      },
    });
    const body = { currentPassword: 'old-password-here', newPassword: 'new-password-here' };

    await unwrap(api.POST('/auth/password', { body, parseAs: 'text' }));

    expect(bodies).toEqual([body, body]);
  });
});
