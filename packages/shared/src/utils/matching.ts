import { nameSimilarity, normalizeAddress, similarity, distanceMeters } from './text';
import { phoneKey } from './phone';
import { domainKey } from './url';

/**
 * Deterministic duplicate detection (docs/11-NORMALIZATION-DEDUPE.md).
 * Provider external IDs are handled by the caller as an exact match; this
 * module supplies the fuzzy signal score used when no external ID matches.
 */

export interface MatchCandidate {
  readonly name?: string | null;
  readonly phone?: string | null;
  readonly website?: string | null;
  readonly address?: string | null;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly country?: string | null;
}

export type MatchDecision = 'merge' | 'review' | 'distinct';

export interface MatchResult {
  readonly score: number;
  readonly decision: MatchDecision;
  readonly signals: Readonly<Record<string, number>>;
  readonly reasons: readonly string[];
}

export const MATCH_THRESHOLDS = {
  merge: 0.86,
  review: 0.62,
} as const;

const WEIGHTS = {
  name: 0.35,
  phone: 0.25,
  domain: 0.2,
  address: 0.12,
  geo: 0.08,
} as const;

export function matchCandidates(a: MatchCandidate, b: MatchCandidate): MatchResult {
  const signals: Record<string, number> = {};
  const reasons: string[] = [];
  let weighted = 0;
  let totalWeight = 0;

  const nameScore = nameSimilarity(a.name, b.name);
  if (a.name && b.name) {
    signals.name = round(nameScore);
    weighted += nameScore * WEIGHTS.name;
    totalWeight += WEIGHTS.name;
    if (nameScore >= 0.9) reasons.push('Business names are effectively identical');
  }

  const phoneA = phoneKey(a.phone, a.country ?? 'GB');
  const phoneB = phoneKey(b.phone, b.country ?? 'GB');
  if (phoneA && phoneB) {
    const score = phoneA === phoneB ? 1 : 0;
    signals.phone = score;
    weighted += score * WEIGHTS.phone;
    totalWeight += WEIGHTS.phone;
    if (score === 1) reasons.push('Identical normalised phone number');
  }

  const domainA = domainKey(a.website);
  const domainB = domainKey(b.website);
  if (domainA && domainB) {
    const score = domainA === domainB ? 1 : 0;
    signals.domain = score;
    weighted += score * WEIGHTS.domain;
    totalWeight += WEIGHTS.domain;
    if (score === 1) reasons.push(`Identical website domain (${domainA})`);
  }

  if (a.address && b.address) {
    const score = similarity(normalizeAddress(a.address), normalizeAddress(b.address));
    signals.address = round(score);
    weighted += score * WEIGHTS.address;
    totalWeight += WEIGHTS.address;
    if (score >= 0.9) reasons.push('Addresses match closely');
  }

  if (
    typeof a.latitude === 'number' &&
    typeof a.longitude === 'number' &&
    typeof b.latitude === 'number' &&
    typeof b.longitude === 'number'
  ) {
    const metres = distanceMeters(
      { lat: a.latitude, lng: a.longitude },
      { lat: b.latitude, lng: b.longitude },
    );
    // 0 m -> 1.0, 250 m -> 0.0 (linear); beyond 250 m contributes nothing.
    const score = Math.max(0, 1 - metres / 250);
    signals.geo = round(score);
    weighted += score * WEIGHTS.geo;
    totalWeight += WEIGHTS.geo;
    if (metres <= 50) reasons.push(`Locations are ${Math.round(metres)} m apart`);
  }

  if (totalWeight === 0) {
    return { score: 0, decision: 'distinct', signals, reasons: ['No comparable signals'] };
  }

  let score = weighted / totalWeight;

  // A hard identifier collision (phone or domain) plus a plausible name is
  // enough on its own; without it, a name alone must not trigger a merge.
  const hardIdentifierMatch = signals.phone === 1 || signals.domain === 1;
  if (hardIdentifierMatch && nameScore >= 0.6) {
    score = Math.max(score, MATCH_THRESHOLDS.merge);
    reasons.push('Hard identifier match with a consistent business name');
  }
  if (!hardIdentifierMatch && Object.keys(signals).length === 1 && signals.name !== undefined) {
    score = Math.min(score, MATCH_THRESHOLDS.review);
    reasons.push('Name-only match cannot be auto-merged');
  }

  const decision: MatchDecision =
    score >= MATCH_THRESHOLDS.merge
      ? 'merge'
      : score >= MATCH_THRESHOLDS.review
        ? 'review'
        : 'distinct';

  return { score: round(score), decision, signals, reasons };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
