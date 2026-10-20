import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { canBypassRowLevelSecurity } from '../prisma/database-role.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { HealthChecksDto, HealthResponseDto } from './health.dto.js';

const DATABASE_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** A health check that never asks the dependencies would only prove the process is alive. */
  async check(): Promise<HealthResponseDto> {
    const checks = await this.inspectDatabase();
    const allUp = Object.values(checks).every((value) => value === 'up');
    return {
      status: allUp ? 'ok' : 'degraded',
      checks,
      version: this.config.appVersion,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * One query answers both questions: the database is reachable, and the API's role cannot
   * bypass Row-Level Security (otherwise tenant isolation would be silently off).
   */
  private async inspectDatabase(): Promise<HealthChecksDto> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('database ping timed out')), DATABASE_TIMEOUT_MS);
    });
    try {
      const bypass = await Promise.race([canBypassRowLevelSecurity(this.prisma), timeout]);
      return { database: 'up', tenantIsolation: bypass ? 'down' : 'up' };
    } catch {
      return { database: 'down', tenantIsolation: 'down' };
    } finally {
      clearTimeout(timer);
    }
  }
}
