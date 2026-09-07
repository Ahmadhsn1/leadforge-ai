import type { Temperature } from './enums';

/** Score buckets from docs/20-LEAD-SCORING.md. */
export function temperatureForScore(score: number | null | undefined): Temperature {
  if (score === null || score === undefined || Number.isNaN(score)) return 'unscored';
  if (score >= 90) return 'hot';
  if (score >= 75) return 'warm';
  if (score >= 60) return 'moderate';
  return 'low';
}
