import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExecutionContext,
  ExceptionFilter,
  HttpException,
  Injectable,
  NestInterceptor,
  NestMiddleware,
  PipeTransform,
  ArgumentMetadata,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ZodError, ZodSchema } from 'zod';
import { AppError, isAppError, ApiErrorBody } from '@leadforge/shared';
import { logger, newRequestId, withLogContext, enrichLogContext } from './logger';

/**
 * Attaches a request ID and opens the logging context for the whole request,
 * so controller, service and repository log lines all correlate.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : newRequestId();
    res.setHeader('x-request-id', requestId);
    (req as Request & { requestId: string }).requestId = requestId;
    withLogContext({ requestId }, () => next());
  }
}

/** Logs one line per request with method, path, status and duration. */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const startedAt = Date.now();

    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const log = logger('http');
      const payload = {
        method: req.method,
        path: req.route?.path ?? req.path,
        status: res.statusCode,
        durationMs,
      };
      // Client errors are expected; only server errors are worth an error line.
      if (res.statusCode >= 500) log.error(payload, 'request failed');
      else if (res.statusCode >= 400) log.warn(payload, 'request rejected');
      else log.info(payload, 'request completed');
    });

    return next.handle();
  }
}

/**
 * Single error shape for the whole API (docs/29 contract requirements).
 * Internal details never reach the client; the request ID ties the response
 * to the full server-side log entry.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = (req as Request & { requestId?: string }).requestId;

    const { status, body, logLevel } = this.toResponse(exception, requestId);

    const log = logger('http');
    const detail = {
      status,
      code: body.error.code,
      path: req.path,
      method: req.method,
      err:
        exception instanceof Error
          ? { message: exception.message, stack: exception.stack }
          : exception,
    };
    if (logLevel === 'error') log.error(detail, 'unhandled exception');
    else log.warn(detail, 'request error');

    if (!res.headersSent) res.status(status).json(body);
  }

  private toResponse(
    exception: unknown,
    requestId: string | undefined,
  ): { status: number; body: ApiErrorBody; logLevel: 'warn' | 'error' } {
    if (isAppError(exception)) {
      return {
        status: exception.status,
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            ...(exception.details === undefined ? {} : { details: exception.details }),
            ...(requestId ? { requestId } : {}),
          },
        },
        logLevel: exception.status >= 500 ? 'error' : 'warn',
      };
    }

    if (exception instanceof ZodError) {
      return {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'The request body failed validation.',
            details: formatZodIssues(exception),
            ...(requestId ? { requestId } : {}),
          },
        },
        logLevel: 'warn',
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      return {
        status,
        body: {
          error: {
            code: status === 404 ? 'NOT_FOUND' : status === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST',
            message: Array.isArray(message) ? message.join('; ') : message,
            ...(requestId ? { requestId } : {}),
          },
        },
        logLevel: status >= 500 ? 'error' : 'warn',
      };
    }

    return {
      status: 500,
      body: {
        error: {
          code: 'INTERNAL',
          // Deliberately generic: internal messages can leak schema details.
          message: 'An unexpected error occurred.',
          ...(requestId ? { requestId } : {}),
        },
      },
      logLevel: 'error',
    };
  }
}

export function formatZodIssues(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * Validates a payload against a Zod schema. Used via `new ZodValidationPipe(schema)`
 * on individual parameters, so each endpoint states its own contract.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppError('VALIDATION_FAILED', 'The request failed validation.', {
        details: formatZodIssues(result.error),
      });
    }
    return result.data;
  }
}

/** Convenience factory so decorators read cleanly: `@Body(zodBody(schema))`. */
export function zodBody<T>(schema: ZodSchema<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}

export function zodQuery<T>(schema: ZodSchema<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}

/** Records the caller's IP for audit and rate limiting, honouring proxies. */
export function clientIp(req: Request): string | undefined {
  const forwarded = req.header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.ip ?? req.socket.remoteAddress ?? undefined;
}

export { enrichLogContext };
