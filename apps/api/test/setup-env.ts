import { resolve } from 'node:path';

// e2e tests talk to a real database. Locally the connection comes from the root .env;
// in CI it is injected as an environment variable. The base path is forced to the root.
try {
  process.loadEnvFile(resolve(import.meta.dirname, '../../../.env'));
} catch {
  // no .env file: use the variables already in the environment
}
process.env.NODE_ENV = 'test';
process.env.APP_BASE_PATH = '';
process.env.LOG_LEVEL = 'silent';
