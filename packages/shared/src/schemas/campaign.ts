import { z } from 'zod';
import { CAMPAIGN_STATUSES, CHANNELS } from '../domain/enums';
import { optionalTrimmed, paginationSchema, trimmed } from './common';

/** Geography targeting. Either a free-text location or an explicit radius search. */
export const geoTargetSchema = z
  .object({
    location: trimmed(160),
    country: z.string().trim().length(2).toUpperCase().default('GB'),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    radiusMeters: z.number().int().min(100).max(50_000).default(10_000),
  })
  .refine(
    (v) => (v.latitude === undefined) === (v.longitude === undefined),
    'latitude and longitude must be provided together',
  );
export type GeoTarget = z.infer<typeof geoTargetSchema>;

export const campaignFiltersSchema = z.object({
  minRating: z.number().min(0).max(5).optional(),
  maxRating: z.number().min(0).max(5).optional(),
  minReviews: z.number().int().min(0).optional(),
  maxReviews: z.number().int().min(0).optional(),
  /** any = ignore, with = must have a working site, without = no site, broken = site is down */
  websiteCondition: z.enum(['any', 'with', 'without', 'broken']).default('any'),
  socialCondition: z.enum(['any', 'with_instagram', 'without_instagram']).default('any'),
  /** Contact details a lead must have to pass qualification. */
  requireContact: z.array(z.enum(['phone', 'email', 'website', 'instagram'])).default([]),
  excludeChains: z.boolean().default(false),
  excludeKeywords: z.array(trimmed(60)).max(50).default([]),
  minScore: z.number().int().min(0).max(100).optional(),
  /** Free-text qualification rules handed to the analysis prompt as constraints. */
  customRules: z.array(trimmed(300)).max(20).default([]),
});
export type CampaignFilters = z.infer<typeof campaignFiltersSchema>;

export const campaignTargetSchema = z.object({
  categories: z.array(trimmed(80)).min(1).max(10),
  keywords: z.array(trimmed(80)).max(20).default([]),
  geo: geoTargetSchema,
  leadLimit: z.number().int().min(1).max(5_000).default(100),
});
export type CampaignTarget = z.infer<typeof campaignTargetSchema>;

export const campaignAiSettingsSchema = z.object({
  /** What the user sells; drives the recommended angle and message content. */
  offer: trimmed(400),
  objective: trimmed(400),
  tone: z.enum(['professional', 'friendly', 'direct', 'consultative']).default('friendly'),
  cta: trimmed(200).default('Ask if they are open to a quick chat this week.'),
  senderName: optionalTrimmed(120),
  senderCompany: optionalTrimmed(120),
  /** Cost/quality preference passed to the model router. */
  tier: z.enum(['economy', 'balanced', 'quality']).default('balanced'),
});
export type CampaignAiSettings = z.infer<typeof campaignAiSettingsSchema>;

export const createCampaignSchema = z.object({
  name: trimmed(160),
  description: optionalTrimmed(1_000),
  source: z.enum(['google_places', 'csv']).default('google_places'),
  channel: z.enum(CHANNELS).default('whatsapp'),
  target: campaignTargetSchema,
  filters: campaignFiltersSchema.default({}),
  ai: campaignAiSettingsSchema,
  /** Automatically generate drafts once leads are scored. */
  autoPersonalize: z.boolean().default(true),
  /** Follow-up sequence template applied when a message is sent. */
  sequenceId: z.string().optional(),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = createCampaignSchema.partial().extend({
  status: z.enum(CAMPAIGN_STATUSES).optional(),
});
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

export const listCampaignsSchema = paginationSchema.extend({
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  search: optionalTrimmed(160),
});

export const startCampaignSchema = z.object({
  /** Overrides the campaign lead limit for this run only. */
  leadLimit: z.number().int().min(1).max(5_000).optional(),
  /** Re-run stages for leads that already exist. */
  refresh: z.boolean().default(false),
});
