import {
  JOB_NAMES,
  leadStageJobSchema,
  personalizationJobSchema,
  CampaignFilters,
  Channel,
  DraftKind,
  LeadStageJob,
  PersonalizationJob,
} from '@leadforge/shared';
import { logger } from '@leadforge/api';
import type { JobHandler } from '../runner';

/**
 * The middle of the pipeline: verification → enrichment → intelligence →
 * scoring → personalisation.
 *
 * Each stage advances the next by enqueueing it, so the pipeline is a chain of
 * small idempotent steps rather than one long transaction. A lead that fails
 * at any stage stops there without blocking its siblings.
 */

export const verifyLead: JobHandler<LeadStageJob> = async ({ payload, ctx }) => {
  const job = leadStageJobSchema.parse(payload);

  // Enrichment must run first: verification reads the stored website result.
  await ctx.enrichment.enrich(job.organizationId, job.leadId);
  const outcome = await ctx.verification.verify(job.organizationId, job.leadId);

  if (job.runId) {
    await ctx.prisma.campaignRun
      .update({
        where: { id: job.runId },
        data: {
          leadsVerified: { increment: 1 },
          leadsEnriched: { increment: 1 },
          stage: 'verification',
        },
      })
      .catch(() => undefined);
  }

  await ctx.prisma.activity.create({
    data: {
      organizationId: job.organizationId,
      leadId: job.leadId,
      campaignId: job.campaignId ?? null,
      type: 'verified',
      summary: `Verification ${outcome.status} (${outcome.score}/100).`,
      actor: 'system',
      metadata: { status: outcome.status, score: outcome.score },
    },
  });

  // A rejected lead is a dead end: stop rather than spend AI budget on it.
  if (outcome.status === 'rejected') {
    logger('pipeline').info(
      { leadId: job.leadId },
      'lead rejected at verification; pipeline stopped',
    );
    await advanceRunIfComplete(ctx, job.runId, job.campaignId);
    return;
  }

  // Campaign filters are applied here, on checked facts rather than raw data.
  const passes = await passesCampaignFilters(ctx, job.organizationId, job.leadId, job.campaignId);
  if (!passes.ok) {
    await ctx.prisma.lead.update({
      where: { id: job.leadId },
      data: { status: 'lost' },
    });
    await ctx.prisma.activity.create({
      data: {
        organizationId: job.organizationId,
        leadId: job.leadId,
        campaignId: job.campaignId ?? null,
        type: 'status_changed',
        summary: `Did not meet the campaign's qualification criteria: ${passes.reason}.`,
        actor: 'system',
      },
    });
    logger('pipeline').info({ leadId: job.leadId, reason: passes.reason }, 'lead filtered out');
    await advanceRunIfComplete(ctx, job.runId, job.campaignId);
    return;
  }

  await ctx.prisma.lead.update({ where: { id: job.leadId }, data: { status: 'qualified' } });

  // Analysis needs AI; without it, score deterministically and stop there.
  const nextQueue = ctx.ai.isConfigured() ? 'intelligence' : 'scoring';
  const nextJob = ctx.ai.isConfigured() ? JOB_NAMES.analyzeLead : JOB_NAMES.scoreLead;

  await ctx.queue.enqueue(nextQueue, nextJob, {
    organizationId: job.organizationId,
    idempotencyKey: ctx.queue.buildKey(nextJob, job.leadId, job.runId ?? 'manual'),
    inputVersion: 1,
    leadId: job.leadId,
    campaignId: job.campaignId,
    runId: job.runId,
    force: job.force,
  });
};

export const enrichLead: JobHandler<LeadStageJob> = async ({ payload, ctx }) => {
  const job = leadStageJobSchema.parse(payload);
  await ctx.enrichment.enrich(job.organizationId, job.leadId);

  await ctx.prisma.activity.create({
    data: {
      organizationId: job.organizationId,
      leadId: job.leadId,
      type: 'enriched',
      summary: 'Website and public profile enrichment completed.',
      actor: 'system',
    },
  });
};

