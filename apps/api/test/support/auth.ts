import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { APP_CONFIG, type AppConfig } from '../../src/config/app-config.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { newActivationCode } from '../../src/modules/identity/activation-code.js';
import { AuthModule } from '../../src/modules/auth/index.js';
import { totpCode } from '../../src/modules/auth/totp.js';

/** The real application, set up as in production, plus any test-only controllers. */
export async function createTestApp(controllers: unknown[] = []) {
  const moduleRef = await Test.createTestingModule({
    // AuthModule is imported again so that test controllers can inject what it exports.
    imports: [AppModule, AuthModule],
    controllers: controllers as never[],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app, app.get<AppConfig>(APP_CONFIG));
  await app.init();
  return app;
}

export const PASSWORD = 'correct-horse-battery-staple';

/** Gives a person an activation code the way an operator would (stored only as a hash). */
export async function issueCode(admin: PrismaClient, userId: string, days = 7): Promise<string> {
  const { code, hash, expiresAt } = newActivationCode(new Date(), days);
  await admin.activationToken.deleteMany({ where: { userId, usedAt: null } });
  await admin.activationToken.create({ data: { userId, tokenHash: hash, expiresAt } });
  return code;
}

/** The value of the refresh cookie set by a response, or undefined. */
export function refreshCookie(res: request.Response): string | undefined {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const line = raw.find((c) => c.startsWith('mercurio_refresh='));
  const value = line?.split(';')[0]?.slice('mercurio_refresh='.length);
  return value || undefined;
}

export const cookieHeader = (token: string) => `mercurio_refresh=${token}`;

export interface Activated {
  secret: string;
  accessToken: string;
  refresh: string;
  recoveryCodes: string[];
  tenantId: string | null;
}

/** Activation, two-factor enrolment and the first sign-in, through the API. */
export async function activate(
  app: INestApplication,
  admin: PrismaClient,
  userId: string,
  password = PASSWORD,
): Promise<Activated> {
  const http = request(app.getHttpServer());
  const code = await issueCode(admin, userId);
  const { body: activated } = await http
    .post('/api/auth/activate')
    .send({ code, password })
    .expect(201);
  const { body: started } = await request(app.getHttpServer())
    .post('/api/auth/mfa/enroll/start')
    .send({ enrollToken: activated.enrollToken })
    .expect(200);
  const res = await request(app.getHttpServer())
    .post('/api/auth/mfa/enroll/confirm')
    .send({ enrollToken: activated.enrollToken, code: totpCode(started.secret) })
    .expect(200);
  return {
    secret: started.secret,
    accessToken: res.body.accessToken,
    refresh: refreshCookie(res)!,
    recoveryCodes: res.body.recoveryCodes,
    tenantId: res.body.tenantId,
  };
}

/** Both sign-in steps. The one-time code is made fresh by forgetting the last used step. */
export async function signIn(
  app: INestApplication,
  admin: PrismaClient,
  userId: string,
  email: string,
  secret: string,
  password = PASSWORD,
) {
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  await admin.credential.update({ where: { userId }, data: { totpLastStep: null } });
  const res = await request(app.getHttpServer())
    .post('/api/auth/mfa/verify')
    .send({ challengeToken: login.body.token, code: totpCode(secret) })
    .expect(200);
  return {
    accessToken: res.body.accessToken as string,
    refresh: refreshCookie(res)!,
    body: res.body as { tenantId: string | null; tenants: { id: string; role: string }[] },
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
