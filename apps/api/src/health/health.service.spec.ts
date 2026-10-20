import { loadConfig } from '../config/app-config.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { HealthService } from './health.service.js';

const config = loadConfig({
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  APP_VERSION: '1.2.3',
});

// The health query returns whether the role could bypass Row-Level Security.
const safeRole = () => Promise.resolve([{ bypass: false }]);

function serviceWith(queryRaw: () => Promise<unknown>): HealthService {
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  return new HealthService(prisma, config);
}

describe('HealthService', () => {
  it('reports ok when the database answers with a safe role', async () => {
    const report = await serviceWith(safeRole).check();

    expect(report).toMatchObject({
      status: 'ok',
      checks: { database: 'up', tenantIsolation: 'up' },
      version: '1.2.3',
    });
  });

  it('reports degraded when the role could bypass Row-Level Security', async () => {
    const report = await serviceWith(() => Promise.resolve([{ bypass: true }])).check();

    expect(report).toMatchObject({
      status: 'degraded',
      checks: { database: 'up', tenantIsolation: 'down' },
    });
  });

  it('treats a role it cannot inspect as unsafe', async () => {
    const report = await serviceWith(() => Promise.resolve([])).check();

    expect(report.checks.tenantIsolation).toBe('down');
  });

  it('reports degraded when the database fails', async () => {
    const report = await serviceWith(() => Promise.reject(new Error('connection refused'))).check();

    expect(report).toMatchObject({
      status: 'degraded',
      checks: { database: 'down', tenantIsolation: 'down' },
    });
  });

  it('reports degraded when the database does not answer in time', async () => {
    vi.useFakeTimers();
    try {
      const pending = serviceWith(() => new Promise(() => undefined)).check();
      await vi.advanceTimersByTimeAsync(2_000);

      await expect(pending).resolves.toMatchObject({ status: 'degraded' });
    } finally {
      vi.useRealTimers();
    }
  });
});
