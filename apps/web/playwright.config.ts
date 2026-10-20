import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The critical flow in a real browser (docs/conventions.md F19), against the production build:
// the API compiled by Nest serves the web app compiled by Vite, under the /mercurio prefix, as on
// the server. Build both first (see the "browser" job in .github/workflows/ci.yml).
const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // A flaky browser test must be fixed, not retried until it passes.
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'it-IT',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node --env-file-if-exists=../../.env ../api/dist/main.js',
    url: `http://127.0.0.1:${PORT}/mercurio/api/health`,
    reuseExistingServer: false,
    env: {
      HOST: '127.0.0.1',
      PORT: String(PORT),
      APP_BASE_PATH: '/mercurio',
      WEB_DIST_PATH: resolve('dist'),
      LOG_LEVEL: 'warn',
    },
  },
});
