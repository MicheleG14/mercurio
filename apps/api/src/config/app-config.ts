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
});

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
  };
}
