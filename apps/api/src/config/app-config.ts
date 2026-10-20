import { z } from 'zod';

export const APP_CONFIG = Symbol('APP_CONFIG');

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** "/mercurio/" and "/mercurio" become "/mercurio"; "/" and "" become "" (served from the root). */
const basePath = z
  .string()
  .default('')
  .transform((value) => value.trim().replace(/\/+$/, ''))
  .pipe(
    z
      .string()
      .regex(/^(\/[a-z0-9-]+)*$/, 'must look like "/mercurio" (lowercase letters, digits, dashes)'),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_BASE_PATH: basePath,
  APP_VERSION: z.string().min(1).default('dev'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/.+/, 'must be a PostgreSQL connection URL'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  SWAGGER_ENABLED: z.enum(['true', 'false']).optional(),
  WEB_DIST_PATH: z.string().optional(),
  // Authentication (docs/adr/0012, 0013). Two separate secrets: leaking one opens only one door.
  AUTH_JWT_SECRET: z.string().min(32, 'must be at least 32 characters (openssl rand -hex 32)'),
  MFA_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters, i.e. 32 bytes (openssl rand -hex 32)'),
  AUTH_ACCESS_TOKEN_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  AUTH_SESSION_IDLE_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(8),
  AUTH_SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  AUTH_COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(10),
});

export interface AuthConfig {
  /** Signs access, challenge and enrollment tokens. */
  jwtSecret: string;
  /** AES-256 key that encrypts the TOTP secrets stored in the database. */
  mfaEncryptionKey: Buffer;
  accessTokenSeconds: number;
  /** A session expires after this much time without being refreshed. */
  sessionIdleSeconds: number;
  /** A session expires this long after it started, however active it is. */
  sessionMaxSeconds: number;
  /** The refresh cookie is sent over HTTPS only. Off by default outside production. */
  cookieSecure: boolean;
  /** Attempts per minute and IP on the sign-in routes (on top of the global limit). */
  rateLimitPerMinute: number;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  host: string;
  port: number;
  /** URL prefix the whole app lives under ("" or e.g. "/mercurio"). */
  basePath: string;
  /** Prefix of every API route, without leading slash (e.g. "mercurio/api"). */
  apiPrefix: string;
  appVersion: string;
  databaseUrl: string;
  logLevel: (typeof LOG_LEVELS)[number];
  swaggerEnabled: boolean;
  /** Folder with the built web app, served under basePath. Null in development (Vite serves it). */
  webDistPath: string | null;
  auth: AuthConfig;
}

/**
 * Validates the environment once, at startup. The application refuses to start
 * with a wrong configuration instead of failing later at runtime.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  const values = parsed.data;
  const isProduction = values.NODE_ENV === 'production';
  return {
    nodeEnv: values.NODE_ENV,
    isProduction,
    host: values.HOST,
    port: values.PORT,
    basePath: values.APP_BASE_PATH,
    apiPrefix: `${values.APP_BASE_PATH.slice(1)}${values.APP_BASE_PATH ? '/' : ''}api`,
    appVersion: values.APP_VERSION,
    databaseUrl: values.DATABASE_URL,
    logLevel: values.LOG_LEVEL,
    // API docs are on in development, off in production unless explicitly enabled.
    swaggerEnabled: values.SWAGGER_ENABLED ? values.SWAGGER_ENABLED === 'true' : !isProduction,
    webDistPath: values.WEB_DIST_PATH?.trim() || null,
    auth: {
      jwtSecret: values.AUTH_JWT_SECRET,
      mfaEncryptionKey: Buffer.from(values.MFA_ENCRYPTION_KEY, 'hex'),
      accessTokenSeconds: values.AUTH_ACCESS_TOKEN_MINUTES * 60,
      sessionIdleSeconds: values.AUTH_SESSION_IDLE_HOURS * 3600,
      sessionMaxSeconds: values.AUTH_SESSION_MAX_DAYS * 86_400,
      cookieSecure: values.AUTH_COOKIE_SECURE ? values.AUTH_COOKIE_SECURE === 'true' : isProduction,
      rateLimitPerMinute: values.AUTH_RATE_LIMIT_PER_MINUTE,
    },
  };
}
