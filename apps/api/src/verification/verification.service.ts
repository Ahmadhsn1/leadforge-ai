import { Injectable } from '@nestjs/common';
import {
  canonicalizeUrl,
  nameSimilarity,
  normalizePhone,
  VerificationStatus,
} from '@leadforge/shared';
import { PrismaService } from '@/common/prisma.service';
import { EvidenceService } from '@/common/evidence.service';
import { logger } from '@/common/logger';

/**
 * Verification engine (docs/12-VERIFICATION-ENGINE.md).
 *
 * Deterministic and provider-backed. No model is consulted: a lead is never
 * marked verified because an LLM said so. Each check contributes a weighted
 * score and writes the evidence behind its verdict.
 */

export interface VerificationCheck {
  readonly check: string;
  readonly passed: boolean;
  /** Share of the total score this check contributes. */
  readonly weight: number;
  readonly detail: string;
  evidenceId?: string | null;
}

export interface VerificationOutcome {
  readonly status: VerificationStatus;
  readonly score: number;
  readonly checks: VerificationCheck[];
  readonly contactabilityScore: number;
}

/** Weights sum to 1. Identity and reachability dominate. */
const WEIGHTS = {
  identity: 0.2,
  freshness: 0.1,
  phone: 0.2,
  website_reachable: 0.2,
  domain_match: 0.1,
  geography: 0.1,
  not_duplicate: 0.1,
} as const;

