import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import express from 'express';
import type { Request, Response } from 'express';
import { env } from '@leadforge/config';
import { AppModule } from './app.module';

/**
 * Creates the application as an HTTP server, ready to `listen`.
 *
 * Everything an HTTP instance needs beyond its module graph is applied here:
 * security headers, body parsing, cookies and CORS.
 *
 * Shared by the API entry point and the single-process entry point in
 * `apps/worker`, so the two cannot drift into serving different middleware.
 *
 * Order matters: the raw-body capture must run before JSON parsing so webhook
 * HMAC verification sees the exact bytes the provider signed, which is why the
 * application is created with Nest's own body parser off.
 */
export async function createHttpApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Pino owns logging; Nest's own logger only carries bootstrap messages.
    logger: ['error', 'warn', 'log'],
    bodyParser: false,
  });
  configureHttpApp(app);
  return app;
}

function configureHttpApp(app: NestExpressApplication): void {
  const config = env();

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
}
