import { Injectable } from '@nestjs/common';
import { FUNNEL_STAGES, FunnelStage } from '@leadforge/shared';
import { PrismaService } from '@/common/prisma.service';
import type { Prisma } from '@leadforge/database';

/**
 * Analytics (docs/32).
 *
 * Every figure is computed from stored events, not estimated. Where a rate has
 * no denominator (nothing contacted yet), it reports 0 rather than a
 * misleading NaN or a fabricated baseline.
 */

export interface AnalyticsRange {
  readonly from?: Date;
  readonly to?: Date;
  readonly campaignId?: string;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(organizationId: string, range: AnalyticsRange = {}) {
    const leadWhere = this.leadWhere(organizationId, range);

    const [
      statusCounts,
      verified,
      contacted,
      replied,
      positive,
      drafts,
      approvedDrafts,
      totals,
      timeToReply,
    ] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['status'],
        where: leadWhere,
        _count: { _all: true },
      }),
      this.prisma.lead.count({ where: { ...leadWhere, verificationStatus: 'verified' } }),
      this.prisma.lead.count({ where: { ...leadWhere, lastContactedAt: { not: null } } }),
      this.prisma.lead.count({ where: { ...leadWhere, lastRepliedAt: { not: null } } }),
      this.prisma.conversation.count({
        where: {
          organizationId,
          lastSentiment: 'positive',
          ...(range.campaignId
            ? { lead: { campaignLinks: { some: { campaignId: range.campaignId } } } }
            : {}),
        },
      }),
      this.prisma.messageDraft.count({
        where: { organizationId, ...(range.campaignId ? { campaignId: range.campaignId } : {}) },
      }),
      this.prisma.messageDraft.count({
        where: {
          organizationId,
          ...(range.campaignId ? { campaignId: range.campaignId } : {}),
          status: { notIn: ['draft', 'cancelled'] },
        },
      }),
      this.workspaceTotals(organizationId, range),
      this.medianTimeToReply(organizationId, range),
    ]);

    const byStatus = new Map<string, number>(
      statusCounts.map((row) => [row.status as string, row._count._all]),
    );
    const sum = (...statuses: string[]) =>
      statuses.reduce((total, status) => total + (byStatus.get(status) ?? 0), 0);

    const discovered = statusCounts.reduce((total, row) => total + row._count._all, 0);
    const qualified = sum(
      'qualified',
      'ready',
      'contacted',
      'replied',
      'interested',
      'meeting',
      'won',
    );
    const ready = sum('ready', 'contacted', 'replied', 'interested', 'meeting', 'won');
    const meetings = sum('meeting', 'won');
    const won = sum('won');

    const counts: Record<FunnelStage, number> = {
      discovered,
      verified,
      qualified,
      ready,
      contacted,
      replied,
      positive,
      meeting: meetings,
      won,
    };

    const funnel = FUNNEL_STAGES.map((stage, index) => {
      const previousStage = index === 0 ? null : FUNNEL_STAGES[index - 1];
      const previous = previousStage ? counts[previousStage] : counts[stage];
      return {
        stage,
        count: counts[stage],
        conversion: previous > 0 ? counts[stage] / previous : 0,
      };
    });

    return {
      funnel,
      rates: {
        verification: rate(verified, discovered),
        qualification: rate(qualified, verified),
        reply: rate(replied, contacted),
        positiveReply: rate(positive, replied),
        meeting: rate(meetings, positive),
        win: rate(won, meetings),
        messageApproval: rate(approvedDrafts, drafts),
      },
      totals,
      medianTimeToReplyHours: timeToReply,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Per-campaign analytics: overview plus angle performance and a trend. */
  async forCampaign(organizationId: string, campaignId: string) {
    const [overview, angles, timeseries] = await Promise.all([
      this.overview(organizationId, { campaignId }),
      this.anglePerformance(organizationId, campaignId),
      this.timeseries(organizationId, campaignId),
    ]);

    return { campaignId, overview, angles, timeseries };
  }

  /**
   * Which opening angles actually get replies. Measured from sent messages
   * and recorded replies — never predicted.
   */
  async anglePerformance(organizationId: string, campaignId?: string) {
    const drafts = await this.prisma.messageDraft.findMany({
      where: {
        organizationId,
        ...(campaignId ? { campaignId } : {}),
        angle: { not: null },
        status: { in: ['sent', 'delivered', 'replied', 'closed', 'follow_up_due'] },
      },
      select: { angle: true, status: true, leadId: true },
    });

    if (drafts.length === 0) return [];

    const leadIds = [...new Set(drafts.map((draft) => draft.leadId))];
    const positiveLeads = new Set(
      (
        await this.prisma.conversation.findMany({
          where: { organizationId, leadId: { in: leadIds }, lastSentiment: 'positive' },
          select: { leadId: true },
        })
      ).map((conversation) => conversation.leadId),
    );

    const buckets = new Map<string, { sent: number; replied: number; positive: number }>();

    for (const draft of drafts) {
      const angle = (draft.angle ?? 'Unspecified').trim();
      const bucket = buckets.get(angle) ?? { sent: 0, replied: 0, positive: 0 };
      bucket.sent += 1;
      if (draft.status === 'replied' || draft.status === 'closed') bucket.replied += 1;
      if (positiveLeads.has(draft.leadId)) bucket.positive += 1;
      buckets.set(angle, bucket);
    }

    return (
      [...buckets.entries()]
        .map(([angle, bucket]) => ({
          angle,
          sent: bucket.sent,
          replied: bucket.replied,
          positive: bucket.positive,
          replyRate: rate(bucket.replied, bucket.sent),
        }))
        // Rank by reply rate, but a single lucky send should not top the list.
        .sort((a, b) => b.replyRate - a.replyRate || b.sent - a.sent)
        .slice(0, 10)
    );
  }

  /** Daily pipeline movement for the last 30 days. */
  async timeseries(organizationId: string, campaignId?: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    since.setUTCHours(0, 0, 0, 0);

    const leads = await this.prisma.lead.findMany({
      where: {
        organizationId,
        createdAt: { gte: since },
        ...(campaignId ? { campaignLinks: { some: { campaignId } } } : {}),
      },
      select: {
        createdAt: true,
        status: true,
        lastContactedAt: true,
        lastRepliedAt: true,
        leadScore: true,
      },
    });

    const buckets = new Map<
      string,
      { discovered: number; qualified: number; contacted: number; replied: number }
    >();

    for (let i = 0; i < days; i += 1) {
      const date = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
      buckets.set(dayKey(date), { discovered: 0, qualified: 0, contacted: 0, replied: 0 });
    }

    for (const lead of leads) {
      const discoveredKey = dayKey(lead.createdAt);
      const bucket = buckets.get(discoveredKey);
      if (bucket) {
        bucket.discovered += 1;
        if ((lead.leadScore ?? 0) >= 60) bucket.qualified += 1;
      }

      if (lead.lastContactedAt) {
        const contactedBucket = buckets.get(dayKey(lead.lastContactedAt));
        if (contactedBucket) contactedBucket.contacted += 1;
      }
      if (lead.lastRepliedAt) {
        const repliedBucket = buckets.get(dayKey(lead.lastRepliedAt));
        if (repliedBucket) repliedBucket.replied += 1;
      }
    }

    return [...buckets.entries()].map(([date, values]) => ({ date: date.slice(5), ...values }));
  }

  /** AI usage aggregated by model and task. */
  async aiUsage(organizationId: string, range: { from?: Date; to?: Date } = {}) {
    const where = {
      organizationId,
      ...(range.from || range.to
        ? {
            createdAt: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lte: range.to } : {}),
            },
          }
        : {}),
    };

    const rows = await this.prisma.aiUsage.findMany({
      where,
      select: {
        model: true,
        provider: true,
        task: true,
        inputTokens: true,
        outputTokens: true,
        estimatedCostUsd: true,
        latencyMs: true,
        success: true,
      },
    });

    if (rows.length === 0) {
      return {
        requests: 0,
        failures: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        byModel: [],
        byTask: [],
      };
    }

    const byModel = new Map<
      string,
      {
        model: string;
        provider: string;
        requests: number;
        inputTokens: number;
        outputTokens: number;
        estimatedCostUsd: number;
        latencyTotal: number;
        failures: number;
      }
    >();
    const byTask = new Map<string, { task: string; requests: number; estimatedCostUsd: number }>();

    let failures = 0;
    const latencies: number[] = [];

    for (const row of rows) {
      if (!row.success) failures += 1;
      latencies.push(row.latencyMs);

      const modelKey = `${row.provider}:${row.model}`;
      const model = byModel.get(modelKey) ?? {
        model: row.model,
        provider: row.provider,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        latencyTotal: 0,
        failures: 0,
      };
      model.requests += 1;
      model.inputTokens += row.inputTokens;
      model.outputTokens += row.outputTokens;
      model.estimatedCostUsd += row.estimatedCostUsd;
      model.latencyTotal += row.latencyMs;
      if (!row.success) model.failures += 1;
      byModel.set(modelKey, model);

      const task = byTask.get(row.task) ?? { task: row.task, requests: 0, estimatedCostUsd: 0 };
      task.requests += 1;
      task.estimatedCostUsd += row.estimatedCostUsd;
      byTask.set(row.task, task);
    }

    latencies.sort((a, b) => a - b);
    const p95Index = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));

    return {
      requests: rows.length,
      failures,
      inputTokens: rows.reduce((total, row) => total + row.inputTokens, 0),
      outputTokens: rows.reduce((total, row) => total + row.outputTokens, 0),
      estimatedCostUsd: round(
        rows.reduce((total, row) => total + row.estimatedCostUsd, 0),
        6,
      ),
      avgLatencyMs: Math.round(
        latencies.reduce((total, value) => total + value, 0) / latencies.length,
      ),
      p95LatencyMs: latencies[p95Index] ?? 0,
      byModel: [...byModel.values()]
        .map((model) => ({
          model: model.model,
          provider: model.provider,
          requests: model.requests,
          inputTokens: model.inputTokens,
          outputTokens: model.outputTokens,
          estimatedCostUsd: round(model.estimatedCostUsd, 6),
          avgLatencyMs: Math.round(model.latencyTotal / model.requests),
          failures: model.failures,
        }))
        .sort((a, b) => b.requests - a.requests),
      byTask: [...byTask.values()]
        .map((task) => ({ ...task, estimatedCostUsd: round(task.estimatedCostUsd, 6) }))
        .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd),
    };
  }

  /* ------------------------------------------------------------- helpers */

  private leadWhere(organizationId: string, range: AnalyticsRange): Prisma.LeadWhereInput {
    return {
      organizationId,
      mergedIntoId: null,
      ...(range.campaignId ? { campaignLinks: { some: { campaignId: range.campaignId } } } : {}),
      ...(range.from || range.to
        ? {
            createdAt: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lte: range.to } : {}),
            },
          }
        : {}),
    };
  }

  private async workspaceTotals(organizationId: string, range: AnalyticsRange) {
    const [campaigns, activeCampaigns, leads, messagesSent, conversations, openConversations] =
      await Promise.all([
        this.prisma.campaign.count({ where: { organizationId, status: { not: 'archived' } } }),
        this.prisma.campaign.count({
          where: { organizationId, status: { in: ['running', 'queued'] } },
        }),
        this.prisma.lead.count({ where: this.leadWhere(organizationId, range) }),
        this.prisma.messageDraft.count({
          where: {
            organizationId,
            ...(range.campaignId ? { campaignId: range.campaignId } : {}),
            sentAt: { not: null },
          },
        }),
        this.prisma.conversation.count({ where: { organizationId } }),
        this.prisma.conversation.count({
          where: { organizationId, status: { in: ['open', 'needs_human', 'awaiting_reply'] } },
        }),
      ]);

    return { campaigns, activeCampaigns, leads, messagesSent, conversations, openConversations };
  }

  /** Median hours between the first outbound message and the first reply. */
  private async medianTimeToReply(
    organizationId: string,
    range: AnalyticsRange,
  ): Promise<number | null> {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        organizationId,
        firstRepliedAt: { not: null },
        ...(range.campaignId
          ? { lead: { campaignLinks: { some: { campaignId: range.campaignId } } } }
          : {}),
      },
      select: { createdAt: true, firstRepliedAt: true },
      take: 1_000,
    });

    const durations = conversations
      .map((conversation) =>
        conversation.firstRepliedAt
          ? (conversation.firstRepliedAt.getTime() - conversation.createdAt.getTime()) /
            (60 * 60 * 1000)
          : null,
      )
      .filter((value): value is number => value !== null && value >= 0)
      .sort((a, b) => a - b);

    if (durations.length === 0) return null;

    const middle = Math.floor(durations.length / 2);
    const median =
      durations.length % 2 === 0
        ? ((durations[middle - 1] ?? 0) + (durations[middle] ?? 0)) / 2
        : (durations[middle] ?? 0);

    return round(median, 1);
  }
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? round(numerator / denominator, 4) : 0;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
