import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import type { Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

/** Hashed build files never change; index.html must be revalidated so a deploy shows up at once. */
function setCacheHeaders(res: Response, filePath: string): void {
  res.setHeader(
    'Cache-Control',
    filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
}

/**
 * Serves the built React app on the same origin as the API (docs/adr/0004).
 * Unknown paths under the base path return index.html so client-side routes work on reload,
 * except API paths, which keep their JSON 404.
 */
@Module({
  imports: [
    ServeStaticModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.webDistPath
          ? [
              {
                rootPath: config.webDistPath,
                serveRoot: config.basePath || '/',
                exclude: [`/${config.apiPrefix}/{*path}`],
                serveStaticOptions: { setHeaders: setCacheHeaders, dotfiles: 'ignore' },
              },
            ]
          : [],
    }),
  ],
})
export class WebModule {}
