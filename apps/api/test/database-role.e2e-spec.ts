import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, type AppConfig } from '../src/config/app-config.js';
import { canBypassRowLevelSecurity } from '../src/prisma/database-role.js';
import { ensureSafeDatabaseRole } from '../src/prisma/ensure-safe-database-role.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Tenant isolation relies on Row-Level Security, which superusers and BYPASSRLS roles ignore.
// These tests prove the API runs as a role subject to it, and refuses to start otherwise.
async function appConnectedAs(databaseUrl: string): Promise<NestExpressApplication> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    await app.init();
    return app;
  } finally {
    process.env.DATABASE_URL = previous;
  }
}

describe('database role (e2e)', () => {
  it('the API role (DATABASE_URL) cannot bypass Row-Level Security', async () => {
    const app = await appConnectedAs(process.env.DATABASE_URL!);
    try {
      await expect(canBypassRowLevelSecurity(app.get(PrismaService))).resolves.toBe(false);
      const config = app.get<AppConfig>(APP_CONFIG);
      await expect(ensureSafeDatabaseRole(app, { ...config, isProduction: true })).resolves.toBe(
        undefined,
      );
    } finally {
      await app.close();
    }
  });

  it('refuses to start in production with the owner role', async () => {
    const app = await appConnectedAs(process.env.DATABASE_ADMIN_URL!);
    try {
      await expect(canBypassRowLevelSecurity(app.get(PrismaService))).resolves.toBe(true);
      const config = app.get<AppConfig>(APP_CONFIG);
      await expect(ensureSafeDatabaseRole(app, { ...config, isProduction: true })).rejects.toThrow(
        /Row-Level Security/,
      );
    } finally {
      await app.close();
    }
  });
});
