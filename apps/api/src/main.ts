import 'reflect-metadata';
import { env } from '@leadforge/config';
import { createHttpApp } from './http-app';
import { rootLogger } from './common/logger';

/** API bootstrap. The HTTP middleware lives in `http-app.ts`. */
async function bootstrap(): Promise<void> {
  const config = env();
  const app = await createHttpApp();

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
