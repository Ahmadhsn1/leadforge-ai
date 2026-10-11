import 'reflect-metadata';
import * as http from 'node:http';
import { QUEUE_NAMES } from '@leadforge/shared';
import { env } from '@leadforge/config';
import { rootLogger } from '@leadforge/api';
import { createWorkerContext } from './context';
import { WorkerRunner } from './runner';
import { registerProcessors, scheduleFollowUpSweep } from './processors/register';

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

  registerProcessors(runner);
  await scheduleFollowUpSweep(ctx);

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