export const analyzeLead: JobHandler<LeadStageJob> = async ({ payload, ctx }) => {
  const job = leadStageJobSchema.parse(payload);

  const result = await ctx.intelligence.analyze(job.organizationId, job.leadId, {
    force: job.force,
  });

  if (job.runId) {
    await ctx.prisma.campaignRun
      .update({
        where: { id: job.runId },
        data: { leadsAnalyzed: { increment: 1 }, stage: 'intelligence' },
      })
      .catch(() => undefined);
  }

  await ctx.prisma.activity.create({
    data: {
      organizationId: job.organizationId,
      leadId: job.leadId,
      campaignId: job.campaignId ?? null,
      type: 'analyzed',
      summary: `AI analysis v${result.version} completed.`,
      actor: 'system',
      metadata: { version: result.version },
    },
  });

  await ctx.queue.enqueue('scoring', JOB_NAMES.scoreLead, {
    organizationId: job.organizationId,
    idempotencyKey: ctx.queue.buildKey('scoring.lead', job.leadId, result.version),
    inputVersion: 1,
    leadId: job.leadId,
    campaignId: job.campaignId,
    runId: job.runId,
    force: job.force,
  });
};

export const scoreLead: JobHandler<LeadStageJob> = async ({ payload, ctx }) => {
  const job = leadStageJobSchema.parse(payload);

  // explainScore computes the score deterministically, then asks the model to
  // explain it. Without AI it persists the deterministic explanation.
  await ctx.intelligence.explainScore(job.organizationId, job.leadId);

  const lead = await ctx.prisma.lead.findFirstOrThrow({
    where: { id: job.leadId, organizationId: job.organizationId },
    include: { campaignLinks: { include: { campaign: true }, take: 1 } },
  });

  if (job.runId) {
    await ctx.prisma.campaignRun
      .update({
        where: { id: job.runId },
        data: { leadsScored: { increment: 1 }, stage: 'scoring' },
      })
      .catch(() => undefined);
  }

  await ctx.prisma.activity.create({
    data: {
      organizationId: job.organizationId,
      leadId: job.leadId,
      campaignId: job.campaignId ?? null,
      type: 'scored',
      summary: `Scored ${lead.leadScore ?? 0}/100 (${lead.temperature}).`,
      actor: 'system',
      metadata: { score: lead.leadScore, temperature: lead.temperature },
    },
  });

  const campaign = lead.campaignLinks[0]?.campaign;

  // Only draft for leads worth contacting, and only when asked to.
  const shouldPersonalize =
    campaign?.autoPersonalize === true &&
    ctx.ai.isConfigured() &&
    (lead.leadScore ?? 0) >= 60 &&
    lead.status !== 'do_not_contact';

  if (shouldPersonalize) {
    await ctx.queue.enqueue('personalization', JOB_NAMES.personalizeLead, {
      organizationId: job.organizationId,
      idempotencyKey: ctx.queue.buildKey('personalization.lead', job.leadId, campaign.channel),
      inputVersion: 1,
      leadId: job.leadId,
      campaignId: job.campaignId,
      runId: job.runId,
      channel: campaign.channel as Channel,
      kinds: ['primary', 'short', 'alternative'],
      force: false,
    });
  } else {
    await advanceRunIfComplete(ctx, job.runId, job.campaignId);
  }
};

export const personalizeLead: JobHandler<PersonalizationJob> = async ({ payload, ctx }) => {
  const job = personalizationJobSchema.parse(payload);

  // A lead suppressed since scoring must not get a draft written for it.
  const suppressed = await ctx.suppression.checkLead(job.organizationId, job.leadId, job.channel);
  if (suppressed) {
    logger('pipeline').info(
      { leadId: job.leadId },
      'personalisation skipped: recipient is suppressed',
    );
    await advanceRunIfComplete(ctx, job.runId, job.campaignId);
    return;
  }

  const draftIds = await ctx.personalization.generate(job.organizationId, job.leadId, {
    channel: job.channel,
    kinds: job.kinds as DraftKind[],
    tone: job.tone,
    cta: job.cta,
    offer: job.offer,
    force: job.force,
  });

  if (job.runId) {
    await ctx.prisma.campaignRun
      .update({
        where: { id: job.runId },
        data: { draftsGenerated: { increment: draftIds.length }, stage: 'personalization' },
      })
      .catch(() => undefined);
  }

  await advanceRunIfComplete(ctx, job.runId, job.campaignId);
};

/* -------------------------------------------------------------------------- */

/**
 * Applies the campaign's qualification filters to a verified lead.
 *
 * Runs after verification so it judges checked facts: "no website" means the
 * fetcher could not reach one, not that the listing omitted a field.
 */
