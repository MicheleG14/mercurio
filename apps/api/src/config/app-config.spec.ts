import { loadConfig } from './app-config.js';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
const AUTH_ENV = {
  AUTH_JWT_SECRET: 'x'.repeat(32),
  MFA_ENCRYPTION_KEY: 'ab'.repeat(32),
};

describe('loadConfig', () => {
  it('applies the defaults', () => {
    const config = loadConfig({ DATABASE_URL, ...AUTH_ENV });

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
    const config = loadConfig({ DATABASE_URL, ...AUTH_ENV, APP_BASE_PATH: input });

    expect(config.basePath).toBe(basePath);
    expect(config.apiPrefix).toBe(apiPrefix);
  });

  it('turns the API docs off in production unless enabled', () => {
    expect(loadConfig({ DATABASE_URL, ...AUTH_ENV, NODE_ENV: 'production' }).swaggerEnabled).toBe(
      false,
    );
    expect(
      loadConfig({ DATABASE_URL, ...AUTH_ENV, NODE_ENV: 'production', SWAGGER_ENABLED: 'true' })
        .swaggerEnabled,
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

  describe('authentication settings', () => {
    it('applies the defaults from the plan', () => {
      const { auth } = loadConfig({ DATABASE_URL, ...AUTH_ENV });

      expect(auth.accessTokenSeconds).toBe(10 * 60);
      expect(auth.sessionIdleSeconds).toBe(8 * 3600);
      expect(auth.sessionMaxSeconds).toBe(14 * 86_400);
      expect(auth.mfaEncryptionKey).toHaveLength(32);
    });

    it('sends the cookie over HTTPS only in production, unless told otherwise', () => {
      const secure = (env: Record<string, string>) =>
        loadConfig({ DATABASE_URL, ...AUTH_ENV, ...env }).auth.cookieSecure;

      expect(secure({})).toBe(false);
      expect(secure({ NODE_ENV: 'production' })).toBe(true);
      expect(secure({ NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'false' })).toBe(false);
    });

    it('refuses to start without the secrets, or with weak ones', () => {
      expect(() => loadConfig({ DATABASE_URL })).toThrow(
        /AUTH_JWT_SECRET[\s\S]*MFA_ENCRYPTION_KEY/,
      );
      expect(() => loadConfig({ DATABASE_URL, ...AUTH_ENV, AUTH_JWT_SECRET: 'short' })).toThrow(
        /AUTH_JWT_SECRET/,
      );
      expect(() => loadConfig({ DATABASE_URL, ...AUTH_ENV, MFA_ENCRYPTION_KEY: 'abcd' })).toThrow(
        /MFA_ENCRYPTION_KEY/,
      );
    });
  });
});
