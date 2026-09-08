import {
  AppError,
  JOB_NAMES,
  discoveryJobSchema,
  normalizationJobSchema,
  DiscoveryJob,
  NormalizationJob,
} from '@leadforge/shared';
import { logger } from '@leadforge/api';
import type { JobContext, JobHandler } from '../runner';
import type { RawCandidate, SourceAdapter } from '@leadforge/api';

/** Page size requested from a discovery source. */
const PAGE_SIZE = 20;

/**
 * Picks the discovery source the campaign was created with.
 *
 * `openstreetmap` is the default because it needs no API key and no billing
 * account: OSM data is free to query and free to use under ODbL, so a campaign
 * can run end to end at zero cost. Google Places is richer — it carries ratings
 * and review counts that OSM has no equivalent for — but it requires a card on
 * file, so it is opt-in rather than assumed.
 */
function selectSourceAdapter(ctx: JobContext<DiscoveryJob>['ctx'], source: string): SourceAdapter {
  switch (source) {
    case 'google_places':
      return ctx.places;
    case 'openstreetmap':
      return ctx.overpass;
    case 'csv':
      // CSV rows are imported directly as source records; there is nothing to
      // page through, so a discovery job should never have been enqueued.
      throw new AppError('BAD_REQUEST', 'CSV campaigns are imported, not discovered.', {
        retryable: false,
      });
    default:
      throw new AppError('BAD_REQUEST', `Unknown discovery source "${source}".`, {
        retryable: false,
      });
  }
}

/**
 * Discovery (docs/10).
 *
 * Pages through the source adapter, persists every raw record with its
 * provenance, and enqueues one normalisation job per candidate. Discovery
 * itself never creates a Lead — that is normalisation's job, so a re-run
 * cannot duplicate leads.
 */
export const discoveryRun: JobHandler<DiscoveryJob> = async ({ payload, ctx }) => {
  const job = discoveryJobSchema.parse(payload);
  const log = logger('discovery');

  const campaign = await ctx.prisma.campaign.findFirstOrThrow({
    where: { id: job.campaignId, organizationId: job.organizationId },
  });

  const run = await ctx.prisma.campaignRun.findFirstOrThrow({
    where: { id: job.runId, organizationId: job.organizationId },
  });

  // A run paused between enqueue and pickup must not resume by itself.
  if (run.status === 'paused' || run.status === 'cancelled') {
    log.info({ runId: run.id, status: run.status }, 'discovery skipped: run is not active');
    return;
  }

  const adapter = selectSourceAdapter(ctx, campaign.source);
  if (!adapter.isConfigured()) throw AppError.providerNotConfigured(`${campaign.source} discovery`);

  await ctx.prisma.$transaction([
    ctx.prisma.campaignRun.update({
      where: { id: run.id },
      data: { status: 'running', stage: 'discovery', startedAt: run.startedAt ?? new Date() },
    }),
    ctx.prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'running' } }),
  ]);

  const target = campaign.target as Parameters<typeof adapter.search>[0]['target'];
  const filters = campaign.filters as Parameters<typeof adapter.search>[0]['filters'];

  let cursor: string | undefined;
  let discovered = 0;
  let pages = 0;
  let rateLimitEvents = 0;
  const seen = new Set<string>();

  // Sources page differently — Places returns 20 at a time, Overpass returns
  // whatever the bounding query matched. Keep paging until the limit is met or
  // the provider runs out of results.
  while (discovered < job.leadLimit && pages < 25) {
    const result = await adapter.search({
      target,
      filters,
      cursor,
      maxResults: Math.min(PAGE_SIZE, job.leadLimit - discovered),
    });

    pages += 1;

    if (result.rateLimited) {
      rateLimitEvents += 1;
      log.warn(
        { runId: run.id, pages },
        'provider rate limited; pausing this run for a delayed retry',
      );
      await ctx.prisma.campaignRun.update({
        where: { id: run.id },
        data: { rateLimitEvents: { increment: 1 }, pagesFetched: pages },
      });
      // Re-enqueue with a delay rather than hammering the provider.
      await ctx.queue.enqueue(
        'discovery',
        JOB_NAMES.discoveryRun,
        {
          organizationId: job.organizationId,
          idempotencyKey: ctx.queue.buildKey('discovery.run', run.id, 'retry', pages, Date.now()),
          inputVersion: 1,
          campaignId: job.campaignId,
          runId: job.runId,
          leadLimit: job.leadLimit - discovered,
          refresh: job.refresh,
        },
        { delayMs: 60_000 },
      );
      return;
    }

    for (const candidate of result.candidates) {
      if (discovered >= job.leadLimit) break;
      // The provider can repeat a place across pages.
      if (seen.has(candidate.externalId)) continue;
      seen.add(candidate.externalId);

      const stored = await persistSourceRecord(ctx, job, candidate, adapter.sourceName);
      if (!stored) continue;

      discovered += 1;

      await ctx.queue.enqueue('normalization', JOB_NAMES.normalizeCandidate, {
        organizationId: job.organizationId,
        idempotencyKey: ctx.queue.buildKey('normalization.candidate', stored.id),
        inputVersion: 1,
        campaignId: job.campaignId,
        runId: job.runId,
        sourceRecordId: stored.id,
      });
    }

    await ctx.prisma.campaignRun.update({
      where: { id: run.id },
      data: { candidatesDiscovered: discovered, pagesFetched: pages },
    });

    if (!result.nextCursor || result.candidates.length === 0) break;
    cursor = result.nextCursor;
  }

  await ctx.prisma.campaignRun.update({
    where: { id: run.id },
    data: {
      stage: 'normalization',
      candidatesDiscovered: discovered,
      pagesFetched: pages,
      rateLimitEvents: { increment: rateLimitEvents },
    },
  });

  await ctx.prisma.activity.create({
    data: {
      organizationId: job.organizationId,
      campaignId: job.campaignId,
      type: 'discovered',
      summary: `Discovery finished: ${discovered} candidates from ${pages} pages.`,
      actor: 'system',
      metadata: { discovered, pages },
    },
  });

  log.info({ runId: run.id, discovered, pages }, 'discovery complete');

  if (discovered === 0) {
    // Nothing to normalise, so nothing downstream will ever advance the run.
    await ctx.prisma.$transaction([
      ctx.prisma.campaignRun.update({
        where: { id: run.id },
        data: { status: 'completed', stage: 'done', finishedAt: new Date() },
      }),
      ctx.prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'completed' } }),
    ]);
  }
};

