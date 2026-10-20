import { useSyncExternalStore } from 'react';

// The company is a working context, not a form field (proposta-saas.md, sezione 4): each browser
// tab keeps its own choice (sessionStorage); the last one used (localStorage) is where a new tab
// starts. Storage can be unavailable (private windows): the app then simply starts on the first
// company every time.
const TAB_KEY = 'mercurio.company';
const lastKey = (tenantId: string) => `mercurio.lastCompany.${tenantId}`;

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string): void {
  try {
    storage().setItem(key, value);
  } catch {
    // ignore: see above
  }
}

let current: string | null = null;
const listeners = new Set<() => void>();

export const companyStore = {
  get: () => current,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Picks the company to work on among those the person can reach. */
  initialise(tenantId: string, reachable: readonly string[]) {
    const candidates = [
      current,
      read(() => sessionStorage, `${TAB_KEY}.${tenantId}`),
      read(() => localStorage, lastKey(tenantId)),
    ];
    const chosen = candidates.find((id) => id && reachable.includes(id)) ?? reachable[0] ?? null;
    companyStore.choose(tenantId, chosen);
  },
  choose(tenantId: string, companyId: string | null) {
    current = companyId;
    if (companyId) {
      write(() => sessionStorage, `${TAB_KEY}.${tenantId}`, companyId);
      write(() => localStorage, lastKey(tenantId), companyId);
    }
    for (const listener of listeners) listener();
  },
  clear() {
    current = null;
    for (const listener of listeners) listener();
  },
};

export function useCompanyId(): string | null {
  return useSyncExternalStore(companyStore.subscribe, companyStore.get);
}
