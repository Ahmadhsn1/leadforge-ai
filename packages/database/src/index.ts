import { Prisma, PrismaClient } from '@prisma/client';
import { env } from '@leadforge/config';

export * from '@prisma/client';
export { Prisma, PrismaClient };

/**
 * Shared Prisma client.
 *
 * A single instance per process: Postgres connection slots are finite, and in
 * dev the module is re-evaluated on every hot reload, so the client is cached
 * on globalThis to avoid leaking connections.
 */
const globalForPrisma = globalThis as unknown as { __leadforgePrisma?: PrismaClient };

export function createPrismaClient(): PrismaClient {
  const config = env();
  return new PrismaClient({
    datasources: { db: { url: config.DATABASE_URL } },
    log:
      config.APP_ENV === 'development'
        ? [
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ]
        : [{ emit: 'event', level: 'error' }],
  });
}

export function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.__leadforgePrisma) {
    globalForPrisma.__leadforgePrisma = createPrismaClient();
  }
  return globalForPrisma.__leadforgePrisma;
}

export const prisma = getPrismaClient();

/** Transaction client type, for repository methods that accept either. */
export type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export type DbClient = PrismaClient | PrismaTransaction;

/** True when the error is a unique-constraint violation on the given fields. */
export function isUniqueViolation(error: unknown, fields?: string[]): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return false;
  if (!fields) return true;
  const target = error.meta?.target;
  const targets = Array.isArray(target)
    ? target.map(String)
    : typeof target === 'string'
      ? [target]
      : [];
  return fields.some((field) => targets.includes(field));
}

export function isNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

/** Current UTC month bucket used by usage counters, e.g. "2026-09". */
export function currentPeriod(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
