import { useSyncExternalStore } from 'react';

/**
 * Forms with changes not saved yet, for the actions that would lose them without changing the
 * address: choosing another company or signing out (docs/proposta-saas.md, protection 2).
 * Changes of address are stopped by the router's blocker in UnsavedChangesGuard.
 */
const dirtyForms = new Set<symbol>();
const listeners = new Set<() => void>();
let pending: (() => void) | null = null;

const notify = () => listeners.forEach((listener) => listener());

export const unsavedChanges = {
  /** Called by a form whenever its state changes. */
  setDirty: (form: symbol, dirty: boolean) => {
    if (dirty) dirtyForms.add(form);
    else dirtyForms.delete(form);
  },

  hasChanges: () => dirtyForms.size > 0,

  /** Runs the action now, or once the person confirms that the changes may be lost. */
  requestLeave: (action: () => void) => {
    if (dirtyForms.size === 0) return action();
    pending = action;
    notify();
  },

  confirm: () => {
    const action = pending;
    pending = null;
    dirtyForms.clear();
    notify();
    action?.();
  },

  cancel: () => {
    pending = null;
    notify();
  },

  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Whether an action is waiting for the person to confirm leaving unsaved changes. */
export function useLeaveRequested(): boolean {
  return useSyncExternalStore(unsavedChanges.subscribe, () => pending !== null);
}
