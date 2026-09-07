import { Controller, Get } from '@nestjs/common';
import { capabilities } from '@leadforge/config';
import { PrismaService } from '@/common/prisma.service';
import { QueueService } from '@/jobs/queue.service';
import { MailService } from '@/common/mail.service';
import { Public } from '@/auth/auth.guard';
import { logger } from '@/common/logger';

interface Check {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  detail: string | null;
  latencyMs: number | null;
}

const VERSION = process.env.npm_package_version ?? '1.0.0';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly mail: MailService,
  ) {}

  /**
   * Liveness probe for the load balancer and container healthcheck.
   * Deliberately cheap and unauthenticated: it must answer even when the
   * database is struggling.
   */
  @Public()
  @Get()
  live() {
    return { status: 'ok', version: VERSION, timestamp: new Date().toISOString() };
  }

  /**
   * Readiness probe. Fails when a dependency the service cannot work without
   * is unavailable, so an unhealthy instance is taken out of rotation.
   */
  @Public()
  @Get('ready')
  async ready() {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    const ready = database.status === 'ok' && redis.status === 'ok';
    return { status: ready ? 'ok' : 'down', checks: [database, redis] };
  }

  /** Full status for the health screen. Requires a session. */
  @Get('detail')
  async detail() {
    const caps = capabilities();

    const [database, redis, queues, smtp] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.queue.stats().catch(() => []),
      caps.email ? this.checkSmtp() : Promise.resolve(null),
    ]);

    const checks: Check[] = [
      database,
      redis,
      {
        name: 'ai_gateway',
        status: caps.ai ? 'ok' : 'degraded',
        detail: caps.ai
          ? 'OpenRouter API key present.'
          : 'OPENROUTER_API_KEY is not set. Analysis, scoring explanations, message generation and the copilot are unavailable.',
        latencyMs: null,
      },
      {
        name: 'discovery_source',
        status: caps.googlePlaces ? 'ok' : 'degraded',
        detail: caps.googlePlaces
          ? 'Google Places API key present.'
          : 'GOOGLE_MAPS_API_KEY is not set. Campaigns cannot discover new businesses.',
        latencyMs: null,
      },
      {
        name: 'whatsapp',
        status: caps.whatsapp ? 'ok' : 'degraded',
        detail: caps.whatsapp
          ? 'WhatsApp Business credentials present.'
          : 'Not configured. Drafts can be written but not sent.',
        latencyMs: null,
      },
      {
        name: 'instagram',
        status: caps.instagram ? 'ok' : 'degraded',
        detail: caps.instagram
          ? 'Instagram credentials present.'
          : 'Not configured. Drafts can be written but not sent.',
        latencyMs: null,
      },
      ...(smtp
        ? [smtp]
        : [
            {
              name: 'email',
              status: 'degraded' as const,
              detail: 'SMTP is not configured.',
              latencyMs: null,
            },
          ]),
    ];

    // Only the datastores are fatal; a missing provider degrades a feature.
    const down = checks.some((check) => check.status === 'down');
    const degraded = checks.some((check) => check.status === 'degraded');

    return {
      status: down ? 'down' : degraded ? 'degraded' : 'ok',
      checks,
      queues,
      version: VERSION,
    };
  }

  private async checkDatabase(): Promise<Check> {
    const startedAt = Date.now();
    try {
      await this.prisma.ping();
      return {
        name: 'database',
        status: 'ok',
        detail: 'PostgreSQL responding.',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      logger('health').error({ err: error }, 'database health check failed');
      return {
        name: 'database',
        status: 'down',
        detail: 'PostgreSQL is not reachable.',
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  private async checkRedis(): Promise<Check> {
    const startedAt = Date.now();
    const ok = await this.queue.ping().catch(() => false);
    return {
      name: 'redis',
      status: ok ? 'ok' : 'down',
      detail: ok
        ? 'Redis responding; queues available.'
        : 'Redis is not reachable. No pipeline work can be queued.',
      latencyMs: Date.now() - startedAt,
    };
  }

  private async checkSmtp(): Promise<Check> {
    const startedAt = Date.now();
    const ok = await this.mail.verifyConnection();
    return {
      name: 'email',
      status: ok ? 'ok' : 'degraded',
      detail: ok
        ? 'SMTP connection verified.'
        : 'SMTP is configured but the connection could not be verified.',
      latencyMs: Date.now() - startedAt,
    };
  }
}
