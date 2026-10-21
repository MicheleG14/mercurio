import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import i18n from '@/i18n';
import { DESKTOP_WIDTH, screenListeners, screenWidth, setScreenWidth } from './screen';

// The first render of a file goes through sign-in, profile and data, all in jsdom: on a busy machine
// (both apps' tests at once, as in CI) it can take longer than the default second. Waiting longer
// costs nothing when a test passes sooner.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no matchMedia. This one answers width queries against a screen width tests can change
// with setScreenWidth (src/test/screen.ts), desktop by default, and reports a light system theme.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    const width = screenWidth();
    return {
      // Only width queries can match: "prefers-color-scheme: dark" is always false.
      matches:
        Boolean(min || max) &&
        (!min || width >= Number(min[1])) &&
        (!max || width <= Number(max[1])),
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => screenListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        screenListeners.delete(listener),
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    };
  },
});

beforeEach(async () => {
  setScreenWidth(DESKTOP_WIDTH);
  await i18n.changeLanguage('it');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
