import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { env } from '@leadforge/config';
import { AppModule } from './app.module';
import { configureHttpApp } from './http-app';
import { rootLogger } from './common/logger';

/** API bootstrap. The HTTP middleware lives in `http-app.ts`. */
async function bootstrap(): Promise<void> {
  const config = env();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Pino owns logging; Nest's own logger only carries bootstrap messages.
    logger: ['error', 'warn', 'log'],
    bodyParser: false,
  });

  configureHttpApp(app);

  await app.listen(config.API_PORT, '0.0.0.0');

  rootLogger.info(
    { port: config.API_PORT, env: config.APP_ENV, cors: config.CORS_ORIGINS },
    'LeadForge API listening',
  );
}

bootstrap().catch((error) => {
  rootLogger.fatal({ err: error }, 'API failed to start');
  process.exit(1);
});
