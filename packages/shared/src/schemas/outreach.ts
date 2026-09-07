import { z } from 'zod';
import { CHANNELS, DRAFT_STATUSES, SUPPRESSION_SCOPES } from '../domain/enums';
import { optionalTrimmed, paginationSchema, trimmed } from './common';

export const listOutreachQueueSchema = paginationSchema.extend({
  status: z.enum(DRAFT_STATUSES).optional(),
  channel: z.enum(CHANNELS).optional(),
  campaignId: z.string().optional(),
  search: optionalTrimmed(160),
});

export const approveDraftSchema = z.object({
  /** Optional edited body; when present it replaces the generated text. */
  body: optionalTrimmed(4_000),
  subject: optionalTrimmed(200),
  /** ISO timestamp; when set the send is scheduled rather than immediate. */
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  /** Start the campaign's follow-up sequence after this message sends. */
  startSequence: z.boolean().default(true),
});
export type ApproveDraftInput = z.infer<typeof approveDraftSchema>;

export const cancelDraftSchema = z.object({ reason: optionalTrimmed(300) });

export const bulkApproveSchema = z.object({
  draftIds: z.array(z.string().min(1)).min(1).max(200),
  startSequence: z.boolean().default(true),
});

export const createSuppressionSchema = z.object({
  scope: z.enum(SUPPRESSION_SCOPES),
  value: trimmed(320),
  reason: optionalTrimmed(300),
});
export type CreateSuppressionInput = z.infer<typeof createSuppressionSchema>;

export const sequenceStepSchema = z.object({
  order: z.number().int().min(1).max(10),
  kind: z.enum(['primary', 'follow_up_1', 'follow_up_2', 'final']),
  /** Delay from the previous step, in hours. */
  delayHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  /** Optional per-step instruction appended to the generation prompt. */
  guidance: optionalTrimmed(500),
});

export const createSequenceSchema = z.object({
  name: trimmed(160),
  channel: z.enum(CHANNELS),
  description: optionalTrimmed(500),
  steps: z.array(sequenceStepSchema).min(1).max(10),
  stopOnReply: z.boolean().default(true),
  stopOnPositive: z.boolean().default(true),
  active: z.boolean().default(true),
});
export type CreateSequenceInput = z.infer<typeof createSequenceSchema>;

export const updateSequenceSchema = createSequenceSchema.partial();

/** Default sequence from docs/25-FOLLOWUP-SEQUENCES.md. */
export const DEFAULT_SEQUENCE_STEPS = [
  { order: 1, kind: 'primary' as const, delayHours: 0, guidance: undefined },
  {
    order: 2,
    kind: 'follow_up_1' as const,
    delayHours: 72,
    guidance: 'Brief nudge referencing the first message.',
  },
  {
    order: 3,
    kind: 'follow_up_2' as const,
    delayHours: 96,
    guidance: 'Add one concrete piece of value or proof.',
  },
  {
    order: 4,
    kind: 'final' as const,
    delayHours: 120,
    guidance: 'Polite close-out; make it easy to say no.',
  },
];

export const listConversationsSchema = paginationSchema.extend({
  status: z.enum(['open', 'awaiting_reply', 'needs_human', 'snoozed', 'closed']).optional(),
  channel: z.enum(CHANNELS).optional(),
  needsHuman: z.coerce.boolean().optional(),
  search: optionalTrimmed(160),
});

export const suggestResponseSchema = z.object({
  /** Extra instruction from the rep, e.g. "offer a call on Thursday". */
  guidance: optionalTrimmed(500),
  force: z.boolean().default(false),
});

export const sendConversationMessageSchema = z.object({
  body: trimmed(4_000),
  subject: optionalTrimmed(200),
});

export const updateConversationSchema = z.object({
  status: z.enum(['open', 'awaiting_reply', 'needs_human', 'snoozed', 'closed']).optional(),
  assigneeId: z.string().nullable().optional(),
  snoozedUntil: z.string().datetime({ offset: true }).nullable().optional(),
});
