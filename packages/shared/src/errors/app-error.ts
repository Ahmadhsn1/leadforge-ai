/**
 * Stable machine-readable error codes. The HTTP layer maps these to statuses,
 * and workers use `retryable` to decide backoff vs dead-letter.
 */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_ERROR',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'AI_SCHEMA_INVALID',
  'AI_BUDGET_EXCEEDED',
  'SUPPRESSED_RECIPIENT',
  'INVALID_STATE_TRANSITION',
  'UNSAFE_URL',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  QUOTA_EXCEEDED: 402,
  RATE_LIMITED: 429,
  PROVIDER_NOT_CONFIGURED: 503,
  PROVIDER_ERROR: 502,
  PROVIDER_RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 503,
  AI_SCHEMA_INVALID: 502,
  AI_BUDGET_EXCEEDED: 402,
  SUPPRESSED_RECIPIENT: 409,
  INVALID_STATE_TRANSITION: 409,
  UNSAFE_URL: 400,
  INTERNAL: 500,
};

/** Codes a worker should retry rather than dead-letter. */
const RETRYABLE: readonly ErrorCode[] = [
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'INTERNAL',
];

export interface AppErrorOptions {
  readonly details?: unknown;
  readonly cause?: unknown;
  /** Overrides the default retryability for the code. */
  readonly retryable?: boolean;
  /** Hint for delayed retries, in milliseconds. */
  readonly retryAfterMs?: number;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = options.details;
    this.retryable = options.retryable ?? RETRYABLE.includes(code);
    this.retryAfterMs = options.retryAfterMs;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError('BAD_REQUEST', message, { details });
  }

  static notFound(resource: string, id?: string): AppError {
    return new AppError('NOT_FOUND', id ? `${resource} ${id} not found` : `${resource} not found`);
  }

  static forbidden(message = 'You do not have access to this resource'): AppError {
    return new AppError('FORBIDDEN', message);
  }

  static unauthenticated(message = 'Authentication required'): AppError {
    return new AppError('UNAUTHENTICATED', message);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError('CONFLICT', message, { details });
  }

  static providerNotConfigured(provider: string): AppError {
    return new AppError(
      'PROVIDER_NOT_CONFIGURED',
      `${provider} is not configured. Set the required environment variables to enable it.`,
      { retryable: false },
    );
  }

  static invalidTransition(from: string, to: string): AppError {
    return new AppError('INVALID_STATE_TRANSITION', `Cannot transition from "${from}" to "${to}"`, {
      details: { from, to },
    });
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Best-effort classification of an unknown thrown value for retry decisions. */
export function isRetryableError(error: unknown): boolean {
  if (isAppError(error)) return error.retryable;
  if (error instanceof Error) {
    const transient =
      /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|network|timeout|fetch failed/i;
    return transient.test(error.message);
  }
  return false;
}

/** The wire shape returned by the API for every failure. */
export interface ApiErrorBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly details?: unknown;
    readonly requestId?: string;
  };
}
