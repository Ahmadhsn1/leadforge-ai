import 'reflect-metadata';
import * as http from 'node:http';
import { JOB_NAMES, QUEUE_NAMES } from '@leadforge/shared';
import { env } from '@leadforge/config';
import { rootLogger } from '@leadforge/api';
import { createWorkerContext } from './context';
import { WorkerRunner } from './runner';
import { discoveryRun, normalizeCandidate } from './processors/discovery.processor';
import {
  analyzeLead,
  enrichLead,
  personalizeLead,
  scoreLead,
  verifyLead,
} from './processors/pipeline.processor';
import { classifyReply, sendOutreach, sweepFollowUps } from './processors/outreach.processor';

/**
 * Worker entry point.
 *
 * Registers a BullMQ worker per queue, exposes a health endpoint for the
 * container, and schedules the follow-up sweep. Shutdown is graceful: workers
 * stop accepting new jobs and in-flight ones are allowed to finish.
 */
async function bootstrap(): Promise<void> {
  const config = env();
  const ctx = await createWorkerContext();
  const runner = new WorkerRunner(ctx);

  runner.register('discovery', { [JOB_NAMES.discoveryRun]: discoveryRun as never });
  runner.register('normalization', { [JOB_NAMES.normalizeCandidate]: normalizeCandidate as never });
  runner.register('verification', { [JOB_NAMES.verifyLead]: verifyLead as never });
  runner.register('enrichment', { [JOB_NAMES.enrichLead]: enrichLead as never });
  runner.register('intelligence', { [JOB_NAMES.analyzeLead]: analyzeLead as never });
  runner.register('scoring', { [JOB_NAMES.scoreLead]: scoreLead as never });
  runner.register('personalization', { [JOB_NAMES.personalizeLead]: personalizeLead as never });
  runner.register('outreach', {
    [JOB_NAMES.sendOutreach]: sendOutreach as never,
    [JOB_NAMES.sweepFollowUps]: sweepFollowUps as never,
    [JOB_NAMES.classifyReply]: classifyReply as never,
  });

  /*
   * Follow-up sweep. A repeatable job rather than setInterval: BullMQ keeps
   * exactly one schedule across however many worker replicas are running.
   */
  await ctx.queue
    .getQueue('outreach')
    .add(
      JOB_NAMES.sweepFollowUps,
      { organizationId: 'system', jobId: 'sweep', idempotencyKey: 'sweep', inputVersion: 1 },
      {
        repeat: { every: 5 * 60 * 1000 },
        jobId: 'follow-up-sweep',
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    )
    .catch((error: unknown) => {
      rootLogger.error({ err: error }, 'could not schedule the follow-up sweep');
    });

  /* Liveness endpoint so the container can be health-checked. */
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', queues: Object.values(QUEUE_NAMES).length }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(config.WORKER_PORT, '0.0.0.0');

  rootLogger.info(
    { port: config.WORKER_PORT, queues: Object.values(QUEUE_NAMES) },
    'LeadForge worker started',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    rootLogger.info({ signal }, 'shutting down worker');
    server.close();
    try {
      await runner.close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  rootLogger.fatal({ err: error }, 'worker failed to start');
  process.exit(1);
});
