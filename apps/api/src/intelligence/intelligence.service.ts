import { Injectable } from '@nestjs/common';
import { AppError } from '@leadforge/shared';
import { PrismaService } from '@/common/prisma.service';
import { EvidenceService } from '@/common/evidence.service';
import { AiService } from '@/ai/ai.service';
import { ScoringService } from '@/scoring/scoring.service';
import { logger } from '@/common/logger';
import type { BusinessFacts, EvidenceFact } from '@leadforge/ai';

/**
 * AI business intelligence (docs/07 intelligence module, docs/19 schemas).
 *
 * The model receives facts and evidence, and nothing else. Its output is then
 * filtered: any claim citing an evidence ID that was not supplied is dropped
 * before the report is stored, because a citation we cannot resolve is
 * indistinguishable from a fabrication.
 */
@Injectable()
export class IntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: EvidenceService,
    private readonly ai: AiService,
    private readonly scoring: ScoringService,
  ) {}

  /** Runs analysis for a lead and stores a versioned report. */
  async analyze(
    organizationId: string,
    leadId: string,
    options: { force?: boolean; tier?: 'economy' | 'balanced' | 'quality' } = {},
  ): Promise<{ reportId: string; version: number }> {
    if (!this.ai.isConfigured()) throw AppError.providerNotConfigured('The AI gateway');

    const lead = await this.prisma.lead.findFirstOrThrow({
      where: { id: leadId, organizationId },
      include: {
        websiteAnalysis: true,
        socialProfiles: true,
        campaignLinks: { include: { campaign: true }, take: 1 },
        reports: { orderBy: { version: 'desc' }, take: 1 },
      },
    });

    const existing = lead.reports[0];
    // Re-analysing an unchanged lead burns budget for an identical answer.
    if (existing && !options.force && lead.enrichedAt && existing.createdAt > lead.enrichedAt) {
      return { reportId: existing.id, version: existing.version };
    }

    const facts = await this.evidence.factsForLead(leadId);
    if (facts.length === 0) {
      throw new AppError(
        'CONFLICT',
        'This lead has no recorded evidence yet. Run verification and enrichment before analysis.',
        { retryable: false },
      );
    }

    const campaign = lead.campaignLinks[0]?.campaign;
    const aiSettings = (campaign?.aiSettings ?? {}) as {
      offer?: string;
      objective?: string;
      tier?: 'economy' | 'balanced' | 'quality';
    };
    const filters = (campaign?.filters ?? {}) as { customRules?: string[] };

    const business = this.toBusinessFacts(lead);

    const response = await this.ai.run(
      'analyze_business',
      {
        business,
        evidence: facts as EvidenceFact[],
        offer: aiSettings.offer ?? 'General business services.',
        objective:
          aiSettings.objective ?? 'Start a conversation with a business worth working with.',
        customRules: filters.customRules ?? [],
      },
      { organizationId, campaignId: campaign?.id, leadId },
      { tier: options.tier ?? aiSettings.tier },
    );

    const analysis = response.result;
    const validEvidenceIds = new Set(facts.map((fact) => fact.id));

    // Drop citations the model invented, and drop claims left with none.
    const painPoints = this.filterClaims(
      analysis.pain_points,
      validEvidenceIds,
      'pain point',
      leadId,
    );
    const opportunities = this.filterClaims(
      analysis.opportunities,
      validEvidenceIds,
      'opportunity',
      leadId,
    );

    const latest = await this.prisma.intelligenceReport.findFirst({
      where: { leadId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;

    const report = await this.prisma.intelligenceReport.create({
      data: {
        organizationId,
        leadId,
        version,
        summary: analysis.summary,
        strengths: analysis.strengths as never,
        painPoints: painPoints as never,
        opportunities: opportunities as never,
        recommendedAngle: analysis.recommended_angle,
        objections: analysis.objections as never,
        unknowns: analysis.unknowns as never,
        confidence: analysis.confidence,
        provider: response.provider,
        model: response.model,
        promptVersion: response.promptVersion,
        schemaVersion: response.schemaVersion,
        evidenceIds: facts.map((fact) => fact.id),
      },
    });

    await this.prisma.lead.update({ where: { id: leadId }, data: { analyzedAt: new Date() } });

    // The analysis moves the opportunity dimension, so rescore immediately.
    const score = await this.scoring.score(organizationId, leadId);
    await this.scoring.persist(organizationId, leadId, score);

    logger('intelligence').info(
      { leadId, version, model: response.model, painPoints: painPoints.length },
      'lead analysed',
    );

    return { reportId: report.id, version };
  }

  /**
   * Asks the model to explain an already-computed score. If the call fails,
   * the deterministic explanation is kept — an unexplained score is far better
   * than no score.
   */
  async explainScore(organizationId: string, leadId: string): Promise<void> {
    const score = await this.scoring.score(organizationId, leadId);

    if (!this.ai.isConfigured()) {
      await this.scoring.persist(organizationId, leadId, score);
      return;
    }

    const lead = await this.prisma.lead.findFirstOrThrow({
      where: { id: leadId, organizationId },
      include: {
        websiteAnalysis: true,
        socialProfiles: true,
        campaignLinks: { include: { campaign: true }, take: 1 },
        reports: { orderBy: { version: 'desc' }, take: 1 },
      },
    });

    const facts = await this.evidence.factsForLead(leadId);
    const report = lead.reports[0];
    const aiSettings = (lead.campaignLinks[0]?.campaign?.aiSettings ?? {}) as { offer?: string };

    try {
      const response = await this.ai.run(
        'score_lead',
        {
          business: this.toBusinessFacts(lead),
          evidence: facts as EvidenceFact[],
          analysis: report
            ? {
                summary: report.summary,
                painPoints: (report.painPoints as { statement: string }[]).map(
                  (claim) => claim.statement,
                ),
                opportunities: (report.opportunities as { statement: string }[]).map(
                  (claim) => claim.statement,
                ),
                confidence: report.confidence,
              }
            : null,
          dimensions: score.dimensions,
          offer: aiSettings.offer ?? 'General business services.',
        },
        { organizationId, leadId },
        { tier: 'economy' },
      );

      // The model may only supply prose; the numbers stay as computed.
      const explanation = score.explanation.map((entry, index) => ({
        ...entry,
        reason: response.result.explanation[index] ?? entry.reason,
      }));

      await this.scoring.persist(
        organizationId,
        leadId,
        { ...score, explanation },
        {
          method: 'ai_assisted',
          provider: response.provider,
          model: response.model,
          promptVersion: response.promptVersion,
        },
      );
    } catch (error) {
      logger('intelligence').warn(
        { err: error, leadId },
        'score explanation failed; keeping the deterministic explanation',
      );
      await this.scoring.persist(organizationId, leadId, score);
    }
  }

  /* ------------------------------------------------------------- helpers */

  private filterClaims(
    claims: readonly { statement: string; evidence_ids: string[]; confidence: number }[],
    validIds: Set<string>,
    label: string,
    leadId: string,
  ): { statement: string; evidenceIds: string[]; confidence: number }[] {
    const kept: { statement: string; evidenceIds: string[]; confidence: number }[] = [];

    for (const claim of claims) {
      const resolved = claim.evidence_ids.filter((id) => validIds.has(id));
      if (resolved.length === 0) {
        logger('intelligence').warn(
          { leadId, statement: claim.statement.slice(0, 120) },
          `dropped ungrounded ${label} from the model`,
        );
        continue;
      }
      kept.push({
        statement: claim.statement,
        evidenceIds: resolved,
        confidence: claim.confidence,
      });
    }

    return kept;
  }

  /** Assembles the fact block the prompts consume. */
  toBusinessFacts(lead: {
    canonicalName: string;
    category: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    rating: number | null;
    reviewCount: number | null;
    source: string;
    websiteStatus: string;
    socialProfiles?: { platform: string; profileUrl: string }[];
  }): BusinessFacts {
    return {
      name: lead.canonicalName,
      category: lead.category,
      address: lead.address,
      city: lead.city,
      country: lead.country,
      phone: lead.phone,
      email: lead.email,
      website: lead.website,
      rating: lead.rating,
      reviewCount: lead.reviewCount,
      source: lead.source,
      websiteStatus: lead.websiteStatus,
      socialProfiles: (lead.socialProfiles ?? []).map((profile) => ({
        platform: profile.platform,
        url: profile.profileUrl,
      })),
    };
  }
}
