import { Injectable } from '@nestjs/common';
import {
  DEFAULT_SCORE_WEIGHTS,
  READY_SCORE_THRESHOLD,
  temperatureForScore,
  CampaignFilters,
  ScoreDimension,
} from '@leadforge/shared';
import { PrismaService } from '@/common/prisma.service';
import { logger } from '@/common/logger';

/**
 * Lead scoring (docs/20-LEAD-SCORING.md).
 *
 * The numbers are computed deterministically here, from stored facts. The
 * model is only asked to explain them (see IntelligenceService), never to
 * produce them: a score that changes because a model was in a different mood
 * is not a score anyone can act on.
 */

export interface ScoreExplanation {
  readonly dimension: ScoreDimension;
  readonly value: number;
  readonly reason: string;
}

export interface ScoreResult {
  readonly total: number;
  readonly dimensions: Record<ScoreDimension, number>;
  readonly explanation: ScoreExplanation[];
  readonly weights: Record<ScoreDimension, number>;
}

@Injectable()
export class ScoringService {
  constructor(private readonly prisma: PrismaService) {}

  async score(organizationId: string, leadId: string): Promise<ScoreResult> {
    const lead = await this.prisma.lead.findFirstOrThrow({
      where: { id: leadId, organizationId },
      include: {
        websiteAnalysis: true,
        socialProfiles: true,
        evidence: true,
        reports: { orderBy: { version: 'desc' }, take: 1 },
        campaignLinks: { include: { campaign: true }, take: 1 },
      },
    });

    const campaign = lead.campaignLinks[0]?.campaign;
    const filters = (campaign?.filters ?? {}) as Partial<CampaignFilters>;
    const report = lead.reports[0];

    const explanation: ScoreExplanation[] = [];
    const dimensions = {} as Record<ScoreDimension, number>;

    /* --- Fit: does this business match what the campaign asked for? ------- */
    {
      let value = 50;
      const reasons: string[] = [];

      if (filters.minRating !== undefined && lead.rating !== null) {
        if (lead.rating >= filters.minRating) {
          value += 15;
          reasons.push(`rating ${lead.rating.toFixed(1)} meets the ${filters.minRating} threshold`);
        } else {
          value -= 25;
          reasons.push(
            `rating ${lead.rating.toFixed(1)} is below the ${filters.minRating} threshold`,
          );
        }
      }
      if (filters.minReviews !== undefined && lead.reviewCount !== null) {
        if (lead.reviewCount >= filters.minReviews) {
          value += 15;
          reasons.push(`${lead.reviewCount} reviews clears the ${filters.minReviews} minimum`);
        } else {
          value -= 20;
          reasons.push(`only ${lead.reviewCount} reviews against a ${filters.minReviews} minimum`);
        }
      }
      if (filters.websiteCondition && filters.websiteCondition !== 'any') {
        const matches =
          (filters.websiteCondition === 'without' && lead.websiteStatus === 'none') ||
          (filters.websiteCondition === 'broken' && lead.websiteStatus === 'broken') ||
          (filters.websiteCondition === 'with' && lead.websiteStatus === 'active');
        value += matches ? 20 : -30;
        reasons.push(
          matches
            ? `website status "${lead.websiteStatus}" matches the campaign target`
            : `website status "${lead.websiteStatus}" does not match the campaign target`,
        );
      }
      if (campaign) {
        const categories = ((campaign.target as { categories?: string[] }).categories ?? []).map(
          (c) => c.toLowerCase(),
        );
        if (categories.length > 0 && lead.categoryKey) {
          const matches = categories.some(
            (category) =>
              lead.categoryKey?.includes(category) || category.includes(lead.categoryKey ?? ''),
          );
          value += matches ? 10 : -10;
          if (matches) reasons.push(`category "${lead.category}" matches the campaign`);
        }
      }

      dimensions.fit = clamp(value);
      explanation.push({
        dimension: 'fit',
        value: dimensions.fit,
        reason:
          reasons.length > 0
            ? capitalise(reasons.join('; '))
            : 'No campaign filters to judge fit against.',
      });
    }

    /* --- Opportunity: how much room is there for the seller to help? ------ */
    {
      let value = 30;
      const reasons: string[] = [];
      const signals = (lead.websiteAnalysis?.opportunitySignals as string[] | undefined) ?? [];

      if (lead.websiteStatus === 'none') {
        value += 45;
        reasons.push('no website at all — the largest possible digital gap');
      } else if (lead.websiteStatus === 'broken') {
        value += 40;
        reasons.push('the listed website does not load');
      } else {
        // Each observed weakness adds room, with diminishing returns.
        const weighted = Math.min(35, signals.length * 8);
        value += weighted;
        if (signals.length > 0) reasons.push(`${signals.length} observable gaps on the live site`);
      }

      // Strong demand plus a weak digital footprint is the ideal shape.
      if ((lead.reviewCount ?? 0) >= 50 && lead.websiteStatus !== 'active') {
        value += 15;
        reasons.push(
          'strong review volume with no working site — demand exists but is not being captured',
        );
      }

      if (report) {
        const painPoints = (report.painPoints as unknown[]).length;
        if (painPoints > 0) {
          value += Math.min(10, painPoints * 3);
          reasons.push(`${painPoints} evidence-backed pain points identified`);
        }
      }

      dimensions.opportunity = clamp(value);
      explanation.push({
        dimension: 'opportunity',
        value: dimensions.opportunity,
        reason:
          reasons.length > 0
            ? capitalise(reasons.join('; '))
            : 'No observable gaps recorded for this business.',
      });
    }

    /* --- Contactability: can we actually reach them? --------------------- */
    {
      const hasInstagram = lead.socialProfiles.some((profile) => profile.platform === 'instagram');
      let value = 0;
      const channels: string[] = [];

      if (lead.phone) {
        value += 45;
        channels.push('phone');
      }
      if (lead.email) {
        value += 30;
        channels.push('email');
      }
      if (hasInstagram) {
        value += 15;
        channels.push('Instagram');
      }
      if (lead.website) {
        value += 10;
        channels.push('website');
      }

      // A required channel that is missing is disqualifying, not a deduction.
      const required = filters.requireContact ?? [];
      const missing = required.filter((requirement) => {
        if (requirement === 'phone') return !lead.phone;
        if (requirement === 'email') return !lead.email;
        if (requirement === 'website') return !lead.website;
        if (requirement === 'instagram') return !hasInstagram;
        return false;
      });
      if (missing.length > 0) value = Math.min(value, 25);

      dimensions.contactability = clamp(value);
      explanation.push({
        dimension: 'contactability',
        value: dimensions.contactability,
        reason:
          missing.length > 0
            ? `Missing required contact method${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`
            : channels.length > 0
              ? `Reachable by ${channels.join(', ')}.`
              : 'No contact route on record.',
      });
    }

    /* --- Maturity: is this a real, established business? ------------------ */
    {
      let value = 35;
      const reasons: string[] = [];

      const reviews = lead.reviewCount ?? 0;
      if (reviews >= 500) {
        value += 35;
        reasons.push(`${reviews} reviews indicate a long-established business`);
      } else if (reviews >= 100) {
        value += 25;
        reasons.push(`${reviews} reviews indicate an established business`);
      } else if (reviews >= 25) {
        value += 15;
        reasons.push(`${reviews} reviews indicate a going concern`);
      } else if (reviews > 0) {
        value += 5;
        reasons.push(`only ${reviews} reviews — early stage or low profile`);
      } else {
        reasons.push('no public reviews to judge maturity from');
      }

      if (lead.rating !== null && lead.rating >= 4.0) {
        value += 10;
        reasons.push(`a ${lead.rating.toFixed(1)} rating suggests they deliver`);
      }
      if (lead.websiteStatus === 'active') {
        value += 10;
        reasons.push('maintains a working website');
      }
      if (lead.socialProfiles.length > 0) {
        value += 5;
        reasons.push('maintains a public social presence');
      }

      dimensions.maturity = clamp(value);
      explanation.push({
        dimension: 'maturity',
        value: dimensions.maturity,
        reason: capitalise(reasons.join('; ')),
      });
    }

    /* --- Confidence: how well-evidenced is everything above? ------------- */
    {
      const evidenceCount = lead.evidence.length;
      const avgConfidence =
        evidenceCount > 0
          ? lead.evidence.reduce((sum, item) => sum + item.confidence, 0) / evidenceCount
          : 0;

      // Both the amount of evidence and its quality matter.
      const breadth = Math.min(50, evidenceCount * 7);
      const depth = avgConfidence * 50;
      const verificationBonus = lead.verificationStatus === 'verified' ? 10 : 0;

      dimensions.confidence = clamp(breadth + depth + verificationBonus);
      explanation.push({
        dimension: 'confidence',
        value: dimensions.confidence,
        reason:
          evidenceCount === 0
            ? 'No evidence has been recorded, so every judgement above is provisional.'
            : `${evidenceCount} evidence records at an average confidence of ${(avgConfidence * 100).toFixed(0)}%, verification status "${lead.verificationStatus}".`,
      });
    }

    /* --- Urgency: is now a good moment to contact them? ------------------ */
    {
      let value = 40;
      const reasons: string[] = [];

      if (lead.websiteStatus === 'broken') {
        value += 35;
        reasons.push(
          'their site is currently down — an immediate, concrete reason to make contact',
        );
      }
      if ((lead.reviewCount ?? 0) >= 100 && lead.websiteStatus === 'none') {
        value += 25;
        reasons.push('high demand with nowhere to send it');
      }
      if (lead.lastContactedAt) {
        const daysSince = (Date.now() - lead.lastContactedAt.getTime()) / (24 * 60 * 60 * 1000);
        if (daysSince < 14) {
          value -= 30;
          reasons.push(`contacted ${Math.round(daysSince)} days ago — too soon to approach again`);
        }
      }
      if (lead.status === 'do_not_contact') {
        value = 0;
        reasons.length = 0;
        reasons.push('marked do-not-contact');
      }

      dimensions.urgency = clamp(value);
      explanation.push({
        dimension: 'urgency',
        value: dimensions.urgency,
        reason:
          reasons.length > 0 ? capitalise(reasons.join('; ')) : 'No timing signal either way.',
      });
    }

    const weights = DEFAULT_SCORE_WEIGHTS;
    const total = Math.round(
      (Object.keys(weights) as ScoreDimension[]).reduce(
        (sum, dimension) => sum + dimensions[dimension] * weights[dimension],
        0,
      ),
    );

    return { total: clamp(total), dimensions, explanation, weights: { ...weights } };
  }

