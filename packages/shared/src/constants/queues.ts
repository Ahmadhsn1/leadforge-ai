/** Queue names from docs/28-QUEUE-WORKERS.md. */
export const QUEUE_NAMES = {
  discovery: 'leadforge.discovery',
  normalization: 'leadforge.normalization',
  verification: 'leadforge.verification',
  enrichment: 'leadforge.enrichment',
  intelligence: 'leadforge.intelligence',
  scoring: 'leadforge.scoring',
  personalization: 'leadforge.personalization',
  outreach: 'leadforge.outreach',
  analytics: 'leadforge.analytics',
} as const;

export type QueueKey = keyof typeof QUEUE_NAMES;
export type QueueName = (typeof QUEUE_NAMES)[QueueKey];

export const ALL_QUEUE_KEYS = Object.keys(QUEUE_NAMES) as QueueKey[];
export const ALL_QUEUE_NAMES = Object.values(QUEUE_NAMES) as QueueName[];

/**
 * Per-queue retry policy. Long-running network stages get more attempts with
 * a longer backoff; deterministic CPU stages fail fast.
 */
export interface QueuePolicy {
  readonly attempts: number;
  readonly backoffMs: number;
  readonly concurrency: number;
  /** Max jobs per `rateLimitWindowMs` across the worker fleet. */
  readonly rateLimitMax?: number;
  readonly rateLimitWindowMs?: number;
}

export const QUEUE_POLICIES: Readonly<Record<QueueKey, QueuePolicy>> = {
  discovery: {
    attempts: 5,
    backoffMs: 5_000,
    concurrency: 2,
    rateLimitMax: 30,
    rateLimitWindowMs: 1_000,
  },
  normalization: { attempts: 3, backoffMs: 1_000, concurrency: 8 },
  verification: { attempts: 4, backoffMs: 3_000, concurrency: 6 },
  enrichment: {
    attempts: 4,
    backoffMs: 5_000,
    concurrency: 4,
    rateLimitMax: 20,
    rateLimitWindowMs: 1_000,
  },
  intelligence: {
    attempts: 4,
    backoffMs: 8_000,
    concurrency: 3,
    rateLimitMax: 10,
    rateLimitWindowMs: 1_000,
  },
  scoring: { attempts: 3, backoffMs: 2_000, concurrency: 6 },
  personalization: {
    attempts: 4,
    backoffMs: 8_000,
    concurrency: 3,
    rateLimitMax: 10,
    rateLimitWindowMs: 1_000,
  },
  outreach: {
    attempts: 5,
    backoffMs: 10_000,
    concurrency: 2,
    rateLimitMax: 5,
    rateLimitWindowMs: 1_000,
  },
  analytics: { attempts: 3, backoffMs: 5_000, concurrency: 2 },
};

/** Job names within each queue. */
export const JOB_NAMES = {
  discoveryRun: 'discovery.run',
  normalizeCandidate: 'normalization.candidate',
  verifyLead: 'verification.lead',
  enrichLead: 'enrichment.lead',
  analyzeLead: 'intelligence.analyze',
  scoreLead: 'scoring.lead',
  personalizeLead: 'personalization.lead',
  sendOutreach: 'outreach.send',
  scheduleFollowUps: 'outreach.schedule-follow-ups',
  sweepFollowUps: 'outreach.sweep-follow-ups',
  classifyReply: 'outreach.classify-reply',
  rollupAnalytics: 'analytics.rollup',
  advanceRun: 'analytics.advance-run',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
