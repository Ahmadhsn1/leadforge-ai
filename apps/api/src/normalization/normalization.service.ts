import { Injectable } from '@nestjs/common';
import {
  MATCH_THRESHOLDS,
  canonicalizeUrl,
  domainKey,
  matchCandidates,
  normalizeBusinessName,
  normalizeCategory,
  normalizeEmail,
  normalizePhone,
  phoneKey,
  MatchResult,
} from '@leadforge/shared';
import { PrismaService } from '@/common/prisma.service';
import { logger } from '@/common/logger';
import type { RawCandidate } from '@/discovery/adapters/source-adapter';

/**
 * Normalisation and deduplication (docs/11-NORMALIZATION-DEDUPE.md).
 *
 * Two levels of identity:
 *   1. Provider external ID — an exact match, handled by a unique constraint.
 *   2. Fuzzy signals — name, phone, domain, address, coordinates.
 *
 * A high-confidence fuzzy match merges automatically; a medium one is recorded
 * for human review rather than guessed at.
 */

export interface NormalizedLead {
  readonly canonicalName: string;
  readonly nameKey: string;
  readonly category: string | null;
  readonly categoryKey: string | null;
  readonly address: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly country: string | null;
  readonly postalCode: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly phone: string | null;
  readonly phoneKey: string | null;
  readonly email: string | null;
  readonly website: string | null;
  readonly domainKey: string | null;
  readonly rating: number | null;
  readonly reviewCount: number | null;
}

export interface DedupeOutcome {
  readonly leadId: string;
  /** created = new lead, merged = folded into an existing one. */
  readonly outcome: 'created' | 'merged' | 'existing';
  readonly match?: MatchResult;
  readonly reviewCandidateId?: string;
}

