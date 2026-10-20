import { useSyncExternalStore } from 'react';
import type { components } from '@/api/schema';

export type TenantChoice = components['schemas']['TenantChoiceDto'];

/** What the browser knows about the session. The access token lives in memory only. */
export interface SessionState {
  /** loading: asking the server whether a session exists (page load). */
  status: 'loading' | 'authenticated' | 'anonymous';
  accessToken: string | null;
  tenantId: string | null;
  tenants: TenantChoice[];
}

let state: SessionState = { status: 'loading', accessToken: null, tenantId: null, tenants: [] };
const listeners = new Set<() => void>();

function set(next: SessionState): void {
  state = next;
  for (const listener of listeners) listener();
}

export const sessionStore = {
  get: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Stores the body of any response that carries a session (login, refresh, tenant choice). */
  signIn(body: Pick<components['schemas']['SessionDto'], 'accessToken' | 'tenantId' | 'tenants'>) {
    set({
      status: 'authenticated',
      accessToken: body.accessToken,
      tenantId: body.tenantId,
      tenants: body.tenants,
    });
  },
  signOut() {
    set({ status: 'anonymous', accessToken: null, tenantId: null, tenants: [] });
  },
  /** For tests. */
  reset() {
    set({ status: 'loading', accessToken: null, tenantId: null, tenants: [] });
  },
};

export function useSession(): SessionState {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get);
}
