import { useSyncExternalStore } from 'react';

/**
 * The three layouts of the interface (docs/conventions.md F20): phone below 768 px, tablet up to
 * 1023 px, desktop from 1024 px, the `md` and `lg` breakpoints of Tailwind. Components that change
 * structure (not only style) with the screen ask here, so there is one definition of each size.
 */
export type Breakpoint = 'phone' | 'tablet' | 'desktop';

const TABLET = '(min-width: 768px)';
const DESKTOP = '(min-width: 1024px)';

function current(): Breakpoint {
  if (window.matchMedia(DESKTOP).matches) return 'desktop';
  if (window.matchMedia(TABLET).matches) return 'tablet';
  return 'phone';
}

function subscribe(onChange: () => void): () => void {
  const queries = [window.matchMedia(TABLET), window.matchMedia(DESKTOP)];
  queries.forEach((query) => query.addEventListener('change', onChange));
  return () => queries.forEach((query) => query.removeEventListener('change', onChange));
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, current);
}