@Injectable()
export class NormalizationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Canonicalises a raw provider record into the shape a Lead stores. */
  normalize(candidate: RawCandidate, defaultCountry = 'GB'): NormalizedLead {
    const country = (candidate.country ?? defaultCountry).toUpperCase().slice(0, 2);
    const phone = normalizePhone(candidate.phone, country);
    const url = canonicalizeUrl(candidate.website);

    return {
      canonicalName: candidate.name.trim().replace(/\s+/g, ' '),
      nameKey: normalizeBusinessName(candidate.name),
      category: candidate.category?.trim() ?? null,
      categoryKey: candidate.category ? normalizeCategory(candidate.category) : null,
      address: candidate.address?.trim() ?? null,
      city: candidate.city?.trim() ?? null,
      region: candidate.region?.trim() ?? null,
      country,
      postalCode: candidate.postalCode?.trim() ?? null,
      latitude: typeof candidate.latitude === 'number' ? candidate.latitude : null,
      longitude: typeof candidate.longitude === 'number' ? candidate.longitude : null,
      // Store the E.164 form when parseable; keep the raw value otherwise so
      // a human can still read it.
      phone: phone.e164 ?? candidate.phone?.trim() ?? null,
      phoneKey: phone.valid ? phone.e164 : phoneKey(candidate.phone, country),
      email: null,
      website: url.valid ? url.url : null,
      domainKey: url.domain,
      rating: typeof candidate.rating === 'number' ? candidate.rating : null,
      reviewCount: typeof candidate.reviewCount === 'number' ? candidate.reviewCount : null,
    };
  }

  /**
   * Finds an existing lead this candidate is the same business as.
   *
   * Cheap exact lookups first (phone, domain), then a bounded fuzzy pass over
   * leads sharing a name token — a full-table comparison would not scale.
   */
  async findDuplicate(
    organizationId: string,
    normalized: NormalizedLead,
  ): Promise<{ leadId: string; match: MatchResult } | null> {
    const exactCandidates = await this.prisma.lead.findMany({
      where: {
        organizationId,
        mergedIntoId: null,
        OR: [
          ...(normalized.phoneKey ? [{ phoneKey: normalized.phoneKey }] : []),
          ...(normalized.domainKey ? [{ domainKey: normalized.domainKey }] : []),
        ],
      },
      take: 25,
    });

    const fuzzyCandidates =
      normalized.nameKey.length >= 3
        ? await this.prisma.lead.findMany({
            where: {
              organizationId,
              mergedIntoId: null,
              nameKey: { startsWith: normalized.nameKey.split(' ')[0] ?? normalized.nameKey },
              ...(normalized.city ? { city: normalized.city } : {}),
            },
            take: 50,
          })
        : [];

    const seen = new Set<string>();
    const pool = [...exactCandidates, ...fuzzyCandidates].filter((lead) => {
      if (seen.has(lead.id)) return false;
      seen.add(lead.id);
      return true;
    });

    let best: { leadId: string; match: MatchResult } | null = null;

    for (const existing of pool) {
      const match = matchCandidates(
        {
          name: normalized.canonicalName,
          phone: normalized.phone,
          website: normalized.website,
          address: normalized.address,
          latitude: normalized.latitude,
          longitude: normalized.longitude,
          country: normalized.country,
        },
        {
          name: existing.canonicalName,
          phone: existing.phone,
          website: existing.website,
          address: existing.address,
          latitude: existing.latitude,
          longitude: existing.longitude,
          country: existing.country,
        },
      );

      if (match.score >= MATCH_THRESHOLDS.review && (!best || match.score > best.match.score)) {
        best = { leadId: existing.id, match };
      }
    }

    return best;
  }

  /**
   * Merges a duplicate into the surviving lead, filling gaps only.
   *
   * Existing values win: a later record that omits a phone number must not
   * erase one an earlier record supplied.
   */
  async mergeInto(leadId: string, normalized: NormalizedLead): Promise<void> {
    const existing = await this.prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        phone: existing.phone ?? normalized.phone,
        phoneKey: existing.phoneKey ?? normalized.phoneKey,
        website: existing.website ?? normalized.website,
        domainKey: existing.domainKey ?? normalized.domainKey,
        address: existing.address ?? normalized.address,
        city: existing.city ?? normalized.city,
        region: existing.region ?? normalized.region,
        postalCode: existing.postalCode ?? normalized.postalCode,
        latitude: existing.latitude ?? normalized.latitude,
        longitude: existing.longitude ?? normalized.longitude,
        category: existing.category ?? normalized.category,
        categoryKey: existing.categoryKey ?? normalized.categoryKey,
        // Review counts only grow; take the higher figure as the fresher one.
        rating: normalized.rating ?? existing.rating,
        reviewCount:
          normalized.reviewCount !== null && (existing.reviewCount ?? 0) < normalized.reviewCount
            ? normalized.reviewCount
            : existing.reviewCount,
      },
    });
  }

  /** Records a medium-confidence pair for a human to resolve. */
  async recordReviewCandidate(
    organizationId: string,
    leadId: string,
    candidateLeadId: string,
    match: MatchResult,
  ): Promise<void> {
    await this.prisma.mergeCandidate
      .upsert({
        where: { leadId_candidateLeadId: { leadId, candidateLeadId } },
        create: {
          organizationId,
          leadId,
          candidateLeadId,
          score: match.score,
          decision: match.decision,
          signals: match.signals as never,
          reasons: [...match.reasons],
        },
        update: { score: match.score, decision: match.decision, signals: match.signals as never },
      })
      .catch((error) => {
        logger('normalization').warn({ err: error, leadId }, 'could not record merge candidate');
      });
  }

  /** Normalises a free-form contact value for storage and matching. */
  normalizeContact(
    kind: string,
    value: string,
    country = 'GB',
  ): { value: string; valueKey: string } | null {
    if (kind === 'phone') {
      const phone = normalizePhone(value, country);
      if (!phone.e164) return null;
      return { value: phone.e164, valueKey: phone.e164 };
    }
    if (kind === 'email') {
      const email = normalizeEmail(value);
      if (!email) return null;
      return { value: email, valueKey: email };
    }
    if (kind === 'website') {
      const url = canonicalizeUrl(value);
      if (!url.valid || !url.url) return null;
      return { value: url.url, valueKey: url.domain ?? url.url };
    }
    const trimmed = value.trim();
    return trimmed ? { value: trimmed, valueKey: trimmed.toLowerCase() } : null;
  }

  /** Exposed for the import path, which supplies emails directly. */
  emailKey(value: string | null | undefined): string | null {
    return normalizeEmail(value);
  }

  domainKeyFor(value: string | null | undefined): string | null {
    return domainKey(value);
  }
}
