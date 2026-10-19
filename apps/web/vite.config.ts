import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Same rule as the API: "/mercurio/" -> "/mercurio", "/" or "" -> "" (root). */
function normaliseBasePath(value = ''): string {
  return value.trim().replace(/\/+$/, '');
}

export default defineConfig(({ mode }) => {
  // The web app reads the same root .env as the API, so both agree on the base path.
  const env = { ...loadEnv(mode, repoRoot, ''), ...process.env };
  const basePath = normaliseBasePath(env.APP_BASE_PATH);

  return {
    base: `${basePath}/`,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      // In development the API runs on its own port: Vite forwards /api to it (same origin for the browser).
      proxy: {
        [`${basePath}/api`]: { target: `http://127.0.0.1:${env.PORT ?? 3000}` },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
