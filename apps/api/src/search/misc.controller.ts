import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { ACTIVITY_LABELS, trimmed } from '@leadforge/shared';
import { zodBody, zodQuery } from '@/common/http';
import { PrismaService } from '@/common/prisma.service';
import { Auth, OrgId } from '@/auth/auth.guard';
import type { AuthContext } from '@/auth/auth.types';

const searchSchema = z.object({ q: trimmed(160) });

const notificationPreferencesSchema = z.object({
  campaignCompleted: z.boolean().optional(),
  highPriorityLeads: z.boolean().optional(),
  newReply: z.boolean().optional(),
  needsHuman: z.boolean().optional(),
  jobFailures: z.boolean().optional(),
  integrationIssues: z.boolean().optional(),
  aiBudgetWarnings: z.boolean().optional(),
  weeklySummary: z.boolean().optional(),
});

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  createdAt: string;
}

const DEFAULT_PREFERENCES = {
  campaignCompleted: true,
  highPriorityLeads: true,
  newReply: true,
  needsHuman: true,
  jobFailures: true,
  integrationIssues: true,
  aiBudgetWarnings: true,
  weeklySummary: false,
};

/** Global search and notifications — small surfaces that share a controller. */
@Controller()
export class MiscController {
  constructor(private readonly prisma: PrismaService) {}

  /** Universal search across leads, campaigns and conversations. */
  @Get('search')
  async search(
    @OrgId() organizationId: string,
    @Query(zodQuery(searchSchema)) query: z.infer<typeof searchSchema>,
  ) {
    const term = query.q;
    const contains = { contains: term, mode: 'insensitive' as const };

    const [leads, campaigns, conversations] = await Promise.all([
      this.prisma.lead.findMany({
        where: {
          organizationId,
          mergedIntoId: null,
          OR: [
            { canonicalName: contains },
            { phone: { contains: term } },
            { domainKey: { contains: term.toLowerCase() } },
            { city: contains },
          ],
        },
        select: { id: true, canonicalName: true, city: true, category: true, leadScore: true },
        orderBy: { leadScore: { sort: 'desc', nulls: 'last' } },
        take: 6,
      }),
      this.prisma.campaign.findMany({
        where: { organizationId, name: contains },
        select: { id: true, name: true, status: true, channel: true },
        take: 4,
      }),
      this.prisma.conversation.findMany({
        where: { organizationId, lead: { canonicalName: contains } },
        select: {
          id: true,
          channel: true,
          status: true,
          lead: { select: { canonicalName: true } },
        },
        orderBy: { lastMessageAt: 'desc' },
        take: 4,
      }),
    ]);

    return [
      {
        type: 'lead' as const,
        items: leads.map((lead) => ({
          id: lead.id,
          title: lead.canonicalName,
          subtitle: [lead.city, lead.category].filter(Boolean).join(' · ') || null,
          href: `/dashboard/leads/${lead.id}`,
          meta: lead.leadScore !== null ? String(lead.leadScore) : null,
        })),
      },
      {
        type: 'campaign' as const,
        items: campaigns.map((campaign) => ({
          id: campaign.id,
          title: campaign.name,
          subtitle: `${campaign.channel} · ${campaign.status}`,
          href: `/dashboard/campaigns/${campaign.id}`,
          meta: null,
        })),
      },
      {
        type: 'conversation' as const,
        items: conversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.lead.canonicalName,
          subtitle: `${conversation.channel} · ${conversation.status}`,
          href: `/dashboard/conversations?id=${conversation.id}`,
          meta: null,
        })),
      },
    ];
  }

  /**
   * Notifications, derived from activity and pipeline state rather than a
   * separate table — nothing can be "notified" that did not actually happen.
   */
  @Get('notifications')
  async notifications(@OrgId() organizationId: string) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [activities, needsHuman, pendingApprovals, failedJobs] = await Promise.all([
      this.prisma.activity.findMany({
        where: {
          organizationId,
          createdAt: { gte: since },
          type: { in: ['replied', 'meeting', 'won', 'analyzed', 'error'] },
        },
        include: { lead: { select: { id: true, canonicalName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
      this.prisma.conversation.count({
        where: { organizationId, needsHuman: true, status: { not: 'closed' } },
      }),
      this.prisma.messageDraft.count({ where: { organizationId, status: 'draft' } }),
      this.prisma.jobRecord.count({
        where: { organizationId, status: 'dead_letter', updatedAt: { gte: since } },
      }),
    ]);

    const notifications: NotificationItem[] = activities.map((activity) => ({
      id: activity.id,
      type: activity.type as string,
      title: activity.lead
        ? `${ACTIVITY_LABELS[activity.type] ?? activity.type}: ${activity.lead.canonicalName}`
        : (ACTIVITY_LABELS[activity.type] ?? activity.type),
      body: activity.summary,
      href: activity.lead ? `/dashboard/leads/${activity.lead.id}` : null,
      read: false,
      createdAt: activity.createdAt.toISOString(),
    }));

    if (needsHuman > 0) {
      notifications.unshift({
        id: 'needs-human',
        type: 'needs_human',
        title: `${needsHuman} conversation${needsHuman === 1 ? '' : 's'} need a human`,
        body: 'A reply was classified as needing judgement rather than a templated answer.',
        href: '/dashboard/conversations?status=needs_human',
        read: false,
        createdAt: new Date().toISOString(),
      });
    }

    if (pendingApprovals > 0) {
      notifications.unshift({
        id: 'pending-approvals',
        type: 'pending_approvals',
        title: `${pendingApprovals} message${pendingApprovals === 1 ? '' : 's'} waiting for approval`,
        body: 'Nothing sends until you review it.',
        href: '/dashboard/outreach',
        read: false,
        createdAt: new Date().toISOString(),
      });
    }

    if (failedJobs > 0) {
      notifications.unshift({
        id: 'failed-jobs',
        type: 'job_failures',
        title: `${failedJobs} job${failedJobs === 1 ? '' : 's'} failed permanently`,
        body: 'These exhausted their retries and are in the dead-letter queue.',
        href: '/dashboard/settings/health',
        read: false,
        createdAt: new Date().toISOString(),
      });
    }

    return notifications;
  }

  @Get('notifications/preferences')
  async preferences(@Auth() auth: AuthContext) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: auth.organization.id },
      select: { settings: true },
    });

    const settings = (organization.settings as { notifications?: Record<string, boolean> }) ?? {};
    return { ...DEFAULT_PREFERENCES, ...(settings.notifications ?? {}) };
  }

  @Patch('notifications/preferences')
  async updatePreferences(
    @Auth() auth: AuthContext,
    @Body(zodBody(notificationPreferencesSchema))
    body: z.infer<typeof notificationPreferencesSchema>,
  ) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: auth.organization.id },
      select: { settings: true },
    });

    const settings = (organization.settings as Record<string, unknown>) ?? {};
    const notifications = {
      ...DEFAULT_PREFERENCES,
      ...((settings.notifications as Record<string, boolean>) ?? {}),
      ...body,
    };

    await this.prisma.organization.update({
      where: { id: auth.organization.id },
      data: { settings: { ...settings, notifications } as never },
    });

    return notifications;
  }
}