/**
 * Normalisation (docs/11).
 *
 * Turns one raw record into a canonical Lead, merging duplicates. Idempotent
 * on the source record: a retry finds `normalizedAt` set and stops.
 */
export const normalizeCandidate: JobHandler<NormalizationJob> = async ({ payload, ctx }) => {
  const job = normalizationJobSchema.parse(payload);
  const log = logger('normalization');

  const record = await ctx.prisma.leadSourceRecord.findFirstOrThrow({
    where: { id: job.sourceRecordId, organizationId: job.organizationId },
  });

  if (record.normalizedAt && record.leadId) {
    log.debug({ sourceRecordId: record.id }, 'already normalised; skipping');
    return;
  }

  const campaign = await ctx.prisma.campaign.findFirstOrThrow({
    where: { id: job.campaignId, organizationId: job.organizationId },
  });
  const geo = (campaign.target as { geo?: { country?: string } }).geo;

  const candidate = record.raw as unknown as RawCandidate;
  const normalized = ctx.normalization.normalize(
    { ...candidate, externalId: record.externalId },
    geo?.country ?? 'GB',
  );

  const duplicate = await ctx.normalization.findDuplicate(job.organizationId, normalized);

  let leadId: string;
  let merged = false;

  if (duplicate && duplicate.match.decision === 'merge') {
    await ctx.normalization.mergeInto(duplicate.leadId, normalized);
    leadId = duplicate.leadId;
    merged = true;
    log.info(
      { sourceRecordId: record.id, leadId, score: duplicate.match.score },
      'candidate merged into an existing lead',
    );
  } else {
    // The unique constraint on (org, source, externalId) is the last line of
    // defence against a concurrent worker creating the same lead twice.
    const existing = await ctx.prisma.lead.findFirst({
      where: {
        organizationId: job.organizationId,
        source: record.source,
        sourceExternalId: record.externalId,
      },
    });

    if (existing) {
      leadId = existing.id;
      merged = true;
    } else {
      const lead = await ctx.prisma.lead.create({
        data: {
          organizationId: job.organizationId,
          canonicalName: normalized.canonicalName,
          nameKey: normalized.nameKey,
          category: normalized.category,
          categoryKey: normalized.categoryKey,
          address: normalized.address,
          city: normalized.city,
          region: normalized.region,
          country: normalized.country,
          postalCode: normalized.postalCode,
          latitude: normalized.latitude,
          longitude: normalized.longitude,
          phone: normalized.phone,
          phoneKey: normalized.phoneKey,
          website: normalized.website,
          domainKey: normalized.domainKey,
          rating: normalized.rating,
          reviewCount: normalized.reviewCount,
          source: record.source,
          sourceExternalId: record.externalId,
          sourceUrl: record.sourceUrl,
          status: 'new',
          verificationStatus: 'pending',
        },
      });
      leadId = lead.id;

      if (duplicate && duplicate.match.decision === 'review') {
        await ctx.normalization.recordReviewCandidate(
          job.organizationId,
          leadId,
          duplicate.leadId,
          duplicate.match,
        );
      }

      await ctx.evidence.record({
        organizationId: job.organizationId,
        leadId,
        type: 'source_record',
        statement: `Listed on ${record.source.replace(/_/g, ' ')}${
          normalized.rating !== null ? ` with a ${normalized.rating.toFixed(1)} rating` : ''
        }${normalized.reviewCount ? ` from ${normalized.reviewCount} reviews` : ''}.`,
        source: record.source,
        sourceUrl: record.sourceUrl,
        confidence: 0.98,
        data: {
          externalId: record.externalId,
          rating: normalized.rating,
          reviewCount: normalized.reviewCount,
        },
        observedAt: record.fetchedAt,
      });

      await ctx.prisma.activity.create({
        data: {
          organizationId: job.organizationId,
          leadId,
          campaignId: job.campaignId,
          type: 'discovered',
          summary: `Discovered via ${record.source.replace(/_/g, ' ')}.`,
          actor: 'system',
        },
      });
    }
  }

  await ctx.prisma.$transaction([
    ctx.prisma.leadSourceRecord.update({
      where: { id: record.id },
      data: { leadId, normalizedAt: new Date() },
    }),
    ctx.prisma.campaignLeadLink.upsert({
      where: { campaignId_leadId: { campaignId: job.campaignId, leadId } },
      create: {
        organizationId: job.organizationId,
        campaignId: job.campaignId,
        leadId,
        runId: job.runId,
      },
      update: {},
    }),
    ctx.prisma.campaignRun.update({
      where: { id: job.runId },
      data: merged ? { duplicatesFound: { increment: 1 } } : { leadsCreated: { increment: 1 } },
    }),
  ]);

  if (!merged) {
    await incrementLeadCounter(ctx, job.organizationId);
  }

  // A merged lead still advances: newer source data can change its verdict.
  await ctx.queue.enqueue('verification', JOB_NAMES.verifyLead, {
    organizationId: job.organizationId,
    idempotencyKey: ctx.queue.buildKey('verification.lead', leadId, job.runId),
    inputVersion: 1,
    leadId,
    campaignId: job.campaignId,
    runId: job.runId,
    force: false,
  });
};

/** Persists a raw provider record, or returns null when it already exists. */
async function persistSourceRecord(
  ctx: JobContext<DiscoveryJob>['ctx'],
  job: DiscoveryJob,
  candidate: RawCandidate,
  source: string,
) {
  try {
    return await ctx.prisma.leadSourceRecord.create({
      data: {
        organizationId: job.organizationId,
        campaignId: job.campaignId,
        runId: job.runId,
        source,
        externalId: candidate.externalId,
        sourceUrl: candidate.sourceUrl ?? null,
        raw: candidate as unknown as never,
      },
    });
  } catch {
    // Unique on (org, source, externalId, run): already captured this run.
    return null;
  }
}

async function incrementLeadCounter(ctx: JobContext<DiscoveryJob>['ctx'], organizationId: string) {
  const period = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
  await ctx.prisma.usageCounter
    .upsert({
      where: { organizationId_metric_period: { organizationId, metric: 'leads', period } },
      create: { organizationId, metric: 'leads', period, value: 1 },
      update: { value: { increment: 1 } },
    })
    .catch(() => undefined);
}
