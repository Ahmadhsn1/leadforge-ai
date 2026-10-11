import type { Plan } from '../domain/enums';

export interface PlanQuota {
  readonly plan: Plan;
  readonly label: string;
  /** One line on who the plan is for; shown on the pricing and billing screens. */
  readonly audience: string;
  /** List price in whole US dollars per month. Zero means no payment is taken. */
  readonly monthlyPriceUsd: number;
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
    audience: 'Try the full research pipeline on a handful of leads.',
    monthlyPriceUsd: 0,
    monthlyLeads: 100,
    monthlyAiRequests: 300,
    monthlyMessages: 50,
    maxCampaigns: 2,
    maxMembers: 2,
    // Writing and sending a message is the point of the product, so the free
    // plan includes it — the 50-message allowance is what bounds it.
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
  starter: {
    plan: 'starter',
    label: 'Starter',
    audience: 'Freelancers running their own outreach.',
    monthlyPriceUsd: 29,
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
    audience: 'Small teams that follow up and work replies together.',
    monthlyPriceUsd: 79,
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
    audience: 'Agencies prospecting for several clients at once.',
    monthlyPriceUsd: 199,
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
    ],
  },
};

export const PLAN_FEATURES = [
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
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

/** Whether a plan includes a feature. Unknown plans are treated as free. */
export function planHasFeature(plan: string, feature: PlanFeature): boolean {
  const quota = PLAN_QUOTAS[plan as Plan] ?? PLAN_QUOTAS.free;
  return quota.features.includes(feature);
}

/** The cheapest plan that includes a feature — what an upgrade prompt should name. */
export function cheapestPlanWith(feature: PlanFeature): PlanQuota {
  const match = Object.values(PLAN_QUOTAS)
    .filter((quota) => quota.features.includes(feature))
    .sort((a, b) => a.monthlyPriceUsd - b.monthlyPriceUsd)[0];
  return match ?? PLAN_QUOTAS.agency;
}

/** Usage counters tracked against plan quotas. */
export const USAGE_METRICS = ['leads', 'ai_requests', 'messages'] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export const QUOTA_FIELD_BY_METRIC: Readonly<Record<UsageMetric, keyof PlanQuota>> = {
  leads: 'monthlyLeads',
  ai_requests: 'monthlyAiRequests',
  messages: 'monthlyMessages',
};
