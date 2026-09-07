import { z } from 'zod';
import { CHANNELS, REPLY_INTENTS, SENTIMENTS } from '../domain/enums';

/**
 * Structured AI output contracts (docs/19-AI-OUTPUT-SCHEMAS.md).
 * Every gateway call validates the model response against one of these before
 * anything is persisted. A schema failure is a provider failure, not data.
 */

export const AI_SCHEMA_VERSION = '1.0.0';

const confidence = z.number().min(0).max(1);
const evidenceIds = z.array(z.string().min(1)).max(20).default([]);

export const groundedClaimSchema = z.object({
  statement: z.string().min(3).max(400),
  evidence_ids: evidenceIds,
  confidence,
});
export type GroundedClaim = z.infer<typeof groundedClaimSchema>;

export const businessAnalysisSchema = z.object({
  summary: z.string().min(10).max(1_200),
  strengths: z.array(z.string().min(3).max(300)).max(8).default([]),
  pain_points: z.array(groundedClaimSchema).max(8).default([]),
  opportunities: z.array(groundedClaimSchema).max(8).default([]),
  recommended_angle: z.string().min(10).max(600),
  objections: z.array(z.string().min(3).max(300)).max(6).default([]),
  unknowns: z.array(z.string().min(3).max(300)).max(8).default([]),
  confidence,
});
export type BusinessAnalysis = z.infer<typeof businessAnalysisSchema>;

export const leadScoreSchema = z.object({
  total: z.number().min(0).max(100),
  dimensions: z.object({
    fit: z.number().min(0).max(100),
    opportunity: z.number().min(0).max(100),
    contactability: z.number().min(0).max(100),
    maturity: z.number().min(0).max(100),
    confidence: z.number().min(0).max(100),
    urgency: z.number().min(0).max(100),
  }),
  explanation: z.array(z.string().min(3).max(300)).min(1).max(12),
});
export type LeadScoreOutput = z.infer<typeof leadScoreSchema>;

export const generatedMessageSchema = z.object({
  channel: z.enum(CHANNELS),
  subject: z.string().max(200).optional(),
  body: z.string().min(20).max(4_000),
  angle: z.string().min(3).max(300),
  cta: z.string().min(3).max(300),
  /** Facts the message asserts; the validator checks each against evidence. */
  validation_targets: z.array(z.string().min(3).max(300)).max(10).default([]),
});
export type GeneratedMessage = z.infer<typeof generatedMessageSchema>;

export const messageValidationSchema = z.object({
  factually_grounded: z.boolean(),
  issues: z
    .array(
      z.object({
        severity: z.enum(['error', 'warning']),
        code: z.string().min(2).max(60),
        detail: z.string().min(3).max(400),
      }),
    )
    .max(20)
    .default([]),
  suggested_fix: z.string().max(2_000).optional(),
});
export type MessageValidationOutput = z.infer<typeof messageValidationSchema>;

export const businessClassificationSchema = z.object({
  category: z.string().min(2).max(120),
  subcategory: z.string().max(120).optional(),
  is_chain: z.boolean(),
  b2c_or_b2b: z.enum(['b2c', 'b2b', 'both', 'unknown']),
  confidence,
});
export type BusinessClassification = z.infer<typeof businessClassificationSchema>;

export const replyClassificationSchema = z.object({
  intent: z.enum(REPLY_INTENTS),
  sentiment: z.enum(SENTIMENTS),
  objection: z.string().max(300).optional(),
  requires_human: z.boolean(),
  summary: z.string().min(3).max(600),
  next_action: z.string().min(3).max(300),
  confidence,
});
export type ReplyClassification = z.infer<typeof replyClassificationSchema>;

export const conversationSummarySchema = z.object({
  summary: z.string().min(10).max(1_500),
  open_questions: z.array(z.string().min(3).max(300)).max(8).default([]),
  agreed_next_step: z.string().max(300).optional(),
  stage: z.enum(['new', 'engaged', 'qualifying', 'scheduling', 'closed']),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

/** Registry mapping each AI task to its output schema. */
export const AI_OUTPUT_SCHEMAS = {
  classify_business: businessClassificationSchema,
  analyze_business: businessAnalysisSchema,
  score_lead: leadScoreSchema,
  generate_message: generatedMessageSchema,
  validate_message: messageValidationSchema,
  classify_reply: replyClassificationSchema,
  summarize_conversation: conversationSummarySchema,
} as const;

export type AiOutputSchemas = typeof AI_OUTPUT_SCHEMAS;
export type AiTaskName = keyof AiOutputSchemas;
export type AiOutputOf<T extends AiTaskName> = z.infer<AiOutputSchemas[T]>;
