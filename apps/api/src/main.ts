import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';
import { ensureSafeDatabaseRole } from './prisma/ensure-safe-database-role.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config);
  await ensureSafeDatabaseRole(app, config);
  await app.listen(config.port, config.host);
  app.get(Logger).log(`Listening on ${config.host}:${config.port}, API at /${config.apiPrefix}`);
}
await bootstrap();
