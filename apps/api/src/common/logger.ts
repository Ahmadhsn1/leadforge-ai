import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import pino, { type Logger } from 'pino';
import { env } from '@leadforge/config';

/**
 * Structured logging with correlation IDs (docs/33-OBSERVABILITY.md).
 *
 * request_id, organization_id and the rest are carried in async-local storage
 * so every log line inside a request or job is automatically tagged, without
 * threading a logger through every function signature.
 */

export interface LogContext {
  requestId: string;
  organizationId?: string;
  userId?: string;
  campaignId?: string;
  leadId?: string;
  jobId?: string;
  queue?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

/** Keys whose values must never reach the logs. */
const REDACTED = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.token',
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'apiKey',
  'encryptedSecret',
  'OPENROUTER_API_KEY',
  'GOOGLE_MAPS_API_KEY',
  'META_ACCESS_TOKEN',
  'SMTP_PASSWORD',
  'AUTH_SECRET',
];

export const rootLogger: Logger = pino({
  level: env().LOG_LEVEL,
  redact: { paths: REDACTED, censor: '[redacted]' },
  base: { service: env().OTEL_SERVICE_NAME, env: env().APP_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
  ...(env().APP_ENV === 'development'
    ? {
        transport: {
          target: 'pino/file',
          options: { destination: 1 },
        },
      }
    : {}),
});

/** Logger bound to the current request/job context. */
export function logger(component?: string): Logger {
  const context = storage.getStore();
  const bindings: Record<string, unknown> = { ...(context ?? {}) };
  if (component) bindings.component = component;
  return Object.keys(bindings).length > 0 ? rootLogger.child(bindings) : rootLogger;
}

/** Runs `fn` with the given correlation context attached to every log line. */
export function withLogContext<T>(context: Partial<LogContext>, fn: () => T): T {
  const parent = storage.getStore();
  const merged: LogContext = {
    requestId: context.requestId ?? parent?.requestId ?? newRequestId(),
    ...parent,
    ...context,
  };
  return storage.run(merged, fn);
}

export function currentLogContext(): LogContext | undefined {
  return storage.getStore();
}

/** Adds fields to the active context, e.g. once a lead ID becomes known. */
export function enrichLogContext(fields: Partial<LogContext>): void {
  const context = storage.getStore();
  if (!context) return;
  Object.assign(context, fields);
}

export function newRequestId(): string {
  return `req_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}
