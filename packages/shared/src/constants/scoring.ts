/** Scoring weights from docs/20-LEAD-SCORING.md. Configurable per campaign later. */
export const SCORE_DIMENSIONS = [
  'fit',
  'opportunity',
  'contactability',
  'maturity',
  'confidence',
  'urgency',
] as const;

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

export const DEFAULT_SCORE_WEIGHTS: Readonly<Record<ScoreDimension, number>> = {
  fit: 0.25,
  opportunity: 0.25,
  contactability: 0.15,
  maturity: 0.1,
  confidence: 0.15,
  urgency: 0.1,
};

export const SCORE_BUCKETS = [
  { min: 90, max: 100, label: 'Hot' },
  { min: 75, max: 89, label: 'Warm' },
  { min: 60, max: 74, label: 'Moderate' },
  { min: 0, max: 59, label: 'Low' },
] as const;

/** A lead below this score is not surfaced as "ready" without human override. */
export const READY_SCORE_THRESHOLD = 60;
