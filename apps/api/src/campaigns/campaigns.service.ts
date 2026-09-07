import { Injectable } from '@nestjs/common';
import {
  AppError,
  JOB_NAMES,
  PLAN_QUOTAS,
  paginate,
  skipTake,
  CampaignStatus,
  CreateCampaignInput,
  Pagination,
  Plan,
  UpdateCampaignInput,
} from '@leadforge/shared';
import { currentPeriod } from '@leadforge/database';
import { capabilities } from '@leadforge/config';
import { PrismaService } from '@/common/prisma.service';
import { QueueService } from '@/jobs/queue.service';
import { SequenceService } from '@/outreach/sequence.service';
import { logger } from '@/common/logger';

/**
 * Campaign lifecycle and pipeline orchestration.
 *
 * A campaign owns runs; a run owns the discovery job that fans out into the
 * rest of the pipeline. Starting a campaign is therefore a single enqueue —
 * every later stage is triggered by the stage before it completing.
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly sequences: SequenceService,
  ) {}

  async list(
    organizationId: string,
    query: Pagination & { status?: CampaignStatus; search?: string },
  ) {
    const where = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };

    const [campaigns, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        include: { runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.campaign.count({ where }),
    ]);

    const items = await Promise.all(campaigns.map((campaign) => this.serialize(campaign)));
    return paginate(items, total, query);
  }

  async get(organizationId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, organizationId },
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!campaign) throw AppError.notFound('Campaign', id);
    return this.serialize(campaign);
  }

  async create(organizationId: string, userId: string, input: CreateCampaignInput) {
    await this.assertCampaignQuota(organizationId);

    // Seed default sequences on the first campaign, so follow-ups work
    // without the user having to discover the sequences screen first.
    await this.sequences.seedDefaults(organizationId);

    const campaign = await this.prisma.campaign.create({
      data: {
        organizationId,
        name: input.name,
        description: input.description ?? null,
        source: input.source,
        channel: input.channel,
        target: input.target as never,
        filters: input.filters as never,
        aiSettings: input.ai as never,
        autoPersonalize: input.autoPersonalize,
        sequenceId: input.sequenceId ?? null,
        createdById: userId,
        status: 'draft',
      },
      include: { runs: true },
    });

    logger('campaigns').info({ campaignId: campaign.id }, 'campaign created');
    return this.serialize(campaign);
  }

  async update(organizationId: string, id: string, input: UpdateCampaignInput) {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, organizationId } });
    if (!campaign) throw AppError.notFound('Campaign', id);

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.channel !== undefined ? { channel: input.channel } : {}),
        ...(input.target !== undefined ? { target: input.target as never } : {}),
        ...(input.filters !== undefined ? { filters: input.filters as never } : {}),
        ...(input.ai !== undefined
          ? { aiSettings: { ...(campaign.aiSettings as object), ...input.ai } as never }
          : {}),
        ...(input.autoPersonalize !== undefined ? { autoPersonalize: input.autoPersonalize } : {}),
        ...(input.sequenceId !== undefined ? { sequenceId: input.sequenceId ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    return this.serialize(updated);
  }

  /**
   * Starts a run: creates the CampaignRun and enqueues discovery.
   * Refuses when a run is already in flight, so a double-click cannot
   * double-charge the provider.
   */
  async start(
    organizationId: string,
    id: string,
    options: { leadLimit?: number; refresh?: boolean } = {},
  ) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, organizationId },
      include: { runs: { where: { status: { in: ['queued', 'running'] } }, take: 1 } },
    });
    if (!campaign) throw AppError.notFound('Campaign', id);

    if (campaign.runs.length > 0) {
      throw AppError.conflict('This campaign already has a run in progress.');
    }

    if (campaign.source === 'google_places' && !capabilities().googlePlaces) {
      throw AppError.providerNotConfigured('Google Places discovery');
    }

    await this.assertLeadQuota(organizationId);

    const target = campaign.target as { leadLimit?: number };
    const leadLimit = options.leadLimit ?? target.leadLimit ?? 100;

    const run = await this.prisma.campaignRun.create({
      data: {
        organizationId,
        campaignId: id,
        status: 'queued',
        stage: 'discovery',
        leadLimit,
        refresh: options.refresh ?? false,
      },
    });

    await this.prisma.campaign.update({ where: { id }, data: { status: 'queued' } });

    await this.queue.enqueue('discovery', JOB_NAMES.discoveryRun, {
      organizationId,
      idempotencyKey: this.queue.buildKey('discovery.run', run.id),
      inputVersion: 1,
      campaignId: id,
      runId: run.id,
      leadLimit,
      refresh: options.refresh ?? false,
    });

    await this.prisma.activity.create({
      data: {
        organizationId,
        campaignId: id,
        type: 'discovered',
        summary: `Run started with a limit of ${leadLimit} leads.`,
        actor: 'user',
      },
    });

    logger('campaigns').info({ campaignId: id, runId: run.id, leadLimit }, 'campaign run started');
    return this.serializeRun(run);
  }

  /**
   * Pauses a campaign: stops queueing new work, drains what is waiting, and
   * halts follow-up sequences. In-flight jobs are allowed to finish so nothing
   * is left half-written.
   */
  async pause(organizationId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, organizationId },
      include: { runs: { where: { status: { in: ['queued', 'running'] } } } },
    });
    if (!campaign) throw AppError.notFound('Campaign', id);

    for (const run of campaign.runs) {
      await this.queue.drainRun(run.id);
      await this.prisma.campaignRun.update({ where: { id: run.id }, data: { status: 'paused' } });
    }

    await this.sequences.stopForCampaign(organizationId, id);
    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: 'paused' },
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    logger('campaigns').info(
      { campaignId: id, drainedRuns: campaign.runs.length },
      'campaign paused',
    );
    return this.serialize(updated);
  }

  /** Resumes a paused run by re-enqueuing discovery from where it stopped. */
  async resume(organizationId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, organizationId },
      include: { runs: { where: { status: 'paused' }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!campaign) throw AppError.notFound('Campaign', id);

    const run = campaign.runs[0];
    if (!run) {
      // Nothing paused to resume: start a fresh run instead.
      return this.start(organizationId, id);
    }

    await this.prisma.campaignRun.update({ where: { id: run.id }, data: { status: 'queued' } });
    await this.prisma.campaign.update({ where: { id }, data: { status: 'queued' } });

    await this.queue.enqueue('discovery', JOB_NAMES.discoveryRun, {
      organizationId,
      // A new key: this is a distinct unit of work from the original run job.
      idempotencyKey: this.queue.buildKey('discovery.run', run.id, 'resume', Date.now()),
      inputVersion: 1,
      campaignId: id,
      runId: run.id,
      leadLimit: run.leadLimit,
      refresh: run.refresh,
    });

    const updated = await this.prisma.campaign.findFirstOrThrow({
      where: { id },
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return this.serialize(updated);
  }

  async runs(organizationId: string, campaignId: string) {
    const runs = await this.prisma.campaignRun.findMany({
      where: { organizationId, campaignId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return runs.map((run) => this.serializeRun(run));
  }

  /* ------------------------------------------------------------- quotas */

  private async assertCampaignQuota(organizationId: string): Promise<void> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { plan: true },
    });
    const quota = PLAN_QUOTAS[organization.plan as Plan];

    const count = await this.prisma.campaign.count({
      where: { organizationId, status: { not: 'archived' } },
    });

    if (count >= quota.maxCampaigns) {
      throw new AppError(
        'QUOTA_EXCEEDED',
        `The ${quota.label} plan allows ${quota.maxCampaigns} campaigns. Archive one or upgrade to create another.`,
        { retryable: false },
      );
    }
  }

  private async assertLeadQuota(organizationId: string): Promise<void> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { plan: true },
    });
    const quota = PLAN_QUOTAS[organization.plan as Plan];

    const counter = await this.prisma.usageCounter.findUnique({
      where: {
        organizationId_metric_period: { organizationId, metric: 'leads', period: currentPeriod() },
      },
    });

    if ((counter?.value ?? 0) >= quota.monthlyLeads) {
      throw new AppError(
        'QUOTA_EXCEEDED',
        `This workspace has used all ${quota.monthlyLeads.toLocaleString('en-GB')} leads included in the ${quota.label} plan this month.`,
        { retryable: false },
      );
    }
  }

  /* ---------------------------------------------------------- serialising */

  /** Campaign plus its live pipeline counts. */
  async serialize(campaign: {
    id: string;
    organizationId: string;
    name: string;
    description: string | null;
    status: string;
    source: string;
    channel: string;
    target: unknown;
    filters: unknown;
    aiSettings: unknown;
    autoPersonalize: boolean;
    sequenceId: string | null;
    createdAt: Date;
    updatedAt: Date;
    runs?: { id: string }[];
  }) {
    const stats = await this.stats(campaign.organizationId, campaign.id);

    const latestRun = await this.prisma.campaignRun.findFirst({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: 'desc' },
    });

    return {
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      status: campaign.status,
      source: campaign.source,
      channel: campaign.channel,
      createdAt: campaign.createdAt.toISOString(),
      updatedAt: campaign.updatedAt.toISOString(),
      target: campaign.target,
      filters: campaign.filters,
      ai: campaign.aiSettings,
      autoPersonalize: campaign.autoPersonalize,
      sequenceId: campaign.sequenceId,
      stats,
      latestRun: latestRun ? this.serializeRun(latestRun) : null,
    };
  }

  /** Aggregate counts for one campaign, computed in a single round trip. */
  async stats(organizationId: string, campaignId: string) {
    const [statusCounts, verified, highIntent, drafts, approved, lastActivity, positive] =
      await Promise.all([
        this.prisma.lead.groupBy({
          by: ['status'],
          where: { organizationId, campaignLinks: { some: { campaignId } } },
          _count: { _all: true },
        }),
        this.prisma.lead.count({
          where: {
            organizationId,
            campaignLinks: { some: { campaignId } },
            verificationStatus: 'verified',
          },
        }),
        this.prisma.lead.count({
          where: { organizationId, campaignLinks: { some: { campaignId } }, temperature: 'hot' },
        }),
        this.prisma.messageDraft.count({ where: { organizationId, campaignId } }),
        this.prisma.messageDraft.count({
          where: { organizationId, campaignId, status: { notIn: ['draft', 'cancelled'] } },
        }),
        this.prisma.activity.findFirst({
          where: { organizationId, campaignId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        this.prisma.conversation.count({
          where: {
            organizationId,
            lead: { campaignLinks: { some: { campaignId } } },
            lastSentiment: 'positive',
          },
        }),
      ]);

    const byStatus = new Map<string, number>(
      statusCounts.map((row) => [row.status as string, row._count._all]),
    );
    const sum = (...statuses: string[]) =>
      statuses.reduce((total, status) => total + (byStatus.get(status) ?? 0), 0);

    const leads = statusCounts.reduce((total, row) => total + row._count._all, 0);

    return {
      leads,
      verified,
      // "Qualified" means it reached at least the qualified stage.
      qualified: sum('qualified', 'ready', 'contacted', 'replied', 'interested', 'meeting', 'won'),
      ready: sum('ready', 'contacted', 'replied', 'interested', 'meeting', 'won'),
      contacted: sum('contacted', 'replied', 'interested', 'meeting', 'won'),
      replied: sum('replied', 'interested', 'meeting', 'won'),
      positive,
      meetings: sum('meeting', 'won'),
      won: sum('won'),
      draftsGenerated: drafts,
      draftsApproved: approved,
      highIntent,
      lastActivityAt: lastActivity?.createdAt.toISOString() ?? null,
    };
  }

  serializeRun(run: {
    id: string;
    campaignId: string;
    status: string;
    stage: string;
    leadLimit: number;
    candidatesDiscovered: number;
    pagesFetched: number;
    leadsCreated: number;
    duplicatesFound: number;
    leadsVerified: number;
    leadsEnriched: number;
    leadsAnalyzed: number;
    leadsScored: number;
    draftsGenerated: number;
    errorCount: number;
    rateLimitEvents: number;
    lastError: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: run.id,
      campaignId: run.campaignId,
      status: run.status,
      stage: run.stage,
      leadLimit: run.leadLimit,
      candidatesDiscovered: run.candidatesDiscovered,
      pagesFetched: run.pagesFetched,
      leadsCreated: run.leadsCreated,
      duplicatesFound: run.duplicatesFound,
      leadsVerified: run.leadsVerified,
      leadsEnriched: run.leadsEnriched,
      leadsAnalyzed: run.leadsAnalyzed,
      leadsScored: run.leadsScored,
      draftsGenerated: run.draftsGenerated,
      errorCount: run.errorCount,
      rateLimitEvents: run.rateLimitEvents,
      lastError: run.lastError,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }
}
