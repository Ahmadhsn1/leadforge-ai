import type { Plan } from '../domain/enums';

export interface PlanQuota {
  readonly plan: Plan;
  readonly label: string;
  readonly monthlyLeads: number;
  readonly monthlyAiRequests: number;
  readonly monthlyMessages: number;
  readonly maxCampaigns: number;
  readonly maxMembers: number;
  readonly features: readonly string[];
}

export const PLAN_QUOTAS: Readonly<Record<Plan, PlanQuota>> = {
  free: {
    plan: 'free',
    label: 'Free',
    monthlyLeads: 100,
    monthlyAiRequests: 300,
    monthlyMessages: 50,
    maxCampaigns: 2,
    maxMembers: 2,
    features: ['discovery', 'verification', 'enrichment', 'intelligence', 'scoring'],
  },
  starter: {
    plan: 'starter',
    label: 'Starter',
    monthlyLeads: 1_000,
    monthlyAiRequests: 5_000,
    monthlyMessages: 1_000,
    maxCampaigns: 10,
    maxMembers: 3,
    features: [
      'discovery',
      'verification',
      'enrichment',
      'intelligence',
      'scoring',
      'personalization',
      'outreach',
    ],
  },
  growth: {
    plan: 'growth',
    label: 'Growth',
    monthlyLeads: 10_000,
    monthlyAiRequests: 50_000,
    monthlyMessages: 10_000,
    maxCampaigns: 50,
    maxMembers: 10,
    features: [
      'discovery',
      'verification',
      'enrichment',
      'intelligence',
      'scoring',
      'personalization',
      'outreach',
      'sequences',
      'copilot',
      'analytics',
    ],
  },
  agency: {
    plan: 'agency',
    label: 'Agency',
    monthlyLeads: 100_000,
    monthlyAiRequests: 500_000,
    monthlyMessages: 100_000,
    maxCampaigns: 500,
    maxMembers: 50,
    features: [
      'discovery',
      'verification',
      'enrichment',
      'intelligence',
      'scoring',
      'personalization',
      'outreach',
      'sequences',
      'copilot',
      'analytics',
      'white_label',
    ],
  },
};

/** Usage counters tracked against plan quotas. */
export const USAGE_METRICS = ['leads', 'ai_requests', 'messages'] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export const QUOTA_FIELD_BY_METRIC: Readonly<Record<UsageMetric, keyof PlanQuota>> = {
  leads: 'monthlyLeads',
  ai_requests: 'monthlyAiRequests',
  messages: 'monthlyMessages',
};
