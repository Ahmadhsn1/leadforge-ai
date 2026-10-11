import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { QUEUE_NAMES } from '@leadforge/shared';
import { env } from '@leadforge/config';
import { AppModule, configureHttpApp, rootLogger } from '@leadforge/api';
import { contextFrom } from './context';
import { WorkerRunner } from './runner';
import { registerProcessors, scheduleFollowUpSweep } from './processors/register';

/**
 * Single-process entry point: the HTTP API and the queue workers in one
 * Node process, sharing one module graph and one database pool.
 *
 * The API and the worker are separate services by default, and should stay so
 * once there is load worth scaling independently. But two always-on services
 * is twice the hosting bill for a product with its first handful of customers,
 * and on some hosts only one process is on offer. This runs the whole backend
 * on one small instance.
 *
 * It needs a host that keeps the process alive between requests. On a platform
 * that freezes or stops idle instances, queued and delayed jobs — pipeline
 * stages, scheduled sends, follow-up sequences — only advance while something
 * is keeping the instance awake.
 *
 * `PORT` is honoured ahead of `API_PORT`, since that is what most hosts inject.
 */
async function bootstrap(): Promise<void> {
  const config = env();
  const port = Number(process.env.PORT) || config.API_PORT;

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
    bodyParser: false,
  });
  configureHttpApp(app);

  const ctx = contextFrom(app);
  const runner = new WorkerRunner(ctx);
  registerProcessors(runner);
  await scheduleFollowUpSweep(ctx);

  await app.listen(port, '0.0.0.0');

  rootLogger.info(
    { port, env: config.APP_ENV, queues: Object.values(QUEUE_NAMES) },
    'LeadForge API and worker listening in one process',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    rootLogger.info({ signal }, 'shutting down');
    try {
      // Stops the workers, then closes the application (and its HTTP server).
      await runner.close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  rootLogger.fatal({ err: error }, 'failed to start');
  process.exit(1);
});
