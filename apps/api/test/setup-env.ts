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
// Fixed secrets for the tests only (the application refuses to start without them).
process.env.AUTH_JWT_SECRET = 'test-only-jwt-secret-0123456789abcdef0123456789abcdef';
process.env.MFA_ENCRYPTION_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
// The rate limit of the sign-in routes is high so that tests can sign in freely; the test of the
// limit itself builds its own application with a low one.
process.env.AUTH_RATE_LIMIT_PER_MINUTE = '10000';
