import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuthService } from '../src/modules/auth/index.js';
import { IS_PUBLIC } from '../src/modules/auth/decorators.js';
import { TokenService } from '../src/modules/auth/tokens.js';
import { createTestApp } from './support/auth.js';

// Every route is closed unless it says otherwise (docs/adr/0014). This lists the routes the
// application really mounts and compares the open ones with the list below: opening a route is
// a visible, reviewed change, never an accident.
const EXPECTED_PUBLIC = [
  'GET health',
  'POST auth/activate',
  'POST auth/login',
  'POST auth/mfa/enroll/confirm',
  'POST auth/mfa/enroll/start',
  'POST auth/mfa/verify',
  'POST auth/refresh',
];

describe('route inventory (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  function routes() {
    const reflector = app.get(Reflector);
    const found: { route: string; isPublic: boolean }[] = [];
    const controllers = [...app.get(ModulesContainer).values()].flatMap((module) => [
      ...module.controllers.values(),
    ]);
    for (const wrapper of controllers) {
      const type = wrapper.metatype;
      if (!type) continue;
      const base = Reflect.getMetadata(PATH_METADATA, type) as string;
      for (const name of Object.getOwnPropertyNames(type.prototype)) {
        const handler = type.prototype[name] as (...args: unknown[]) => unknown;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined) continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
        found.push({
          route: `${RequestMethod[method]} ${[base, path].filter((p) => p && p !== '/').join('/')}`,
          isPublic: Boolean(reflector.getAllAndOverride(IS_PUBLIC, [handler, type])),
        });
      }
    }
    return found;
  }

  it('opens exactly the expected routes', () => {
    const open = routes()
      .filter((r) => r.isPublic)
      .map((r) => r.route)
      .sort();

    expect(open).toEqual([...EXPECTED_PUBLIC].sort());
  });

  it('finds the protected routes too (the scan itself works)', () => {
    const closed = routes()
      .filter((r) => !r.isPublic)
      .map((r) => r.route);

    expect(closed).toEqual(expect.arrayContaining(['GET auth/me', 'GET audit-events']));
  });

  it('answers in Problem Details when checking a token fails unexpectedly', async () => {
    const token = await app.get(TokenService).sign('access', {
      sub: '0198a000-0000-7000-8000-000000000001',
      sid: '0198a000-0000-7000-8000-000000000002',
    });
    vi.spyOn(app.get(AuthService), 'resolveIdentity').mockRejectedValueOnce(
      new Error('database unreachable'),
    );

    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(500);

    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(res.body)).not.toContain('database unreachable');
  });
});