async function passesCampaignFilters(
  ctx: Parameters<JobHandler<LeadStageJob>>[0]['ctx'],
  organizationId: string,
  leadId: string,
  campaignId: string | undefined,
): Promise<{ ok: boolean; reason: string }> {
  if (!campaignId) return { ok: true, reason: '' };

  const campaign = await ctx.prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
  });
  if (!campaign) return { ok: true, reason: '' };

  const filters = campaign.filters as Partial<CampaignFilters>;
  const lead = await ctx.prisma.lead.findFirstOrThrow({
    where: { id: leadId, organizationId },
    include: { socialProfiles: { where: { platform: 'instagram' }, take: 1 } },
  });

  if (filters.minRating !== undefined && (lead.rating ?? 0) < filters.minRating) {
    return {
      ok: false,
      reason: `rating ${lead.rating ?? 0} is below the ${filters.minRating} minimum`,
    };
  }
  if (filters.maxRating !== undefined && (lead.rating ?? 5) > filters.maxRating) {
    return { ok: false, reason: `rating ${lead.rating} is above the ${filters.maxRating} maximum` };
  }
  if (filters.minReviews !== undefined && (lead.reviewCount ?? 0) < filters.minReviews) {
    return {
      ok: false,
      reason: `${lead.reviewCount ?? 0} reviews is below the ${filters.minReviews} minimum`,
    };
  }
  if (filters.maxReviews !== undefined && (lead.reviewCount ?? 0) > filters.maxReviews) {
    return {
      ok: false,
      reason: `${lead.reviewCount} reviews is above the ${filters.maxReviews} maximum`,
    };
  }

  if (filters.websiteCondition && filters.websiteCondition !== 'any') {
    const matches =
      (filters.websiteCondition === 'without' && lead.websiteStatus === 'none') ||
      (filters.websiteCondition === 'broken' && lead.websiteStatus === 'broken') ||
      (filters.websiteCondition === 'with' && lead.websiteStatus === 'active');
    if (!matches) {
      return {
        ok: false,
        reason: `website status "${lead.websiteStatus}" does not match "${filters.websiteCondition}"`,
      };
    }
  }

  const hasInstagram = lead.socialProfiles.length > 0;
  if (filters.socialCondition === 'with_instagram' && !hasInstagram) {
    return { ok: false, reason: 'no public Instagram profile found' };
  }
  if (filters.socialCondition === 'without_instagram' && hasInstagram) {
    return { ok: false, reason: 'has an Instagram profile, which this campaign excludes' };
  }

  for (const requirement of filters.requireContact ?? []) {
    if (requirement === 'phone' && !lead.phone) return { ok: false, reason: 'no phone number' };
    if (requirement === 'email' && !lead.email) return { ok: false, reason: 'no email address' };
    if (requirement === 'website' && !lead.website) return { ok: false, reason: 'no website' };
    if (requirement === 'instagram' && !hasInstagram)
      return { ok: false, reason: 'no Instagram profile' };
  }

  for (const keyword of filters.excludeKeywords ?? []) {
    if (lead.canonicalName.toLowerCase().includes(keyword.toLowerCase())) {
      return { ok: false, reason: `name contains the excluded keyword "${keyword}"` };
    }
  }

  return { ok: true, reason: '' };
}

/**
 * Marks a run complete once nothing is left in flight for it.
 *
 * "Nothing in flight" is measured from JobRecord rather than the queue, so a
 * job that died between queues still lets the run finish rather than hanging
 * in "running" forever.
 */
async function advanceRunIfComplete(
  ctx: Parameters<JobHandler<LeadStageJob>>[0]['ctx'],
  runId: string | undefined,
  campaignId: string | undefined,
): Promise<void> {
  if (!runId || !campaignId) return;

  const pending = await ctx.prisma.jobRecord.count({
    where: { runId, status: { in: ['queued', 'active'] } },
  });

  // 1 = this job, which is still marked active while it runs.
  if (pending > 1) return;

  const run = await ctx.prisma.campaignRun.findUnique({ where: { id: runId } });
  if (!run || run.status === 'completed' || run.status === 'paused') return;

  await ctx.prisma.$transaction([
    ctx.prisma.campaignRun.update({
      where: { id: runId },
      data: { status: 'completed', stage: 'done', finishedAt: new Date() },
    }),
    ctx.prisma.campaign.update({ where: { id: campaignId }, data: { status: 'completed' } }),
    ctx.prisma.activity.create({
      data: {
        organizationId: run.organizationId,
        campaignId,
        type: 'discovered',
        summary: `Run finished: ${run.leadsCreated} leads created, ${run.leadsScored} scored, ${run.draftsGenerated} drafts written.`,
        actor: 'system',
        metadata: {
          leadsCreated: run.leadsCreated,
          duplicatesFound: run.duplicatesFound,
          leadsScored: run.leadsScored,
          draftsGenerated: run.draftsGenerated,
        },
      },
    }),
  ]);

  logger('pipeline').info({ runId, campaignId }, 'campaign run completed');
}
