import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from './support/auth.js';

// The sign-in routes have a limit of their own, much lower than the rest of the API. This file
// builds the application with a low limit so the test stays fast.
process.env.AUTH_RATE_LIMIT_PER_MINUTE = '3';

describe('rate limit of the sign-in routes (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers 429 in Problem Details format after too many attempts', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'someone@example.com', password: 'wrong-password-here' });

    for (let i = 0; i < 3; i += 1) await attempt().expect(401);
    const res = await attempt().expect(429);

    expect(res.body).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('does not limit the other routes that much', async () => {
    for (let i = 0; i < 6; i += 1) {
      await request(app.getHttpServer()).get('/api/health').expect(200);
    }
  });
});
