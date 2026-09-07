import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import express from 'express';
import type { Request, Response } from 'express';
import { env } from '@leadforge/config';
import { AppModule } from './app.module';
import { rootLogger } from './common/logger';

/**
 * API bootstrap.
 *
 * Order matters here: the raw-body capture must run before JSON parsing so
 * webhook HMAC verification sees the exact bytes the provider signed.
 */
async function bootstrap(): Promise<void> {
  const config = env();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Pino owns logging; Nest's own logger only carries bootstrap messages.
    logger: ['error', 'warn', 'log'],
    bodyParser: false,
  });

  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The API serves JSON only; CSP belongs to the web app.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts:
        config.APP_ENV === 'production' ? { maxAge: 15_552_000, includeSubDomains: true } : false,
    }),
  );

  app.use(
    express.json({
      limit: '2mb',
      verify: (req: Request, _res: Response, buffer: Buffer) => {
        // Retained for webhook signature verification.
        (req as Request & { rawBody?: string }).rawBody = buffer.toString('utf8');
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  app.enableCors({
    origin: config.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });

  // Finish in-flight requests before the process exits.
  app.enableShutdownHooks();

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
