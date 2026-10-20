import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { TenantContextService } from './tenant-context.js';
import { TenantDatabase } from './tenant-database.js';
import { UserDatabase } from './user-database.js';

/**
 * Database access for the whole application. Modules work on tenant data through
 * TenantDatabase; PrismaService is the raw client, used for checks without tenant context.
 */
@Global()
@Module({
  providers: [PrismaService, TenantContextService, TenantDatabase, UserDatabase],
  exports: [PrismaService, TenantContextService, TenantDatabase, UserDatabase],
})
export class PrismaModule {}
