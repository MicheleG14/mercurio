import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// The Prisma CLI does not read .env files by itself. The variables live in the repository
// root; in CI and production they are injected by the environment, so the file is optional.
try {
  process.loadEnvFile(resolve(process.cwd(), '../../.env'));
} catch {
  // no .env file: use the variables already in the environment
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Migrations run as the owner role; the API itself connects as mercurio_app (DATABASE_URL).
  datasource: { url: process.env.DATABASE_ADMIN_URL },
});
