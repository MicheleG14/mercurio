import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { APP_CONFIG, type AppConfig } from '../src/config/app-config.js';

// The API serves the built web app under the base path, as in production.
// Built with NestFactory like main.ts: ServeStaticModule needs the HTTP adapter to exist
// while modules initialise, which Test.createTestingModule().compile() does not provide.
describe('web app served by the API (e2e)', () => {
  let app: NestExpressApplication;
  let webDist: string;

  beforeAll(async () => {
    webDist = mkdtempSync(join(tmpdir(), 'mercurio-web-'));
    mkdirSync(join(webDist, 'assets'));
    writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>Mercurio</title>');
    writeFileSync(join(webDist, 'assets', 'index-abc123.js'), 'console.log(1)');
    writeFileSync(join(webDist, 'manifest.webmanifest'), '{"name":"Mercurio"}');
    process.env.WEB_DIST_PATH = webDist;
    process.env.APP_BASE_PATH = '/mercurio';

    app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
    configureApp(app, app.get<AppConfig>(APP_CONFIG));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(webDist, { recursive: true, force: true });
    delete process.env.WEB_DIST_PATH;
    process.env.APP_BASE_PATH = '';
  });

  it('serves index.html at the base path, revalidated on every visit', async () => {
    const res = await request(app.getHttpServer()).get('/mercurio/').expect(200);

    expect(res.text).toContain('Mercurio');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('serves index.html for client-side routes', async () => {
    const res = await request(app.getHttpServer()).get('/mercurio/warehouse/stock').expect(200);

    expect(res.text).toContain('Mercurio');
  });

  it('caches hashed assets for a year', async () => {
    const res = await request(app.getHttpServer())
      .get('/mercurio/assets/index-abc123.js')
      .expect(200);

    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('serves the web app manifest with its media type, revalidated like index.html', async () => {
    const res = await request(app.getHttpServer())
      .get('/mercurio/manifest.webmanifest')
      .expect(200);

    expect(res.headers['content-type']).toMatch(/^application\/manifest\+json/);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('keeps API routes out of the fallback', async () => {
    await request(app.getHttpServer()).get('/mercurio/api/health').expect(200);
    const res = await request(app.getHttpServer()).get('/mercurio/api/does-not-exist').expect(404);

    // An API error (docs/adr/0003), not the web app's index.html.
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
