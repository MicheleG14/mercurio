import type { Middleware } from 'openapi-fetch';
import { api, unwrap } from '@/lib/api-client';
import { companyStore } from './company';
import { sessionStore } from './session';

const REFRESH_LOCK = 'mercurio-refresh';
// Routes that never carry an access token, so a 401 from them is an answer, not an expired session.
const PUBLIC_PATHS = ['/auth/activate', '/auth/login', '/auth/mfa/', '/auth/refresh'];

let refreshing: Promise<boolean> | null = null;

/**
 * Asks the server for a new access token using the refresh cookie. Returns whether a session
 * exists. Calls from the same tab share one request; between tabs, the Web Locks API takes turns,
 * because every refresh replaces the cookie that all tabs share (a second, simultaneous refresh
 * with the old cookie would look like a stolen token and close the session).
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= withLock(async () => {
    const { data, response } = await api.POST('/auth/refresh');
    if (response.ok && data) {
      sessionStore.signIn(data);
      return true;
    }
    sessionStore.signOut();
    return false;
  }).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function withLock<T>(work: () => Promise<T>): Promise<T> {
  return typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(REFRESH_LOCK, work)
    : work();
}

const isPublic = (url: string) => PUBLIC_PATHS.some((path) => new URL(url).pathname.includes(path));

/**
 * Adds the access token and the company to every request, and when the server answers 401 to a
 * request that carried a token, renews the session once and repeats the request.
 */
// A request body can be read once, so a copy is kept until the answer arrives, to be able to repeat it.
const copies = new Map<string, Request>();

const authMiddleware: Middleware = {
  onRequest({ request, id }) {
    const { accessToken } = sessionStore.get();
    if (accessToken && !isPublic(request.url)) {
      request.headers.set('Authorization', `Bearer ${accessToken}`);
    }
    const companyId = companyStore.get();
    if (companyId) request.headers.set('X-Company-Id', companyId);
    copies.set(id, request.clone());
    return request;
  },
  async onResponse({ request, response, id }) {
    const copy = copies.get(id);
    copies.delete(id);
    if (response.status !== 401 || isPublic(request.url) || !copy) return undefined;
    if (!request.headers.has('Authorization')) return undefined;
    if (!(await refreshSession())) return undefined;

    const retry = copy;
    retry.headers.set('Authorization', `Bearer ${sessionStore.get().accessToken}`);
    return fetch(retry);
  },
  onError({ id }) {
    copies.delete(id);
  },
};

let installed = false;
export function installAuthClient(): void {
  if (installed) return;
  installed = true;
  api.use(authMiddleware);
}

/** Signs out on the server (best effort) and forgets everything in the browser. */
export async function signOut(everywhere = false): Promise<void> {
  try {
    await unwrap(everywhere ? api.POST('/auth/logout-all') : api.POST('/auth/logout'));
  } catch {
    // The session may already be gone on the server: the browser forgets it either way.
  }
  sessionStore.signOut();
  companyStore.clear();
}

let started = false;

/** Asks once per page load whether a session exists (the access token lives in memory only). */
export function startSessionOnce(): void {
  if (started) return;
  started = true;
  void refreshSession();
}

/** For tests: forgets that the page already asked. */
export function resetSessionStart(): void {
  started = false;
  sessionStore.reset();
}
