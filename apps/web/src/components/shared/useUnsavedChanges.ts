import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router';
import { unsavedChanges } from '@/lib/unsaved-changes';

/**
 * Protects a form's unsaved changes (F12): leaving the page by a link, the back button, closing
 * the tab, choosing another company or signing out asks first. Returns `leave`, to navigate on
 * purpose (after saving) without being asked. Render UnsavedChangesDialog with the blocker.
 */
export function useUnsavedChanges(isDirty: boolean) {
  const [form] = useState(() => Symbol('form'));
  const bypass = useRef(false);

  useEffect(() => {
    unsavedChanges.setDirty(form, isDirty);
  }, [form, isDirty]);
  useEffect(() => () => unsavedChanges.setDirty(form, false), [form]);

  // Closing or reloading the tab: the browser shows its own question.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && !bypass.current && currentLocation.pathname !== nextLocation.pathname,
  );

  const leave = useCallback(
    (navigate: () => void) => {
      bypass.current = true;
      unsavedChanges.setDirty(form, false);
      navigate();
      // The router checks blockers when the navigation starts; let it start first.
      setTimeout(() => {
        bypass.current = false;
      });
    },
    [form],
  );

  return { blocker, leave };
}
