import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { buildOpenApiDocument } from './app.setup.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';

// Writes the OpenAPI document to the file given as argument (`pnpm openapi`). The document must
// not depend on the machine, so everything it could depend on is fixed here: no database is
// contacted (Prisma connects lazily) and the secrets are placeholders.
Object.assign(process.env, {
  NODE_ENV: 'development',
  APP_BASE_PATH: '',
  APP_VERSION: '0.0.0',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://openapi:openapi@127.0.0.1:1/openapi',
  AUTH_JWT_SECRET: 'openapi-document-placeholder-secret-0123456789',
  MFA_ENCRYPTION_KEY: '00'.repeat(32),
});

const target = process.argv[2];
if (!target) throw new Error('Usage: node dist/openapi.js <output file>');

const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
const document = buildOpenApiDocument(app, app.get<AppConfig>(APP_CONFIG));
writeFileSync(resolve(target), `${JSON.stringify(document, null, 2)}\n`);
await app.close();
