import { loadConfig } from './app-config.js';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

describe('loadConfig', () => {
  it('applies the defaults', () => {
    const config = loadConfig({ DATABASE_URL });

    expect(config).toMatchObject({
      nodeEnv: 'development',
      host: '0.0.0.0',
      port: 3000,
      basePath: '',
      apiPrefix: 'api',
      logLevel: 'info',
      swaggerEnabled: true,
    });
  });

  it.each([
    ['/mercurio', '/mercurio', 'mercurio/api'],
    ['/mercurio/', '/mercurio', 'mercurio/api'],
    ['/', '', 'api'],
  ])('normalises APP_BASE_PATH %j', (input, basePath, apiPrefix) => {
    const config = loadConfig({ DATABASE_URL, APP_BASE_PATH: input });

    expect(config.basePath).toBe(basePath);
    expect(config.apiPrefix).toBe(apiPrefix);
  });

  it('turns the API docs off in production unless enabled', () => {
    expect(loadConfig({ DATABASE_URL, NODE_ENV: 'production' }).swaggerEnabled).toBe(false);
    expect(
      loadConfig({ DATABASE_URL, NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }).swaggerEnabled,
    ).toBe(true);
  });

  it('refuses to start without a database URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('lists every invalid variable', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'mysql://x', PORT: 'abc', APP_BASE_PATH: 'mercurio' }),
    ).toThrow(/DATABASE_URL[\s\S]*PORT|PORT[\s\S]*DATABASE_URL/);
  });
});
