import { Injectable } from '@nestjs/common';
import {
  AppError,
  JOB_NAMES,
  paginate,
  skipTake,
  temperatureForScore,
  Channel,
  ImportLeadsInput,
  ListLeadsQuery,
  UpdateLeadInput,
} from '@leadforge/shared';
import { currentPeriod } from '@leadforge/database';
import { PrismaService } from '@/common/prisma.service';
import { QueueService } from '@/jobs/queue.service';
import { NormalizationService } from '@/normalization/normalization.service';
import { SuppressionService } from '@/outreach/suppression.service';
import { OutreachService } from '@/outreach/outreach.service';
import { SequenceService } from '@/outreach/sequence.service';
import { logger } from '@/common/logger';
import type { Prisma } from '@leadforge/database';

/**
 * Lead read/write surface.
 *
 * Every query is scoped by organizationId taken from the session. There is no
 * code path here that accepts a tenant identifier from the client.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly normalization: NormalizationService,
    private readonly suppression: SuppressionService,
    private readonly outreach: OutreachService,
    private readonly sequences: SequenceService,
  ) {}

  async list(organizationId: string, query: ListLeadsQuery) {
    const where = this.buildWhere(organizationId, query);

    const orderBy: Prisma.LeadOrderByWithRelationInput =
      query.sortBy === 'canonicalName'
        ? { canonicalName: query.sortOrder }
        : query.sortBy === 'createdAt'
          ? { createdAt: query.sortOrder }
          : query.sortBy === 'updatedAt'
            ? { updatedAt: query.sortOrder }
            : // Unscored leads sort last rather than first on a descending sort.
              { leadScore: { sort: query.sortOrder, nulls: 'last' } };

    const [leads, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: {
          websiteAnalysis: { select: { opportunitySignals: true } },
          socialProfiles: { where: { platform: 'instagram' }, select: { id: true }, take: 1 },
          drafts: {
            where: { status: { in: ['draft', 'approved', 'queued'] } },
            select: { channel: true },
            take: 1,
          },
        },
        orderBy,
        ...skipTake(query),
      }),
      this.prisma.lead.count({ where }),
    ]);

    return paginate(
      leads.map((lead) => this.serializeSummary(lead)),
      total,
      query,
    );
  }

  async get(organizationId: string, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, organizationId },
      include: {
        owner: { select: { name: true } },
        contacts: { orderBy: { isPrimary: 'desc' } },
        socialProfiles: true,
        evidence: { orderBy: [{ confidence: 'desc' }, { observedAt: 'desc' }] },
        verifications: { orderBy: { createdAt: 'desc' }, take: 1 },
        websiteAnalysis: true,
        reports: { orderBy: { version: 'desc' }, take: 1 },
        scores: { orderBy: { version: 'desc' }, take: 1 },
        drafts: { orderBy: { createdAt: 'desc' } },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 60,
          include: {/* actor name resolved below */},
        },
        notes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { name: true } } } },
        tasks: {
          orderBy: [{ completedAt: 'asc' }, { dueAt: 'asc' }],
          include: { assignee: { select: { name: true } } },
        },
        campaignLinks: {
          include: { campaign: { select: { id: true, name: true, status: true } } },
        },
        conversations: { orderBy: { lastMessageAt: 'desc' } },
      },
    });

    if (!lead) throw AppError.notFound('Lead', id);

    const suppression = await this.suppression.checkLead(organizationId, id);
    const summary = this.serializeSummary({
      ...lead,
      websiteAnalysis: lead.websiteAnalysis
        ? { opportunitySignals: lead.websiteAnalysis.opportunitySignals }
        : null,
      socialProfiles: lead.socialProfiles.filter((profile) => profile.platform === 'instagram'),
      drafts: lead.drafts.filter((draft) => ['draft', 'approved', 'queued'].includes(draft.status)),
    });

    const report = lead.reports[0];
    const score = lead.scores[0];
    const verification = lead.verifications[0];

    // Resolve the display name for user-triggered activity entries.
    const actorIds = [
      ...new Set(
        lead.activities.map((a) => a.actorUserId).filter((id): id is string => Boolean(id)),
      ),
    ];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true },
        })
      : [];
    const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));

    return {
      ...summary,
      latitude: lead.latitude,
      longitude: lead.longitude,
      postalCode: lead.postalCode,
      sourceExternalId: lead.sourceExternalId,
      ownerId: lead.ownerId,
      ownerName: lead.owner?.name ?? null,
      verifiedAt: lead.verifiedAt?.toISOString() ?? null,
      enrichedAt: lead.enrichedAt?.toISOString() ?? null,
      analyzedAt: lead.analyzedAt?.toISOString() ?? null,
      scoredAt: lead.scoredAt?.toISOString() ?? null,

      contacts: lead.contacts.map((contact) => ({
        id: contact.id,
        kind: contact.kind,
        value: contact.value,
        label: contact.label,
        isPrimary: contact.isPrimary,
        verified: contact.verified,
        source: contact.source,
      })),

      socialProfiles: lead.socialProfiles.map((profile) => ({
        id: profile.id,
        platform: profile.platform,
        profileUrl: profile.profileUrl,
        username: profile.username,
        status: profile.status,
        observedAt: profile.observedAt.toISOString(),
      })),

      evidence: lead.evidence.map((item) => ({
        id: item.id,
        type: item.type,
        statement: item.statement,
        source: item.source,
        sourceUrl: item.sourceUrl,
        confidence: item.confidence,
        data: item.data as Record<string, unknown>,
        observedAt: item.observedAt.toISOString(),
        expiresAt: item.expiresAt?.toISOString() ?? null,
      })),

      verification: verification
        ? {
            id: verification.id,
            status: verification.status,
            score: verification.score,
            checks: verification.checks,
            createdAt: verification.createdAt.toISOString(),
          }
        : null,

      websiteAnalysis: lead.websiteAnalysis
        ? {
            url: lead.websiteAnalysis.url,
            finalUrl: lead.websiteAnalysis.finalUrl,
            status: lead.websiteAnalysis.status,
            httpStatus: lead.websiteAnalysis.httpStatus,
            isHttps: lead.websiteAnalysis.isHttps,
            redirectCount: lead.websiteAnalysis.redirectCount,
            responseTimeMs: lead.websiteAnalysis.responseTimeMs,
            title: lead.websiteAnalysis.title,
            description: lead.websiteAnalysis.description,
            hasContactPage: lead.websiteAnalysis.hasContactPage,
            hasBookingCta: lead.websiteAnalysis.hasBookingCta,
            hasMenuOrServices: lead.websiteAnalysis.hasMenuOrServices,
            hasConversionCta: lead.websiteAnalysis.hasConversionCta,
            hasViewport: lead.websiteAnalysis.hasViewport,
            identityMatch: lead.websiteAnalysis.identityMatch,
            opportunitySignals: lead.websiteAnalysis.opportunitySignals as string[],
            confidence: lead.websiteAnalysis.confidence,
            error: lead.websiteAnalysis.error,
            checkedAt: lead.websiteAnalysis.checkedAt.toISOString(),
          }
        : null,

      intelligence: report
        ? {
            id: report.id,
            version: report.version,
            summary: report.summary,
            strengths: report.strengths as string[],
            painPoints: report.painPoints as {
              statement: string;
              evidenceIds: string[];
              confidence: number;
            }[],
            opportunities: report.opportunities as {
              statement: string;
              evidenceIds: string[];
              confidence: number;
            }[],
            recommendedAngle: report.recommendedAngle,
            objections: report.objections as string[],
            unknowns: report.unknowns as string[],
            confidence: report.confidence,
            provider: report.provider,
            model: report.model,
            promptVersion: report.promptVersion,
            schemaVersion: report.schemaVersion,
            createdAt: report.createdAt.toISOString(),
          }
        : null,

      score: score
        ? {
            id: score.id,
            total: score.total,
            fit: score.fit,
            opportunity: score.opportunity,
            contactability: score.contactability,
            maturity: score.maturity,
            confidence: score.confidence,
            urgency: score.urgency,
            explanation: score.explanation as {
              dimension: string;
              value: number;
              reason: string;
            }[],
            method: score.method,
            weights: score.weights as Record<string, number>,
            model: score.model,
            createdAt: score.createdAt.toISOString(),
          }
        : null,

      drafts: await Promise.all(
        lead.drafts.map((draft) => this.serializeDraft(draft, lead.canonicalName, null)),
      ),

      activities: lead.activities.map((activity) => ({
        id: activity.id,
        type: activity.type,
        summary: activity.summary,
        actor: activity.actor,
        actorName: activity.actorUserId ? (actorNames.get(activity.actorUserId) ?? null) : null,
        metadata: activity.metadata as Record<string, unknown>,
        createdAt: activity.createdAt.toISOString(),
      })),

      notes: lead.notes.map((note) => ({
        id: note.id,
        body: note.body,
        authorName: note.author?.name ?? null,
        createdAt: note.createdAt.toISOString(),
      })),

      tasks: lead.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        dueAt: task.dueAt?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
        assigneeName: task.assignee?.name ?? null,
        createdAt: task.createdAt.toISOString(),
      })),

      campaigns: lead.campaignLinks.map((link) => ({
        id: link.campaign.id,
        name: link.campaign.name,
        status: link.campaign.status,
      })),

      conversations: lead.conversations.map((conversation) => ({
        id: conversation.id,
        leadId: conversation.leadId,
        leadName: lead.canonicalName,
        channel: conversation.channel,
        status: conversation.status,
        needsHuman: conversation.needsHuman,
        lastIntent: conversation.lastIntent,
        lastSentiment: conversation.lastSentiment,
        summary: conversation.summary,
        assigneeName: null,
        lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
        lastMessagePreview: null,
        unreadInbound: 0,
        createdAt: conversation.createdAt.toISOString(),
      })),

      suppression: suppression
        ? { scope: suppression.scope, value: suppression.value, reason: suppression.reason }
        : null,
    };
  }

  async update(organizationId: string, id: string, input: UpdateLeadInput, userId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id, organizationId } });
    if (!lead) throw AppError.notFound('Lead', id);

    const phoneKey =
      input.phone !== undefined
        ? this.normalization.normalizeContact('phone', input.phone ?? '', lead.country ?? 'GB')
        : undefined;

    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.phone !== undefined
          ? { phone: phoneKey?.value ?? input.phone ?? null, phoneKey: phoneKey?.valueKey ?? null }
          : {}),
        ...(input.email !== undefined ? { email: this.normalization.emailKey(input.email) } : {}),
        ...(input.website !== undefined
          ? {
              website: input.website ?? null,
              domainKey: this.normalization.domainKeyFor(input.website),
            }
          : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      },
    });

    if (input.status && input.status !== lead.status) {
      await this.prisma.activity.create({
        data: {
          organizationId,
          leadId: id,
          type: 'status_changed',
          summary: `Status changed from ${lead.status} to ${input.status}.`,
          actor: 'user',
          actorUserId: userId,
          metadata: { from: lead.status, to: input.status },
        },
      });

      // Closing a lead or marking it do-not-contact stops all follow-ups.
      if (['won', 'lost', 'do_not_contact'].includes(input.status)) {
        await this.sequences.stopForLead(
          organizationId,
          id,
          input.status === 'do_not_contact' ? 'do_not_contact' : 'lead_closed',
        );
      }
      if (input.status === 'do_not_contact') {
        await this.suppression.add(organizationId, 'lead', id, {
          reason: 'Marked do-not-contact by a user.',
          createdById: userId,
        });
      }
    }

    if (input.notes) {
      await this.prisma.note.create({
        data: { organizationId, leadId: id, authorId: userId, body: input.notes },
      });
    }

    return this.get(organizationId, updated.id);
  }

  /** Queues AI analysis for a lead. */
  async queueAnalysis(organizationId: string, leadId: string, force: boolean) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!lead) throw AppError.notFound('Lead', leadId);

    const { jobId } = await this.queue.enqueue('intelligence', JOB_NAMES.analyzeLead, {
      organizationId,
      idempotencyKey: this.queue.buildKey(
        'intelligence.analyze',
        leadId,
        force ? Date.now() : (lead.enrichedAt?.getTime() ?? 0),
      ),
      inputVersion: 1,
      leadId,
      force,
    });

    return { queued: true, jobId };
  }

  /** Queues message generation and returns the drafts once written. */
  async queueMessageGeneration(
    organizationId: string,
    leadId: string,
    input: {
      channel: Channel;
      kinds: string[];
      tone?: string;
      cta?: string;
      offer?: string;
      force: boolean;
    },
  ) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!lead) throw AppError.notFound('Lead', leadId);

    const { jobId } = await this.queue.enqueue('personalization', JOB_NAMES.personalizeLead, {
      organizationId,
      idempotencyKey: this.queue.buildKey(
        'personalization.lead',
        leadId,
        input.channel,
        input.kinds.join(','),
        input.force ? Date.now() : 0,
      ),
      inputVersion: 1,
      leadId,
      channel: input.channel,
      kinds: input.kinds,
      tone: input.tone,
      cta: input.cta,
      offer: input.offer,
      force: input.force,
    });

    return { queued: true, jobId, drafts: [] };
  }

  /**
   * Imports leads from a CSV upload. Each row goes through the same
   * normalisation and dedupe path as a discovered candidate.
   */
  async import(organizationId: string, input: ImportLeadsInput) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: input.campaignId, organizationId },
    });
    if (!campaign) throw AppError.notFound('Campaign', input.campaignId);

    let created = 0;
    let duplicates = 0;

    for (const row of input.rows) {
      const normalized = this.normalization.normalize(
        {
          externalId: '',
          name: row.name,
          category: row.category ?? null,
          address: row.address ?? null,
          city: row.city ?? null,
          country: row.country ?? null,
          phone: row.phone ?? null,
          website: row.website ?? null,
          raw: row as unknown as Record<string, unknown>,
        },
        row.country ?? 'GB',
      );

      const existing = await this.normalization.findDuplicate(organizationId, normalized);

      if (existing && existing.match.decision === 'merge') {
        await this.normalization.mergeInto(existing.leadId, normalized);
        await this.linkToCampaign(organizationId, existing.leadId, input.campaignId);
        duplicates += 1;
        continue;
      }

      const lead = await this.prisma.lead.create({
        data: {
          organizationId,
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
          email: this.normalization.emailKey(row.email),
          website: normalized.website,
          domainKey: normalized.domainKey,
          source: 'csv_import',
          status: 'new',
          verificationStatus: 'pending',
        },
      });

      await this.linkToCampaign(organizationId, lead.id, input.campaignId);
      created += 1;

      if (existing && existing.match.decision === 'review') {
        await this.normalization.recordReviewCandidate(
          organizationId,
          lead.id,
          existing.leadId,
          existing.match,
        );
      }

      // Imported leads go through the full pipeline, starting at verification.
      await this.queue.enqueue('verification', JOB_NAMES.verifyLead, {
        organizationId,
        idempotencyKey: this.queue.buildKey('verification.lead', lead.id),
        inputVersion: 1,
        leadId: lead.id,
        campaignId: input.campaignId,
        force: false,
      });
    }

    await this.incrementLeadCounter(organizationId, created);

    logger('leads').info(
      { campaignId: input.campaignId, created, duplicates },
      'CSV import completed',
    );

    return { created, duplicates };
  }

  async addNote(organizationId: string, leadId: string, body: string, userId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!lead) throw AppError.notFound('Lead', leadId);

    const note = await this.prisma.note.create({
      data: { organizationId, leadId, authorId: userId, body },
    });

    await this.prisma.activity.create({
      data: {
        organizationId,
        leadId,
        type: 'note_added',
        summary: body.length > 120 ? `${body.slice(0, 117)}...` : body,
        actor: 'user',
        actorUserId: userId,
      },
    });

    return note;
  }

  async createTask(
    organizationId: string,
    leadId: string,
    input: { title: string; dueAt?: string; assigneeId?: string },
    userId: string,
  ) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!lead) throw AppError.notFound('Lead', leadId);

    const task = await this.prisma.task.create({
      data: {
        organizationId,
        leadId,
        title: input.title,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        assigneeId: input.assigneeId ?? null,
        createdById: userId,
      },
    });

    await this.prisma.activity.create({
      data: {
        organizationId,
        leadId,
        type: 'task_created',
        summary: input.title,
        actor: 'user',
        actorUserId: userId,
      },
    });

    return task;
  }

  async updateTask(
    organizationId: string,
    leadId: string,
    taskId: string,
    input: {
      title?: string;
      dueAt?: string | null;
      assigneeId?: string | null;
      completed?: boolean;
    },
    userId: string,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, leadId, organizationId },
    });
    if (!task) throw AppError.notFound('Task', taskId);

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.completed !== undefined
          ? { completedAt: input.completed ? new Date() : null }
          : {}),
      },
    });

    if (input.completed) {
      await this.prisma.activity.create({
        data: {
          organizationId,
          leadId,
          type: 'task_completed',
          summary: updated.title,
          actor: 'user',
          actorUserId: userId,
        },
      });
    }

    return updated;
  }

  /** CSV export of the current filtered view. */
  async exportCsv(organizationId: string, query: ListLeadsQuery): Promise<string> {
    const where = this.buildWhere(organizationId, query);
    const leads = await this.prisma.lead.findMany({
      where,
      include: { websiteAnalysis: { select: { opportunitySignals: true } } },
      orderBy: { leadScore: { sort: 'desc', nulls: 'last' } },
      take: 10_000,
    });

    const headers = [
      'Business',
      'Category',
      'City',
      'Country',
      'Phone',
      'Email',
      'Website',
      'Website status',
      'Rating',
      'Reviews',
      'Score',
      'Priority',
      'Verification',
      'Status',
      'Opportunity signals',
      'Source',
      'Discovered',
    ];

    const rows = leads.map((lead) => [
      lead.canonicalName,
      lead.category ?? '',
      lead.city ?? '',
      lead.country ?? '',
      lead.phone ?? '',
      lead.email ?? '',
      lead.website ?? '',
      lead.websiteStatus,
      lead.rating?.toFixed(1) ?? '',
      lead.reviewCount?.toString() ?? '',
      lead.leadScore?.toString() ?? '',
      lead.temperature,
      lead.verificationStatus,
      lead.status,
      ((lead.websiteAnalysis?.opportunitySignals as string[] | undefined) ?? []).join('; '),
      lead.source,
      lead.createdAt.toISOString(),
    ]);

    return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
  }

  /* ------------------------------------------------------------- helpers */

  private buildWhere(organizationId: string, query: ListLeadsQuery): Prisma.LeadWhereInput {
    return {
      organizationId,
      // Merged records are never listed; the survivor represents them.
      mergedIntoId: null,
      ...(query.campaignId ? { campaignLinks: { some: { campaignId: query.campaignId } } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.verificationStatus ? { verificationStatus: query.verificationStatus } : {}),
      ...(query.temperature ? { temperature: query.temperature } : {}),
      ...(query.minScore !== undefined || query.maxScore !== undefined
        ? {
            leadScore: {
              ...(query.minScore !== undefined ? { gte: query.minScore } : {}),
              ...(query.maxScore !== undefined ? { lte: query.maxScore } : {}),
            },
          }
        : {}),
      ...(query.hasWebsite !== undefined
        ? query.hasWebsite
          ? { website: { not: null } }
          : { website: null }
        : {}),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.search
        ? {
            OR: [
              { canonicalName: { contains: query.search, mode: 'insensitive' as const } },
              { nameKey: { contains: query.search.toLowerCase() } },
              { phone: { contains: query.search } },
              { domainKey: { contains: query.search.toLowerCase() } },
              { city: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
  }

  serializeSummary(lead: {
    id: string;
    canonicalName: string;
    category: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    rating: number | null;
    reviewCount: number | null;
    source: string;
    sourceUrl: string | null;
    status: string;
    verificationStatus: string;
    verificationScore: number | null;
    contactabilityScore: number | null;
    leadScore: number | null;
    temperature: string;
    websiteStatus: string;
    tags: string[];
    updatedAt: Date;
    createdAt: Date;
    lastContactedAt?: Date | null;
    lastRepliedAt?: Date | null;
    websiteAnalysis?: { opportunitySignals: unknown } | null;
    socialProfiles?: { id: string }[];
    drafts?: { channel: string }[];
  }) {
    const signals = (
      (lead.websiteAnalysis?.opportunitySignals as string[] | undefined) ?? []
    ).slice(0, 6);

    return {
      id: lead.id,
      canonicalName: lead.canonicalName,
      category: lead.category,
      city: lead.city,
      region: lead.region,
      country: lead.country,
      address: lead.address,
      phone: lead.phone,
      email: lead.email,
      website: lead.website,
      rating: lead.rating,
      reviewCount: lead.reviewCount,
      source: lead.source,
      sourceUrl: lead.sourceUrl,
      status: lead.status,
      verificationStatus: lead.verificationStatus,
      verificationScore: lead.verificationScore,
      contactabilityScore: lead.contactabilityScore,
      leadScore: lead.leadScore,
      temperature: lead.temperature || temperatureForScore(lead.leadScore),
      websiteStatus: lead.websiteStatus,
      tags: lead.tags,
      signals,
      hasInstagram: (lead.socialProfiles?.length ?? 0) > 0,
      hasDraft: (lead.drafts?.length ?? 0) > 0,
      channel: (lead.drafts?.[0]?.channel as Channel | undefined) ?? null,
      updatedAt: lead.updatedAt.toISOString(),
      createdAt: lead.createdAt.toISOString(),
      lastActivityAt: (lead.lastRepliedAt ?? lead.lastContactedAt ?? lead.updatedAt).toISOString(),
    };
  }

  async serializeDraft(
    draft: {
      id: string;
      leadId: string;
      campaignId: string | null;
      channel: string;
      kind: string;
      sequenceStep: number | null;
      subject: string | null;
      body: string;
      angle: string | null;
      cta: string | null;
      status: string;
      validationStatus: string;
      validationErrors: unknown;
      evidenceIds: string[];
      provider: string | null;
      model: string | null;
      promptVersion: string | null;
      scheduledAt: Date | null;
      approvedAt: Date | null;
      sentAt: Date | null;
      deliveredAt: Date | null;
      failureReason: string | null;
      createdAt: Date;
      updatedAt: Date;
      organizationId: string;
    },
    leadName: string,
    campaignName: string | null,
  ) {
    const { recipient, display } = await this.outreach.resolveRecipient(
      draft.leadId,
      draft.channel as Channel,
    );
    const suppressed = await this.suppression.checkLead(
      draft.organizationId,
      draft.leadId,
      draft.channel as Channel,
    );

    return {
      id: draft.id,
      leadId: draft.leadId,
      leadName,
      campaignId: draft.campaignId,
      campaignName,
      channel: draft.channel,
      kind: draft.kind,
      sequenceStep: draft.sequenceStep,
      subject: draft.subject,
      body: draft.body,
      angle: draft.angle,
      cta: draft.cta,
      status: draft.status,
      validationStatus: draft.validationStatus,
      validationErrors: draft.validationErrors as {
        severity: string;
        code: string;
        detail: string;
      }[],
      evidenceIds: draft.evidenceIds,
      provider: draft.provider,
      model: draft.model,
      promptVersion: draft.promptVersion,
      scheduledAt: draft.scheduledAt?.toISOString() ?? null,
      approvedAt: draft.approvedAt?.toISOString() ?? null,
      sentAt: draft.sentAt?.toISOString() ?? null,
      deliveredAt: draft.deliveredAt?.toISOString() ?? null,
      failureReason: draft.failureReason,
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
      recipient: recipient ? (display ?? recipient) : null,
      suppressed: Boolean(suppressed),
    };
  }

  private async linkToCampaign(
    organizationId: string,
    leadId: string,
    campaignId: string,
  ): Promise<void> {
    await this.prisma.campaignLeadLink
      .upsert({
        where: { campaignId_leadId: { campaignId, leadId } },
        create: { organizationId, campaignId, leadId },
        update: {},
      })
      .catch(() => undefined);
  }

  private async incrementLeadCounter(organizationId: string, by: number): Promise<void> {
    if (by <= 0) return;
    await this.prisma.usageCounter
      .upsert({
        where: {
          organizationId_metric_period: {
            organizationId,
            metric: 'leads',
            period: currentPeriod(),
          },
        },
        create: { organizationId, metric: 'leads', period: currentPeriod(), value: by },
        update: { value: { increment: by } },
      })
      .catch(() => undefined);
  }
}

/** RFC 4180 escaping. */
function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
