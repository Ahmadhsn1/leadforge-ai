import { Worker, Job, Processor, DelayedError } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import {
  AppError,
  QUEUE_NAMES,
  QUEUE_POLICIES,
  isRetryableError,
  QueueKey,
} from '@leadforge/shared';
import { env } from '@leadforge/config';
import { logger, withLogContext } from '@leadforge/api';
import type { WorkerContext } from './context';

/**
 * Worker runtime (docs/28-QUEUE-WORKERS.md).
 *
 * Wraps every processor with the four guarantees the docs require:
 *   - tenant-scoped:  the payload carries organizationId and the log context
 *                     is opened with it before any work happens
 *   - observable:     one JobRecord row per job, updated at every transition
 *   - retryable:      a transient failure is rethrown so BullMQ retries; a
 *                     permanent one is marked dead-letter and swallowed
 *   - idempotent:     processors are written to be safe to run twice, and the
 *                     JobRecord makes a duplicate enqueue a no-op
 */

export interface JobContext<T> {
  readonly payload: T;
  readonly job: Job;
  readonly ctx: WorkerContext;
}

export type JobHandler<T> = (context: JobContext<T>) => Promise<void>;

interface BasePayload {
  jobId: string;
  organizationId: string;
  idempotencyKey: string;
  campaignId?: string;
  runId?: string;
  leadId?: string;
  requestId?: string;
}

export class WorkerRunner {
  private readonly workers: Worker[] = [];
  private readonly connection: Redis;

