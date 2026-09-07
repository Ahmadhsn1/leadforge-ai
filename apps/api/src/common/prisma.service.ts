import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@leadforge/database';
import { env } from '@leadforge/config';
import { logger } from './logger';

/**
 * Nest-managed Prisma client.
 *
 * Owning the lifecycle here means the pool is closed cleanly on shutdown, so
 * in-flight queries finish rather than being severed mid-transaction.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: { db: { url: env().DATABASE_URL } },
      log: env().APP_ENV === 'production' ? ['error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    logger('prisma').info('database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Cheap liveness probe used by the health endpoint. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
