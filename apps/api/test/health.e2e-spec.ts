import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { APP_CONFIG, type AppConfig } from '../src/config/app-config.js';

// Runs against a real PostgreSQL (docker compose up -d db), as decided in B20.
describe('GET /api/health (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app, app.get<AppConfig>(APP_CONFIG));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the API and the database as up', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);

    expect(res.body).toMatchObject({ status: 'ok', checks: { database: 'up' } });
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('sends the security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    // Domain-wide policy, owned by nginx.
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('rejects unknown routes with 404', async () => {
    await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);
  });
});