  constructor(private readonly ctx: WorkerContext) {
    this.connection = new IORedis(env().REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.connection.on('error', (error) => logger('worker').error({ err: error }, 'redis error'));
  }

  /**
   * Registers the handlers for one queue. Job names are dispatched within the
   * queue, so related work shares a concurrency and rate-limit budget.
   */
  register(key: QueueKey, handlers: Record<string, JobHandler<never>>): void {
    const policy = QUEUE_POLICIES[key];
    const queueName = QUEUE_NAMES[key];

    const processor: Processor = async (job: Job, token?: string) => {
      const handler = handlers[job.name];
      if (!handler) {
        logger('worker').error(
          { queue: queueName, name: job.name },
          'no handler registered for job',
        );
        return;
      }
      await this.run(job, handler as JobHandler<unknown>, queueName, token);
    };

    const worker = new Worker(queueName, processor, {
      connection: this.connection,
      concurrency: policy.concurrency,
      ...(policy.rateLimitMax && policy.rateLimitWindowMs
        ? { limiter: { max: policy.rateLimitMax, duration: policy.rateLimitWindowMs } }
        : {}),
    });

    worker.on('failed', (job, error) => {
      // A rescheduled job surfaces here as a DelayedError. It is not a failure.
      if (error instanceof DelayedError || error?.name === 'DelayedError') return;

      logger('worker').error(
        {
          queue: queueName,
          name: job?.name,
          jobId: job?.id,
          attempt: job?.attemptsMade,
          err: error,
        },
        'job attempt failed',
      );
    });

    worker.on('error', (error) => {
      logger('worker').error({ queue: queueName, err: error }, 'worker error');
    });

    this.workers.push(worker);
    logger('worker').info(
      { queue: queueName, concurrency: policy.concurrency, handlers: Object.keys(handlers) },
      'queue worker started',
    );
  }

  /** Executes one job with logging, JobRecord updates and failure classification. */
  private async run(
    job: Job,
    handler: JobHandler<unknown>,
    queueName: string,
    token?: string,
  ): Promise<void> {
    const payload = job.data as BasePayload;
    const startedAt = Date.now();

    await withLogContext(
      {
        requestId: payload.requestId ?? `job_${job.id}`,
        jobId: payload.jobId,
        queue: queueName,
        organizationId: payload.organizationId,
        campaignId: payload.campaignId,
        leadId: payload.leadId,
      },
      async () => {
        const log = logger('worker');

        await this.ctx.prisma.jobRecord
          .update({
            where: { id: payload.jobId },
            data: { status: 'active', attempts: job.attemptsMade + 1, startedAt: new Date() },
          })
          .catch(() => undefined);

        try {
          await handler({ payload, job, ctx: this.ctx });

          await this.ctx.prisma.jobRecord
            .update({
              where: { id: payload.jobId },
              data: { status: 'completed', finishedAt: new Date(), error: null },
            })
            .catch(() => undefined);

          log.info({ name: job.name, durationMs: Date.now() - startedAt }, 'job completed');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          // A provider rate limit is a clock problem, not a code problem. The
          // free OpenRouter tier resets on a daily boundary, so burning five
          // BullMQ attempts inside thirty seconds guarantees the job dies
          // while the quota is still exhausted. Rescheduling instead keeps the
          // attempt budget for real failures and lets the work resume when the
          // window reopens.
          const retryAfterMs = rateLimitDelayMs(error);
          if (retryAfterMs !== null && token) {
            await this.ctx.prisma.jobRecord
              .update({
                where: { id: payload.jobId },
                data: { status: 'queued', error: message.slice(0, 2_000), finishedAt: null },
              })
              .catch(() => undefined);

            log.warn(
              { name: job.name, retryAfterMs },
              'provider rate limited; rescheduling without consuming an attempt',
            );

            await job.moveToDelayed(Date.now() + retryAfterMs, token);
            // BullMQ treats this specific error as "I rescheduled myself".
            throw new DelayedError();
          }

          const retryable = isRetryableError(error);
          const attemptsLeft = (job.opts.attempts ?? 1) - (job.attemptsMade + 1);
          const willRetry = retryable && attemptsLeft > 0;

          await this.ctx.prisma.jobRecord
            .update({
              where: { id: payload.jobId },
              data: {
                status: willRetry ? 'queued' : 'dead_letter',
                error: message.slice(0, 2_000),
                finishedAt: willRetry ? null : new Date(),
              },
            })
            .catch(() => undefined);

          // Failures on a campaign run are surfaced on the campaign screen.
          if (payload.runId) {
            await this.ctx.prisma.campaignRun
              .update({
                where: { id: payload.runId },
                data: {
                  errorCount: { increment: 1 },
                  lastError: message.slice(0, 1_000),
                  ...(willRetry ? {} : { status: 'failed' }),
                },
              })
              .catch(() => undefined);
          }

          if (willRetry) {
            log.warn({ name: job.name, err: error, attemptsLeft }, 'job failed, will retry');
            // Rethrowing is what tells BullMQ to schedule the retry.
            throw error;
          }

          log.error({ name: job.name, err: error }, 'job failed permanently (dead-letter)');

          // A permanent failure is recorded, not rethrown: retrying it would
          // burn attempts on work that cannot succeed.
          if (payload.leadId) {
            await this.ctx.prisma.activity
              .create({
                data: {
                  organizationId: payload.organizationId,
                  leadId: payload.leadId,
                  campaignId: payload.campaignId ?? null,
                  type: 'error',
                  summary: `${job.name} failed: ${message.slice(0, 300)}`,
                  actor: 'system',
                  metadata: {
                    queue: queueName,
                    code: error instanceof AppError ? error.code : 'UNKNOWN',
                  },
                },
              })
              .catch(() => undefined);
          }
        }
      },
    );
  }

  async close(): Promise<void> {
    logger('worker').info('shutting down workers');
    // Close workers first so in-flight jobs finish before the pool goes away.
    await Promise.all(this.workers.map((worker) => worker.close()));
    await this.connection.quit().catch(() => undefined);
    await this.ctx.app.close();
  }
}

/**
 * How long to wait before retrying a rate-limited job, or null if the failure
 * was not a rate limit.
 *
 * A provider that tells us when to come back is believed. Otherwise the wait is
 * long enough to be worth rescheduling for — most free-tier quotas are daily,
 * and a one-minute retry would simply fail again.
 */
function rateLimitDelayMs(error: unknown): number | null {
  // Match on the code first, then fall back to the message: an error that has
  // been wrapped on its way up can lose the code but keeps the reason in text.
  const byCode =
    error instanceof AppError &&
    (error.code === 'PROVIDER_RATE_LIMITED' || error.code === 'RATE_LIMITED');
  const byMessage =
    error instanceof Error && /rate.?limit(ed)?|429|too many requests/i.test(error.message);
  const isRateLimit = byCode || byMessage;

  if (!isRateLimit) return null;

  const hinted = error instanceof AppError ? error.retryAfterMs : undefined;
  return hinted && hinted > 0 ? hinted : 15 * 60_000;
}
