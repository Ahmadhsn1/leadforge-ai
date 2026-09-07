import { z } from 'zod';
import { CHANNELS, DRAFT_KINDS } from '../domain/enums';

/**
 * Job payload contracts (docs/28-QUEUE-WORKERS.md).
 * Every payload carries the tenant, the correlation IDs and an idempotency
 * key so a retried job is provably the same unit of work.
 */

export const jobBaseSchema = z.object({
  jobId: z.string().min(1),
  organizationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  inputVersion: z.number().int().min(1).default(1),
  requestId: z.string().optional(),
  campaignId: z.string().optional(),
  runId: z.string().optional(),
  leadId: z.string().optional(),
});
export type JobBase = z.infer<typeof jobBaseSchema>;

export const discoveryJobSchema = jobBaseSchema.extend({
  campaignId: z.string().min(1),
  runId: z.string().min(1),
  leadLimit: z.number().int().min(1).max(5_000),
  refresh: z.boolean().default(false),
});
export type DiscoveryJob = z.infer<typeof discoveryJobSchema>;

export const normalizationJobSchema = jobBaseSchema.extend({
  campaignId: z.string().min(1),
  runId: z.string().min(1),
  /** ID of the persisted raw provider record to normalise. */
  sourceRecordId: z.string().min(1),
});
export type NormalizationJob = z.infer<typeof normalizationJobSchema>;

export const leadStageJobSchema = jobBaseSchema.extend({
  leadId: z.string().min(1),
  campaignId: z.string().optional(),
  runId: z.string().optional(),
  force: z.boolean().default(false),
});
export type LeadStageJob = z.infer<typeof leadStageJobSchema>;

export const personalizationJobSchema = leadStageJobSchema.extend({
  channel: z.enum(CHANNELS),
  kinds: z.array(z.enum(DRAFT_KINDS)).min(1),
  tone: z.enum(['professional', 'friendly', 'direct', 'consultative']).optional(),
  cta: z.string().max(200).optional(),
  offer: z.string().max(400).optional(),
});
export type PersonalizationJob = z.infer<typeof personalizationJobSchema>;

export const outreachSendJobSchema = jobBaseSchema.extend({
  draftId: z.string().min(1),
  leadId: z.string().min(1),
  channel: z.enum(CHANNELS),
  /** Set when the send was scheduled rather than immediate. */
  scheduledAt: z.string().optional(),
  startSequence: z.boolean().default(true),
});
export type OutreachSendJob = z.infer<typeof outreachSendJobSchema>;

export const sequenceStepJobSchema = jobBaseSchema.extend({
  leadId: z.string().min(1),
  sequenceRunId: z.string().min(1),
  stepOrder: z.number().int().min(1),
});
export type SequenceStepJob = z.infer<typeof sequenceStepJobSchema>;

export const classifyReplyJobSchema = jobBaseSchema.extend({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
});
export type ClassifyReplyJob = z.infer<typeof classifyReplyJobSchema>;

export const analyticsJobSchema = jobBaseSchema.extend({
  campaignId: z.string().optional(),
  runId: z.string().optional(),
  reason: z.enum(['stage_complete', 'scheduled', 'manual']).default('scheduled'),
});
export type AnalyticsJob = z.infer<typeof analyticsJobSchema>;

export const advanceRunJobSchema = jobBaseSchema.extend({
  runId: z.string().min(1),
  campaignId: z.string().min(1),
});
export type AdvanceRunJob = z.infer<typeof advanceRunJobSchema>;

export const JOB_SCHEMAS = {
  'discovery.run': discoveryJobSchema,
  'normalization.candidate': normalizationJobSchema,
  'verification.lead': leadStageJobSchema,
  'enrichment.lead': leadStageJobSchema,
  'intelligence.analyze': leadStageJobSchema,
  'scoring.lead': leadStageJobSchema,
  'personalization.lead': personalizationJobSchema,
  'outreach.send': outreachSendJobSchema,
  'outreach.schedule-follow-ups': sequenceStepJobSchema,
  'outreach.sweep-follow-ups': jobBaseSchema,
  'outreach.classify-reply': classifyReplyJobSchema,
  'analytics.rollup': analyticsJobSchema,
  'analytics.advance-run': advanceRunJobSchema,
} as const;

export type JobSchemas = typeof JOB_SCHEMAS;
export type JobPayloadOf<T extends keyof JobSchemas> = z.infer<JobSchemas[T]>;
