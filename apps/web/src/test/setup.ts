import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import i18n from '@/i18n';

// The first render of a file goes through sign-in, profile and data, all in jsdom: on a busy machine
// (both apps' tests at once, as in CI) it can take longer than the default second. Waiting longer
// costs nothing when a test passes sooner.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no matchMedia: report a light system theme.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

beforeEach(async () => {
  await i18n.changeLanguage('it');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
