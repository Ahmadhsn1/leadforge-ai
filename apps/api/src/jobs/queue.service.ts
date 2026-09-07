import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import {
  ALL_QUEUE_KEYS,
  AppError,
  QUEUE_NAMES,
  QUEUE_POLICIES,
  JobName,
  QueueKey,
} from '@leadforge/shared';
import { idempotencyKey } from '@leadforge/shared/server';
import { env } from '@leadforge/config';
import { PrismaService } from '@/common/prisma.service';
import { currentLogContext, logger } from '@/common/logger';

export interface EnqueueOptions {
  /** Delay before the job becomes eligible, in milliseconds. */
  readonly delayMs?: number;
  readonly priority?: number;
  /** Overrides the queue's default attempt count. */
  readonly attempts?: number;
}

export interface JobPayloadBase {
  jobId: string;
  organizationId: string;
  idempotencyKey: string;
  inputVersion: number;
  requestId?: string;
  campaignId?: string;
  runId?: string;
  leadId?: string;
}

/**
 * Job-specific fields are open: the concrete shape is validated by the matching
 * Zod schema in @leadforge/shared when the worker picks the job up, so the
 * producer side only needs the correlation fields to be well typed.
 */
export type JobPayload<T extends Record<string, unknown> = Record<string, unknown>> = Omit<
  JobPayloadBase,
  'jobId'
> &
  T;

/**
 * Job producer (docs/28-QUEUE-WORKERS.md).
 *
 * Every enqueue writes a JobRecord first, keyed by (queue, idempotencyKey).
 * A duplicate enqueue therefore returns the existing job instead of creating a
 * second one, which is what makes the pipeline safe to re-run.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private connection!: Redis;
  private readonly queues = new Map<QueueKey, Queue>();

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.connection = new IORedis(env().REDIS_URL, {
      // BullMQ requires this: it blocks on BRPOPLPUSH and must not give up.
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });

    this.connection.on('error', (error) => {
      logger('queue').error({ err: error }, 'redis connection error');
    });

    for (const key of ALL_QUEUE_KEYS) {
      const policy = QUEUE_POLICIES[key];
      this.queues.set(
        key,
        new Queue(QUEUE_NAMES[key], {
          connection: this.connection,
          defaultJobOptions: {
            attempts: policy.attempts,
            backoff: { type: 'exponential', delay: policy.backoffMs },
            // Keep a bounded history so the queue does not grow without limit.
            removeOnComplete: { age: 24 * 3600, count: 1_000 },
            removeOnFail: { age: 7 * 24 * 3600, count: 5_000 },
          },
        }),
      );
    }

    logger('queue').info({ queues: ALL_QUEUE_KEYS.length }, 'queues ready');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    await this.connection?.quit().catch(() => undefined);
  }

  getQueue(key: QueueKey): Queue {
    const queue = this.queues.get(key);
    if (!queue) throw new AppError('INTERNAL', `Queue "${key}" is not registered.`);
    return queue;
  }

  /**
   * Enqueues a job idempotently.
   *
   * @returns the JobRecord id, and whether this call created it. A `created`
   * of false means the same unit of work was already queued or completed.
   */
  async enqueue<T extends Record<string, unknown>>(
    key: QueueKey,
    name: JobName,
    payload: JobPayload<T>,
    options: EnqueueOptions = {},
  ): Promise<{ jobId: string; created: boolean }> {
    const queueName = QUEUE_NAMES[key];
    const policy = QUEUE_POLICIES[key];

    const existing = await this.prisma.jobRecord.findUnique({
      where: { queue_idempotencyKey: { queue: queueName, idempotencyKey: payload.idempotencyKey } },
    });

    if (existing) {
      // Re-queue only if a previous attempt died permanently and the caller
      // is explicitly retrying; otherwise this is a genuine duplicate.
      if (existing.status !== 'dead_letter' && existing.status !== 'failed') {
        logger('queue').debug(
          { queue: queueName, idempotencyKey: payload.idempotencyKey },
          'duplicate enqueue ignored',
        );
        return { jobId: existing.id, created: false };
      }
    }

    const record = existing
      ? await this.prisma.jobRecord.update({
          where: { id: existing.id },
          data: { status: 'queued', error: null, attempts: 0, finishedAt: null },
        })
      : await this.prisma.jobRecord.create({
          data: {
            organizationId: payload.organizationId,
            queue: queueName,
            name,
            idempotencyKey: payload.idempotencyKey,
            status: 'queued',
            maxAttempts: options.attempts ?? policy.attempts,
            payload: { ...payload, jobId: 'pending' } as never,
            campaignId: payload.campaignId ?? null,
            runId: payload.runId ?? null,
            leadId: payload.leadId ?? null,
            requestId: payload.requestId ?? currentLogContext()?.requestId ?? null,
          },
        });

    const fullPayload = { ...payload, jobId: record.id };

    const job = await this.getQueue(key).add(name, fullPayload, {
      // BullMQ-level dedupe as a second line of defence against races.
      // BullMQ rejects ":" in a custom job id, so the queue and key are
      // joined with a character it accepts.
      jobId: `${key}--${payload.idempotencyKey}`,
      delay: options.delayMs,
      priority: options.priority,
      attempts: options.attempts ?? policy.attempts,
    } satisfies JobsOptions);

    await this.prisma.jobRecord.update({
      where: { id: record.id },
      data: { payload: fullPayload as never, bullJobId: job.id ?? null },
    });

    logger('queue').info(
      { queue: queueName, name, jobRecordId: record.id, delayMs: options.delayMs ?? 0 },
      'job enqueued',
    );

    return { jobId: record.id, created: true };
  }

  /** Builds the deterministic idempotency key for a unit of work. */
  buildKey(...parts: (string | number | null | undefined)[]): string {
    return idempotencyKey(...parts);
  }

  /** Queue depth and failure counts, for the health screen. */
  async stats(): Promise<
    {
      name: string;
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    }[]
  > {
    const results = await Promise.all(
      ALL_QUEUE_KEYS.map(async (key) => {
        const queue = this.getQueue(key);
        try {
          const counts = await queue.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed',
          );
          return {
            name: QUEUE_NAMES[key],
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
          };
        } catch {
          return {
            name: QUEUE_NAMES[key],
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
          };
        }
      }),
    );
    return results;
  }

  async ping(): Promise<boolean> {
    try {
      const reply = await this.connection.ping();
      return reply === 'PONG';
    } catch {
      return false;
    }
  }

  /** Removes every job for a campaign run — used when a campaign is paused. */
  async drainRun(runId: string): Promise<number> {
    let removed = 0;
    for (const key of ALL_QUEUE_KEYS) {
      const queue = this.getQueue(key);
      const jobs = await queue.getJobs(['waiting', 'delayed'], 0, 5_000);
      for (const job of jobs) {
        if ((job.data as { runId?: string } | undefined)?.runId === runId) {
          await job.remove().catch(() => undefined);
          removed += 1;
        }
      }
    }
    if (removed > 0) logger('queue').info({ runId, removed }, 'drained queued jobs for run');
    return removed;
  }
}
