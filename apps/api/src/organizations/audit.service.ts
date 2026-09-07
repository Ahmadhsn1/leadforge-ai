import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma.service';
import { currentLogContext, logger } from '@/common/logger';

export interface AuditInput {
  readonly organizationId: string;
  readonly userId?: string | null;
  /** Verb, e.g. "login", "approve_message", "update_integration". */
  readonly action: string;
  /** Noun, e.g. "campaign", "lead", "session". */
  readonly resource: string;
  readonly resourceId?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly requestId?: string;
}

/** Keys never written to the audit log, even if a caller passes them. */
const FORBIDDEN_METADATA_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'token',
  'tokenHash',
  'apiKey',
  'secret',
  'encryptedSecret',
  'accessToken',
]);

/**
 * Audit trail (docs/30). Every security-sensitive action and every important
 * business mutation is recorded. Writing an audit row must never fail the
 * operation it describes, so failures are logged and swallowed.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId ?? null,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId ?? null,
          metadata: this.sanitize(input.metadata) as never,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
          requestId: input.requestId ?? currentLogContext()?.requestId ?? null,
        },
      });
    } catch (error) {
      logger('audit').error(
        { err: error, action: input.action, resource: input.resource },
        'failed to write audit entry',
      );
    }
  }

  async list(organizationId: string, options: { page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { organizationId },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where: { organizationId } }),
    ]);

    return {
      items: items.map((entry) => ({
        id: entry.id,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        userName: entry.user?.name ?? null,
        ipAddress: entry.ipAddress,
        metadata: entry.metadata,
        createdAt: entry.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Drops secret-shaped keys and truncates long values. */
  private sanitize(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!metadata) return {};
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (FORBIDDEN_METADATA_KEYS.has(key)) continue;
      if (typeof value === 'string') clean[key] = value.slice(0, 500);
      else if (value === null || ['number', 'boolean'].includes(typeof value)) clean[key] = value;
      else if (Array.isArray(value)) clean[key] = value.slice(0, 20);
      else if (typeof value === 'object')
        clean[key] = this.sanitize(value as Record<string, unknown>);
    }
    return clean;
  }
}
