import { Controller, Get } from '@nestjs/common';
import { capabilities } from '@leadforge/config';
import { PrismaService } from '@/common/prisma.service';
import { Auth } from '@/auth/auth.guard';
import { AnalyticsService } from '@/analytics/analytics.service';
import { CampaignsService } from '@/campaigns/campaigns.service';
import type { AuthContext } from '@/auth/auth.types';

/**
 * Dashboard aggregate.
 *
 * One request builds the whole overview screen: metrics with period-over-period
 * change, the funnel, cross-lead AI insights, active campaigns, recent activity
 * and what needs a human. Doing it here keeps the client to a single round trip
 * and keeps the "what matters" logic on the server.
 */
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly campaigns: CampaignsService,
  ) {}

  @Get()
  async overview(@Auth() auth: AuthContext) {
    const organizationId = auth.organization.id;
    const now = new Date();
    const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const previousStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [overview, metrics, activeCampaigns, recentActivity, attention, insights] =
      await Promise.all([
        this.analytics.overview(organizationId),
        this.metrics(organizationId, periodStart, previousStart),
        this.activeCampaigns(organizationId),
        this.recentActivity(organizationId),
        this.attention(organizationId),
        this.insights(organizationId),
      ]);

    return {
      greetingName: auth.user.name.split(' ')[0] ?? auth.user.name,
      metrics,
      funnel: overview.funnel,
      insights,
      activeCampaigns,
      recentActivity,
      attention,
    };
  }

  /** Counts for the current 30 days, with change against the prior 30. */
  private async metrics(organizationId: string, periodStart: Date, previousStart: Date) {
    const base = { organizationId, mergedIntoId: null };

    const [
      qualified,
      qualifiedPrev,
      verified,
      verifiedPrev,
      highIntent,
      highIntentPrev,
      replies,
      repliesPrev,
      meetings,
      meetingsPrev,
    ] = await Promise.all([
      this.prisma.lead.count({
        where: {
          ...base,
          status: {
            in: ['qualified', 'ready', 'contacted', 'replied', 'interested', 'meeting', 'won'],
          },
          createdAt: { gte: periodStart },
        },
      }),
      this.prisma.lead.count({
        where: {
          ...base,
          status: {
            in: ['qualified', 'ready', 'contacted', 'replied', 'interested', 'meeting', 'won'],
          },
          createdAt: { gte: previousStart, lt: periodStart },
        },
      }),
      this.prisma.lead.count({
        where: { ...base, verificationStatus: 'verified', createdAt: { gte: periodStart } },
      }),
      this.prisma.lead.count({
        where: {
          ...base,
          verificationStatus: 'verified',
          createdAt: { gte: previousStart, lt: periodStart },
        },
      }),
      this.prisma.lead.count({
        where: { ...base, temperature: 'hot', createdAt: { gte: periodStart } },
      }),
      this.prisma.lead.count({
        where: { ...base, temperature: 'hot', createdAt: { gte: previousStart, lt: periodStart } },
      }),
      this.prisma.lead.count({ where: { ...base, lastRepliedAt: { gte: periodStart } } }),
      this.prisma.lead.count({
        where: { ...base, lastRepliedAt: { gte: previousStart, lt: periodStart } },
      }),
      this.prisma.lead.count({
        where: { ...base, status: { in: ['meeting', 'won'] }, updatedAt: { gte: periodStart } },
      }),
      this.prisma.lead.count({
        where: {
          ...base,
          status: { in: ['meeting', 'won'] },
          updatedAt: { gte: previousStart, lt: periodStart },
        },
      }),
    ]);

    return {
      qualifiedLeads: { value: qualified, changePct: change(qualified, qualifiedPrev) },
      verified: { value: verified, changePct: change(verified, verifiedPrev) },
      highIntent: { value: highIntent, changePct: change(highIntent, highIntentPrev) },
      replies: { value: replies, changePct: change(replies, repliesPrev) },
      meetings: { value: meetings, changePct: change(meetings, meetingsPrev) },
    };
  }

  private async activeCampaigns(organizationId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { organizationId, status: { in: ['running', 'queued', 'paused', 'completed'] } },
      orderBy: [{ updatedAt: 'desc' }],
      take: 6,
    });
    return Promise.all(campaigns.map((campaign) => this.campaigns.serialize(campaign)));
  }

  private async recentActivity(organizationId: string) {
    const activities = await this.prisma.activity.findMany({
      where: { organizationId },
      include: { lead: { select: { id: true, canonicalName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });

    return activities.map((activity) => ({
      id: activity.id,
      type: activity.type,
      summary: activity.summary,
      actor: activity.actor,
      actorName: null,
      metadata: activity.metadata as Record<string, unknown>,
      createdAt: activity.createdAt.toISOString(),
      leadId: activity.lead?.id ?? null,
      leadName: activity.lead?.canonicalName ?? null,
    }));
  }

  /** What is blocked on a human right now. */
  private async attention(organizationId: string) {
    const caps = capabilities();
    const [needsHuman, pendingApprovals, failedJobs] = await Promise.all([
      this.prisma.conversation.count({
        where: { organizationId, needsHuman: true, status: { not: 'closed' } },
      }),
      this.prisma.messageDraft.count({ where: { organizationId, status: 'draft' } }),
      this.prisma.jobRecord.count({ where: { organizationId, status: 'dead_letter' } }),
    ]);

    const integrationsNeedingSetup: string[] = [];
    if (!caps.ai) integrationsNeedingSetup.push('OpenRouter');
    if (!caps.googlePlaces) integrationsNeedingSetup.push('Google Places');

    return {
      needsHumanConversations: needsHuman,
      pendingApprovals,
      failedJobs,
      integrationsNeedingSetup,
    };
  }

  /**
   * Cross-lead patterns. Derived from stored analyses, not generated fresh —
   * a dashboard load must not cost an AI call.
   */
  private async insights(organizationId: string) {
    const insights: {
      id: string;
      kind: 'opportunity' | 'industry' | 'angle' | 'action';
      label: string;
      value: string;
      detail: string | null;
      count: number | null;
      href: string | null;
    }[] = [];

    /* Most common observable opportunity. */
    const analyses = await this.prisma.websiteAnalysis.findMany({
      where: { organizationId },
      select: { opportunitySignals: true },
      take: 2_000,
    });

    const signalCounts = new Map<string, number>();
    for (const analysis of analyses) {
      for (const signal of (analysis.opportunitySignals as string[]) ?? []) {
        signalCounts.set(signal, (signalCounts.get(signal) ?? 0) + 1);
      }
    }
    const topSignal = [...signalCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topSignal) {
      insights.push({
        id: 'opportunity-top',
        kind: 'opportunity',
        label: 'Most common opportunity',
        value: topSignal[0],
        detail: `Observed on ${topSignal[1]} businesses in your pipeline.`,
        count: topSignal[1],
        href: '/dashboard/leads?temperature=hot',
      });
    }

    /* Best-performing industry, by share of hot leads. */
    const categories = await this.prisma.lead.groupBy({
      by: ['category'],
      where: { organizationId, category: { not: null }, temperature: 'hot' },
      _count: { _all: true },
      orderBy: { _count: { category: 'desc' } },
      take: 1,
    });
    const topCategory = categories[0];
    if (topCategory?.category) {
      insights.push({
        id: 'industry-top',
        kind: 'industry',
        label: 'Highest-performing industry',
        value: topCategory.category,
        detail: `${topCategory._count._all} high-priority leads in this category.`,
        count: topCategory._count._all,
        href: `/dashboard/leads?search=${encodeURIComponent(topCategory.category)}`,
      });
    }

    /* Best angle, measured from real replies. */
    const angles = await this.analytics.anglePerformance(organizationId);
    const bestAngle = angles.find((angle) => angle.sent >= 3) ?? angles[0];
    if (bestAngle) {
      insights.push({
        id: 'angle-top',
        kind: 'angle',
        label: 'Best outreach angle',
        value: bestAngle.angle,
        detail: `${(bestAngle.replyRate * 100).toFixed(0)}% reply rate across ${bestAngle.sent} sent messages.`,
        count: null,
        href: '/dashboard/analytics',
      });
    }

    /* The single most useful next action. */
    const readyHighIntent = await this.prisma.lead.count({
      where: { organizationId, temperature: 'hot', status: { in: ['ready', 'qualified'] } },
    });
    if (readyHighIntent > 0) {
      insights.push({
        id: 'action-review',
        kind: 'action',
        label: 'Recommended action',
        value: `Review ${readyHighIntent} high-intent prospects`,
        detail: 'Scored 90 or above and not yet contacted.',
        count: readyHighIntent,
        href: '/dashboard/leads?temperature=hot&status=ready',
      });
    }

    return insights;
  }
}

/** Period-over-period change as a fraction, or null when there is no baseline. */
function change(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 1 : null;
  return Math.round(((current - previous) / previous) * 1000) / 1000;
}
