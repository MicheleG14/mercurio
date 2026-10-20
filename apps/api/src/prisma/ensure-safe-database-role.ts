import type { INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { AppConfig } from '../config/app-config.js';
import { canBypassRowLevelSecurity, ROLE_BYPASSES_RLS_MESSAGE } from './database-role.js';
import { PrismaService } from './prisma.service.js';

/**
 * Called once before the API starts listening. In production a role that bypasses
 * Row-Level Security stops the start: a clear failure is better than isolation silently off.
 * Elsewhere it only warns, so a misconfigured development database is still usable.
 * Terminal commands connect as the owner on purpose and never call this.
 */
export async function ensureSafeDatabaseRole(
  app: INestApplication,
  config: AppConfig,
): Promise<void> {
  if (!(await canBypassRowLevelSecurity(app.get(PrismaService)))) return;
  if (config.isProduction) throw new Error(ROLE_BYPASSES_RLS_MESSAGE);
  app.get(Logger).warn(ROLE_BYPASSES_RLS_MESSAGE);
}
