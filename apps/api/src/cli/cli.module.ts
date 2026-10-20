import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from '../config/app-config.js';
import { IdentityModule } from '../modules/identity/index.js';
import { TenancyModule } from '../modules/tenancy/index.js';
import { PrismaModule } from '../prisma/index.js';

/**
 * Terminal commands connect as the owner role (DATABASE_ADMIN_URL), never with the API's
 * credentials: creating tenants and users is a platform operation, outside any tenant
 * (docs/conventions.md B26). The API never receives this URL.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => {
        const adminUrl = process.env.DATABASE_ADMIN_URL;
        if (!adminUrl)
          throw new Error('DATABASE_ADMIN_URL is not set: commands run as the owner role');
        return loadConfig({ ...process.env, DATABASE_URL: adminUrl });
      },
    },
  ],
  exports: [APP_CONFIG],
})
class CliConfigModule {}

/** What terminal commands need: no HTTP server, no logger middleware, no static files. */
@Module({ imports: [CliConfigModule, PrismaModule, TenancyModule, IdentityModule] })
export class CliModule {}
