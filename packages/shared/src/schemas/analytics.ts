import { z } from 'zod';

export const analyticsRangeSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  campaignId: z.string().optional(),
});
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;

/** Funnel stages from docs/32-ANALYTICS.md. */
export const FUNNEL_STAGES = [
  'discovered',
  'verified',
  'qualified',
  'ready',
  'contacted',
  'replied',
  'positive',
  'meeting',
  'won',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export interface FunnelPoint {
  readonly stage: FunnelStage;
  readonly count: number;
  /** Conversion from the previous stage, 0-1. */
  readonly conversion: number;
}

export interface AnalyticsOverview {
  readonly funnel: FunnelPoint[];
  readonly rates: {
    readonly verification: number;
    readonly qualification: number;
    readonly reply: number;
    readonly positiveReply: number;
    readonly meeting: number;
    readonly win: number;
    readonly messageApproval: number;
  };
  readonly totals: {
    readonly campaigns: number;
    readonly activeCampaigns: number;
    readonly leads: number;
    readonly messagesSent: number;
    readonly conversations: number;
    readonly openConversations: number;
  };
  readonly medianTimeToReplyHours: number | null;
  readonly generatedAt: string;
}

export interface AiUsageSummary {
  readonly requests: number;
  readonly failures: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly avgLatencyMs: number;
  readonly p95LatencyMs: number;
  readonly byModel: {
    readonly model: string;
    readonly provider: string;
    readonly requests: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostUsd: number;
    readonly avgLatencyMs: number;
    readonly failures: number;
  }[];
  readonly byTask: {
    readonly task: string;
    readonly requests: number;
    readonly estimatedCostUsd: number;
  }[];
}

export interface OperationalMetrics {
  readonly queues: {
    readonly name: string;
    readonly waiting: number;
    readonly active: number;
    readonly completed: number;
    readonly failed: number;
    readonly delayed: number;
  }[];
  readonly deadLetterCount: number;
  readonly failureRate: number;
  readonly retryCount: number;
}
