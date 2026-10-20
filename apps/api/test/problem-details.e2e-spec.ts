import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { APP_CONFIG, type AppConfig } from '../src/config/app-config.js';
import { ProbeController } from './support/probe.controller.js';

// Every error leaves the API as RFC 9457 Problem Details with a stable code (docs/adr/0003).
describe('error responses (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app, app.get<AppConfig>(APP_CONFIG));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a valid body', async () => {
    await request(app.getHttpServer())
      .post('/api/probe/validate')
      .send({ email: 'anna@example.com', lines: [{ quantity: 2 }] })
      .expect(201, { ok: true, lines: 1 });
  });

  it('reports every invalid field with its path and code', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/probe/validate')
      .send({ email: 'not-an-email', lines: [{ quantity: -1 }], isAdmin: true })
      .expect(400);

    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ type: 'about:blank', status: 400, code: 'VALIDATION_FAILED' });
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        { field: 'email', code: 'IS_EMAIL' },
        { field: 'lines[0].quantity', code: 'IS_POSITIVE' },
        { field: 'isAdmin', code: 'UNKNOWN_FIELD' },
      ]),
    );
  });

  it('rejects malformed JSON as a bad request', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/probe/validate')
      .set('content-type', 'application/json')
      .send('{"email": ')
      .expect(400);

    expect(res.body).toMatchObject({ status: 400, code: 'BAD_REQUEST' });
  });

  it('returns the code of a broken domain rule', async () => {
    const res = await request(app.getHttpServer()).post('/api/probe/domain-error').expect(409);

    expect(res.body).toEqual({
      type: 'about:blank',
      status: 409,
      title: 'Conflict',
      code: 'PROBE_RULE_BROKEN',
    });
  });

  it('hides the cause of unexpected errors', async () => {
    const res = await request(app.getHttpServer()).post('/api/probe/crash').expect(500);

    expect(res.body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(res.body)).not.toContain('internal details');
  });

  it('answers unknown API routes with a 404 problem', async () => {
    const res = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);

    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});
