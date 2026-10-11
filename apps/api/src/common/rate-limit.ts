import { Injectable, NestMiddleware, OnModuleDestroy } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import IORedis, { type Redis } from 'ioredis';
import type { ApiErrorBody } from '@leadforge/shared';
import { sha256 } from '@leadforge/shared/server';
import { env, isTest } from '@leadforge/config';
import { SESSION_COOKIE } from '@/auth/auth.types';
import { clientIp } from './http';
import { logger } from './logger';

/**
 * Credential endpoints: the ones worth brute-forcing or abusing to send mail.
 * They get a much tighter budget than the rest of the API, and it is always
 * keyed on the caller's address — an attacker has no session to key on.
 */
const AUTH_PATHS = new Set([
  '/auth/login',
  '/auth/signup',
  '/auth/password-reset/request',
  '/auth/password-reset/confirm',
  '/auth/verify-email',
  '/auth/invites/accept',
]);

/** Probes and provider callbacks must never be throttled by our own limiter. */
const EXEMPT_PREFIXES = ['/health', '/webhooks', '/billing/webhook'];

export interface RateLimitVerdict {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

/**
 * Fixed-window counters in Redis, so the limit holds across API instances.
 *
 * Fails open: if Redis is unreachable the request is allowed. Redis being down
 * already stops the pipeline; turning that into a total API outage would make
 * the limiter the least reliable part of the system.
 */
@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private connection: Redis | null = null;

  private redis(): Redis {
    if (!this.connection) {
      this.connection = new IORedis(env().REDIS_URL, {
        // Commands issued before the socket is ready wait briefly instead of
        // failing open, but a Redis that stays down is given up on quickly.
        maxRetriesPerRequest: 1,
        connectTimeout: 2_000,
        commandTimeout: 1_000,
      });
      this.connection.on('error', (error) => {
        logger('rate-limit').debug({ err: error }, 'redis connection error');
      });
    }
    return this.connection;
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection?.quit().catch(() => undefined);
  }

  async hit(bucket: string, limit: number, windowMs: number): Promise<RateLimitVerdict> {
    const window = Math.floor(Date.now() / windowMs);
    const key = `ratelimit:${bucket}:${window}`;
    const retryAfterSeconds = Math.max(1, Math.ceil(((window + 1) * windowMs - Date.now()) / 1000));

    try {
      const results = await this.redis().multi().incr(key).pexpire(key, windowMs).exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds,
      };
    } catch (error) {
      logger('rate-limit').warn({ err: error }, 'rate limiter unavailable; allowing request');
      return { allowed: true, limit, remaining: limit, retryAfterSeconds };
    }
  }
}

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  constructor(private readonly limiter: RateLimitService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.method === 'OPTIONS') return next();

    const path = req.path.replace(/\/+$/, '') || '/';
    if (EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return next();
    }

    const config = env();
    const ip = clientIp(req) ?? 'unknown';
    const isAuthPath = req.method === 'POST' && AUTH_PATHS.has(path);

    // Signed-in traffic is keyed on the session: everyone behind one office
    // NAT — or behind the web app's own proxy — would otherwise share a budget.
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    const bucket = isAuthPath
      ? `auth:${ip}`
      : token
        ? `session:${sha256(token).slice(0, 32)}`
        : `ip:${ip}`;

    // The test suites drive hundreds of requests from one address by design.
    // The limiter still runs there, so its path is exercised, with a budget
    // they cannot reach.
    const scale = isTest() ? 1_000 : 1;
    const verdict = await this.limiter.hit(
      bucket,
      (isAuthPath ? config.RATE_LIMIT_AUTH_MAX : config.RATE_LIMIT_MAX) * scale,
      config.RATE_LIMIT_WINDOW_MS,
    );

    res.setHeader('RateLimit-Limit', String(verdict.limit));
    res.setHeader('RateLimit-Remaining', String(verdict.remaining));

    if (!verdict.allowed) {
      res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
      logger('rate-limit').warn({ path, auth: isAuthPath }, 'request rate limited');
      // Answered here rather than thrown: the same wire shape as every other
      // failure, without depending on how the framework routes middleware errors.
      const requestId = (req as Request & { requestId?: string }).requestId;
      const body: ApiErrorBody = {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Wait a moment and try again.',
          details: { retryAfterSeconds: verdict.retryAfterSeconds },
          ...(requestId ? { requestId } : {}),
        },
      };
      res.status(429).json(body);
      return;
    }

    next();
  }
}
