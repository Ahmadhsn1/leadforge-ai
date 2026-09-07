import { config as loadDotenv } from 'dotenv';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { z } from 'zod';

/**
 * Loads .env from the nearest ancestor directory that has one, so every
 * workspace app (api, worker, scripts) shares a single root .env in dev.
 * In production, real environment variables always win.
 */
function loadRootEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  loadDotenv();
}

loadRootEnv();

const bool = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return defaultValue;
      if (typeof value === 'boolean') return value;
      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    });

const int = (defaultValue: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return defaultValue;
      const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : defaultValue;
    });

const num = (defaultValue: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return defaultValue;
      const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : defaultValue;
    });

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()));

export const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),
  API_PORT: int(4000),
  WORKER_PORT: int(4001),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://leadforge:leadforge@localhost:5432/leadforge?schema=public'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  AUTH_SECRET: z.string().min(16).default('development-only-insecure-auth-secret'),
  SESSION_TTL_HOURS: int(720),
  COOKIE_DOMAIN: optionalString,
  COOKIE_SECURE: bool(false),

  OPENROUTER_API_KEY: optionalString,
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  AI_ENABLED: bool(true),
  AI_MONTHLY_USD_BUDGET: num(50),
  AI_DEFAULT_TIER: z.enum(['economy', 'balanced', 'quality']).default('balanced'),

  GOOGLE_MAPS_API_KEY: optionalString,
  DISCOVERY_MAX_RESULTS_PER_RUN: int(200),

  META_APP_ID: optionalString,
  META_APP_SECRET: optionalString,
  META_ACCESS_TOKEN: optionalString,
  META_WEBHOOK_VERIFY_TOKEN: optionalString,
  WHATSAPP_PHONE_NUMBER_ID: optionalString,
  INSTAGRAM_BUSINESS_ACCOUNT_ID: optionalString,
  META_GRAPH_VERSION: z.string().default('v21.0'),

  SMTP_HOST: optionalString,
  SMTP_PORT: int(587),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_FROM: optionalString,

  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY: optionalString,
  S3_SECRET_KEY: optionalString,

  FETCH_TIMEOUT_MS: int(8000),
  FETCH_MAX_BYTES: int(2_000_000),
  FETCH_MAX_REDIRECTS: int(3),
  ALLOW_PRIVATE_NETWORK_FETCH: bool(false),

  OTEL_EXPORTER_OTLP_ENDPOINT: optionalString,
  OTEL_SERVICE_NAME: z.string().default('leadforge'),

  RATE_LIMIT_WINDOW_MS: int(60_000),
  RATE_LIMIT_MAX: int(300),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;

  if (env.APP_ENV === 'production') {
    const problems: string[] = [];
    if (
      env.AUTH_SECRET === 'development-only-insecure-auth-secret' ||
      env.AUTH_SECRET.length < 32
    ) {
      problems.push('AUTH_SECRET must be a strong (>=32 char) secret in production');
    }
    if (!env.COOKIE_SECURE) problems.push('COOKIE_SECURE must be true in production');
    if (env.ALLOW_PRIVATE_NETWORK_FETCH) {
      problems.push('ALLOW_PRIVATE_NETWORK_FETCH must be false in production');
    }
    if (problems.length > 0) {
      throw new Error(
        `Unsafe production configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
      );
    }
  }

  return env;
}

export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

/** Test helper: forget the memoised environment. */
export function resetEnvCache(): void {
  cached = undefined;
}
