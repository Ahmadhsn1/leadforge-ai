import { Injectable } from '@nestjs/common';
import {
  canonicalizeUrl,
  normalizeEmail,
  normalizePhone,
  socialHandleFromUrl,
  Channel,
  SuppressionScope,
} from '@leadforge/shared';
import { PrismaService } from '@/common/prisma.service';
import { logger } from '@/common/logger';

/**
 * Suppression / do-not-contact (docs/22, docs/31).
 *
 * Checked twice: when a message is queued, and again immediately before the
 * send. The second check is the important one — a suppression added while a
 * message sat in the queue must still stop it.
 */

export interface SuppressionHit {
  readonly scope: SuppressionScope;
  readonly value: string;
  readonly reason: string | null;
}

@Injectable()
export class SuppressionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Normalises a value so lookups match regardless of input formatting. */
  normalizeValue(scope: SuppressionScope, value: string, country = 'GB'): string | null {
    switch (scope) {
      case 'phone': {
        const phone = normalizePhone(value, country);
        return phone.e164 ?? null;
      }
      case 'email':
        return normalizeEmail(value);
      case 'domain': {
        const url = canonicalizeUrl(value);
        return url.domain ?? (value.trim().toLowerCase() || null);
      }
      case 'instagram': {
        const handle = value.startsWith('http')
          ? socialHandleFromUrl(value)
          : value.replace(/^@/, '');
        return handle ? handle.toLowerCase() : null;
      }
      case 'lead':
        return value.trim() || null;
      default:
        return value.trim().toLowerCase() || null;
    }
  }

  async add(
    organizationId: string,
    scope: SuppressionScope,
    rawValue: string,
    options: { reason?: string; createdById?: string; country?: string } = {},
  ) {
    const value = this.normalizeValue(scope, rawValue, options.country);
    if (!value) {
      throw new Error(`"${rawValue}" is not a valid ${scope} value to suppress.`);
    }

    const suppression = await this.prisma.suppression.upsert({
      where: { organizationId_scope_value: { organizationId, scope, value } },
      create: {
        organizationId,
        scope,
        value,
        reason: options.reason ?? null,
        createdById: options.createdById ?? null,
      },
      update: { reason: options.reason ?? null },
    });

    // A suppression must also stop work already in flight.
    await this.cancelPendingFor(organizationId, scope, value);

    logger('suppression').info({ scope, organizationId }, 'suppression added');
    return suppression;
  }

  /**
   * Checks every identifier a lead can be reached on.
   * @returns the first matching suppression, or null.
   */
  async checkLead(
    organizationId: string,
    leadId: string,
    channel?: Channel,
  ): Promise<SuppressionHit | null> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId },
      include: { socialProfiles: { where: { platform: 'instagram' }, take: 1 } },
    });
    if (!lead) return null;

    const candidates: { scope: SuppressionScope; value: string }[] = [
      { scope: 'lead', value: lead.id },
    ];

    if (lead.phoneKey) candidates.push({ scope: 'phone', value: lead.phoneKey });
    if (lead.email) {
      const email = normalizeEmail(lead.email);
      if (email) candidates.push({ scope: 'email', value: email });
    }
    if (lead.domainKey) candidates.push({ scope: 'domain', value: lead.domainKey });

    const instagram = lead.socialProfiles[0];
    if (instagram) {
      const handle = instagram.username ?? socialHandleFromUrl(instagram.profileUrl);
      if (handle) candidates.push({ scope: 'instagram', value: handle.toLowerCase() });
    }

    // Narrow to the channel actually being used where it makes sense; a lead
    // suppression and a domain suppression always apply.
    const relevant = channel
      ? candidates.filter((candidate) => {
          if (candidate.scope === 'lead' || candidate.scope === 'domain') return true;
          if (channel === 'whatsapp') return candidate.scope === 'phone';
          if (channel === 'email') return candidate.scope === 'email';
          if (channel === 'instagram') return candidate.scope === 'instagram';
          return true;
        })
      : candidates;

    if (relevant.length === 0) return null;

    const match = await this.prisma.suppression.findFirst({
      where: {
        organizationId,
        OR: relevant.map((candidate) => ({ scope: candidate.scope, value: candidate.value })),
      },
    });

    if (!match) return null;
    return { scope: match.scope, value: match.value, reason: match.reason };
  }

  /** Direct check for a recipient string, used immediately before sending. */
  async checkRecipient(
    organizationId: string,
    scope: SuppressionScope,
    rawValue: string,
    country = 'GB',
  ): Promise<SuppressionHit | null> {
    const value = this.normalizeValue(scope, rawValue, country);
    if (!value) return null;

    const match = await this.prisma.suppression.findUnique({
      where: { organizationId_scope_value: { organizationId, scope, value } },
    });

    return match ? { scope: match.scope, value: match.value, reason: match.reason } : null;
  }

  async list(
    organizationId: string,
    options: { page?: number; pageSize?: number; search?: string } = {},
  ) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));

    const where = {
      organizationId,
      ...(options.search
        ? { value: { contains: options.search, mode: 'insensitive' as const } }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.suppression.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.suppression.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        scope: item.scope,
        value: item.value,
        reason: item.reason,
        createdAt: item.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async remove(organizationId: string, id: string): Promise<void> {
    await this.prisma.suppression.deleteMany({ where: { id, organizationId } });
  }

  /**
   * Blocks queued and approved drafts, and stops running sequences, for
   * everything matching a newly added suppression.
   */
  private async cancelPendingFor(
    organizationId: string,
    scope: SuppressionScope,
    value: string,
  ): Promise<void> {
    const leadWhere =
      scope === 'lead'
        ? { id: value }
        : scope === 'phone'
          ? { phoneKey: value }
          : scope === 'email'
            ? { email: value }
            : scope === 'domain'
              ? { domainKey: value }
              : { socialProfiles: { some: { platform: 'instagram' as const, username: value } } };

    const leads = await this.prisma.lead.findMany({
      where: { organizationId, ...leadWhere },
      select: { id: true },
    });
    if (leads.length === 0) return;

    const leadIds = leads.map((lead) => lead.id);

    await this.prisma.$transaction([
      this.prisma.messageDraft.updateMany({
        where: {
          organizationId,
          leadId: { in: leadIds },
          status: { in: ['draft', 'approved', 'queued'] },
        },
        data: {
          status: 'do_not_contact',
          failureReason: 'Recipient was added to the do-not-contact list.',
        },
      }),
      this.prisma.sequenceRun.updateMany({
        where: { organizationId, leadId: { in: leadIds }, status: 'active' },
        data: { status: 'stopped', stoppedReason: 'suppressed', nextRunAt: null },
      }),
      this.prisma.lead.updateMany({
        where: { organizationId, id: { in: leadIds } },
        data: { status: 'do_not_contact' },
      }),
      this.prisma.activity.createMany({
        data: leadIds.map((leadId) => ({
          organizationId,
          leadId,
          type: 'suppressed' as const,
          summary: `Added to the do-not-contact list by ${scope}. Pending outreach was cancelled.`,
          actor: 'user',
        })),
      }),
    ]);

    logger('suppression').info(
      { leads: leadIds.length, scope },
      'cancelled pending outreach for suppression',
    );
  }
}