/** A source record older than this is treated as stale. */
const FRESHNESS_DAYS = 90;

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: EvidenceService,
  ) {}

  /**
   * Runs every check for a lead and persists the record plus its evidence.
   *
   * Website reachability is read from the stored WebsiteAnalysis rather than
   * fetched here, so verification stays fast and deterministic; enrichment
   * owns the network call.
   */
  async verify(organizationId: string, leadId: string): Promise<VerificationOutcome> {
    const lead = await this.prisma.lead.findFirstOrThrow({
      where: { id: leadId, organizationId },
      include: {
        websiteAnalysis: true,
        sourceRecords: { orderBy: { fetchedAt: 'desc' }, take: 1 },
        campaignLinks: { include: { campaign: true }, take: 1 },
      },
    });

    const checks: VerificationCheck[] = [];

    /* 1. Business identity — a usable name and at least one locating field. */
    const hasName = lead.canonicalName.trim().length >= 2;
    const hasLocation = Boolean(lead.address || lead.city || (lead.latitude && lead.longitude));
    const identityPassed = hasName && hasLocation;
    checks.push({
      check: 'identity',
      passed: identityPassed,
      weight: WEIGHTS.identity,
      detail: identityPassed
        ? `Named business with a resolvable location (${[lead.city, lead.country].filter(Boolean).join(', ') || 'coordinates'}).`
        : 'The record lacks either a usable business name or any location field.',
    });

    /* 2. Source freshness. */
    const sourceRecord = lead.sourceRecords[0];
    const ageDays = sourceRecord
      ? (Date.now() - sourceRecord.fetchedAt.getTime()) / (24 * 60 * 60 * 1000)
      : Number.POSITIVE_INFINITY;
    const fresh = ageDays <= FRESHNESS_DAYS;
    checks.push({
      check: 'freshness',
      passed: fresh,
      weight: WEIGHTS.freshness,
      detail: sourceRecord
        ? `Source record fetched ${Math.round(ageDays)} days ago from ${lead.source}.`
        : 'No source record retained for this lead.',
    });

    /* 3. Phone format. */
    const phone = normalizePhone(lead.phone, lead.country ?? 'GB');
    checks.push({
      check: 'phone',
      passed: phone.valid,
      weight: WEIGHTS.phone,
      detail: lead.phone
        ? phone.valid
          ? `Phone normalises to ${phone.e164} (${phone.countryCode ?? 'unknown country'}).`
          : `The number on record could not be normalised (${phone.reason ?? 'invalid'}).`
        : 'No phone number on record.',
    });

    /* 4. Website reachability. */
    const analysis = lead.websiteAnalysis;
    const websiteReachable = analysis?.status === 'active';
    checks.push({
      check: 'website_reachable',
      passed: websiteReachable,
      weight: WEIGHTS.website_reachable,
      detail: !lead.website
        ? 'No website listed for this business.'
        : !analysis
          ? 'Website has not been checked yet.'
          : analysis.status === 'active'
            ? `Site responded with HTTP ${analysis.httpStatus} in ${analysis.responseTimeMs ?? '?'}ms.`
            : analysis.status === 'broken'
              ? `Site did not resolve to a healthy page: ${analysis.error ?? `HTTP ${analysis.httpStatus}`}.`
              : 'Website status could not be determined.',
    });

    /* 5. Domain / business identity match. */
    const domainMatch = this.checkDomainMatch(
      lead.canonicalName,
      lead.website,
      analysis?.title ?? null,
    );
    checks.push({
      check: 'domain_match',
      passed: domainMatch.passed,
      weight: WEIGHTS.domain_match,
      detail: domainMatch.detail,
    });

    /* 6. Geography and category fit against the campaign that found it. */
    const campaign = lead.campaignLinks[0]?.campaign;
    const geoTarget = campaign
      ? (campaign.target as { geo?: { country?: string } } | null)?.geo
      : undefined;
    const geoPassed = !geoTarget?.country || lead.country === geoTarget.country;
    checks.push({
      check: 'geography',
      passed: geoPassed,
      weight: WEIGHTS.geography,
      detail: geoTarget?.country
        ? geoPassed
          ? `Located in the targeted country (${lead.country}).`
          : `Located in ${lead.country ?? 'an unknown country'}, outside the targeted ${geoTarget.country}.`
        : 'No geographic constraint on the campaign.',
    });

    /* 7. Duplicate state. */
    const notDuplicate = lead.mergedIntoId === null;
    checks.push({
      check: 'not_duplicate',
      passed: notDuplicate,
      weight: WEIGHTS.not_duplicate,
      detail: notDuplicate
        ? 'This is the canonical record for the business.'
        : 'This record was merged into another lead.',
    });

    const score = Math.round(
      checks.reduce((total, check) => total + (check.passed ? check.weight : 0), 0) * 100,
    );
    const status = this.statusFor(score, checks);
    const contactabilityScore = this.contactability(
      lead.phone,
      lead.email,
      lead.website,
      websiteReachable,
    );

    /* Persist evidence for the checks that carry real information. */
    const evidenceIds = await this.evidence.recordMany([
      {
        organizationId,
        leadId,
        type: 'verification',
        statement: `Verification ${status} with a score of ${score}/100.`,
        source: 'leadforge_verification',
        confidence: 0.99,
        data: { checks: checks.map(({ check, passed }) => ({ check, passed })) },
      },
      ...(phone.valid
        ? [
            {
              organizationId,
              leadId,
              type: 'contact' as const,
              statement: `A valid ${phone.countryCode ?? 'international'} phone number is on record.`,
              source: lead.source,
              confidence: 0.95,
              data: { e164: phone.e164 },
            },
          ]
        : lead.phone
          ? [
              {
                organizationId,
                leadId,
                type: 'contact' as const,
                statement: 'The listed phone number could not be validated.',
                source: lead.source,
                confidence: 0.9,
                data: { raw: lead.phone, reason: phone.reason },
              },
            ]
          : [
              {
                organizationId,
                leadId,
                type: 'contact' as const,
                statement: 'No phone number is published for this business.',
                source: lead.source,
                confidence: 0.85,
              },
            ]),
      ...(lead.rating !== null && lead.reviewCount !== null
        ? [
            {
              organizationId,
              leadId,
              type: 'rating' as const,
              statement: `Rated ${lead.rating.toFixed(1)} out of 5 across ${lead.reviewCount} public reviews.`,
              source: lead.source,
              confidence: 0.95,
              data: { rating: lead.rating, reviewCount: lead.reviewCount },
            },
          ]
        : []),
    ]);

    const verificationEvidenceId = evidenceIds[0] ?? null;
    const withEvidence = checks.map((check) =>
      check.check === 'verification' ? { ...check, evidenceId: verificationEvidenceId } : check,
    );

    await this.prisma.$transaction([
      this.prisma.verificationRecord.create({
        data: {
          organizationId,
          leadId,
          status,
          score,
          checks: withEvidence as never,
          version: '1.0.0',
        },
      }),
      this.prisma.lead.update({
        where: { id: leadId },
        data: {
          verificationStatus: status,
          verificationScore: score,
          contactabilityScore,
          verifiedAt: new Date(),
        },
      }),
    ]);

    logger('verification').info({ leadId, status, score }, 'lead verified');

    return { status, score, checks: withEvidence, contactabilityScore };
  }

  /**
   * Maps a score to a status, with hard overrides: a merged record or a lead
   * with no identity is rejected regardless of what the other checks say.
   */
  private statusFor(score: number, checks: VerificationCheck[]): VerificationStatus {
    const failed = (name: string) => checks.some((check) => check.check === name && !check.passed);

    if (failed('not_duplicate') || failed('identity')) return 'rejected';
    if (failed('geography')) return 'needs_review';
    if (score >= 80) return 'verified';
    if (score >= 60) return 'probable';
    if (score >= 35) return 'needs_review';
    return 'rejected';
  }

  /**
   * Does the domain plausibly belong to this business? A mismatch is not a
   * failure on its own (agencies and franchises share domains), so this is a
   * low-weight signal.
   */
  private checkDomainMatch(
    name: string,
    website: string | null,
    pageTitle: string | null,
  ): { passed: boolean; detail: string } {
    if (!website)
      return { passed: false, detail: 'No website to match against the business name.' };

    const canonical = canonicalizeUrl(website);
    if (!canonical.domain) return { passed: false, detail: 'The website URL could not be parsed.' };

    const domainWord = canonical.domain.split('.')[0] ?? '';
    const nameSim = nameSimilarity(name, domainWord.replace(/[-_]/g, ' '));
    const titleSim = pageTitle ? nameSimilarity(name, pageTitle) : 0;
    const best = Math.max(nameSim, titleSim);

    if (best >= 0.6) {
      return {
        passed: true,
        detail: `Domain "${canonical.domain}"${pageTitle ? ` and page title "${pageTitle}"` : ''} match the business name.`,
      };
    }
    return {
      passed: false,
      detail: `Domain "${canonical.domain}" does not obviously belong to "${name}". It may be a directory listing or a shared site.`,
    };
  }

  /**
   * How reachable is this business, 0–100? Feeds the contactability score
   * dimension and the campaign's contact requirements.
   */
  private contactability(
    phone: string | null,
    email: string | null,
    website: string | null,
    websiteReachable: boolean,
  ): number {
    let score = 0;
    if (phone) score += 45;
    if (email) score += 30;
    if (website) score += websiteReachable ? 25 : 10;
    return Math.min(100, score);
  }
}