  /** Persists a score and updates the lead's derived status and temperature. */
  async persist(
    organizationId: string,
    leadId: string,
    result: ScoreResult,
    provenance: {
      method: string;
      provider?: string | null;
      model?: string | null;
      promptVersion?: string | null;
    } = {
      method: 'deterministic',
    },
  ): Promise<void> {
    const latest = await this.prisma.leadScore.findFirst({
      where: { leadId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;

    const lead = await this.prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { status: true },
    });

    // Only advance the status for leads still in the automatic part of the
    // pipeline; a human-set status (contacted, won, lost) is never overwritten.
    const automaticStatuses = ['new', 'qualified', 'ready'];
    const nextStatus = automaticStatuses.includes(lead.status)
      ? result.total >= READY_SCORE_THRESHOLD
        ? 'ready'
        : 'qualified'
      : lead.status;

    await this.prisma.$transaction([
      this.prisma.leadScore.create({
        data: {
          organizationId,
          leadId,
          version,
          total: result.total,
          fit: result.dimensions.fit,
          opportunity: result.dimensions.opportunity,
          contactability: result.dimensions.contactability,
          maturity: result.dimensions.maturity,
          confidence: result.dimensions.confidence,
          urgency: result.dimensions.urgency,
          explanation: result.explanation as never,
          method: provenance.method,
          weights: result.weights as never,
          provider: provenance.provider ?? null,
          model: provenance.model ?? null,
          promptVersion: provenance.promptVersion ?? null,
        },
      }),
      this.prisma.lead.update({
        where: { id: leadId },
        data: {
          leadScore: result.total,
          temperature: temperatureForScore(result.total),
          status: nextStatus,
          scoredAt: new Date(),
        },
      }),
    ]);

    logger('scoring').info({ leadId, total: result.total, status: nextStatus }, 'lead scored');
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
