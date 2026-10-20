import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { AppConfig } from './config/app-config.js';
import { ProblemDetailsFilter, validationException } from './shared/errors/index.js';

/**
 * Everything that makes the HTTP application what it is. Shared by main.ts and the
 * end-to-end tests, so the tests exercise the same setup as production.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.useLogger(app.get(Logger));
  // nginx sits in front: trust exactly one proxy hop for the client IP and protocol.
  app.set('trust proxy', 1);
  app.use(
    helmet({
      // The Swagger UI needs inline scripts, so the CSP is relaxed only when the docs are on.
      contentSecurityPolicy: config.swaggerEnabled ? false : undefined,
      // HSTS applies to the whole domain and its subdomains: it is set by nginx, which owns
      // the domain, not by one of the apps living under a path of it.
      strictTransportSecurity: false,
    }),
  );
  app.setGlobalPrefix(config.apiPrefix);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationException,
    }),
  );
  // Every error leaves the API as RFC 9457 Problem Details (docs/adr/0003).
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Mercurio API')
        .setDescription('Warehouse and invoicing')
        .setVersion(config.appVersion)
        .build(),
    );
    SwaggerModule.setup(`${config.apiPrefix}/docs`, app, document);
  }
}
