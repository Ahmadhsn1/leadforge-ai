/**
 * Domain vocabularies. These mirror the Prisma enums exactly; the duplication
 * is deliberate so that web/worker code can depend on the vocabulary without
 * pulling in the Prisma client.
 */

export const ORG_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Ordered least -> most privileged. Used by the role guard. */
export const ROLE_RANK: Readonly<Record<OrgRole, number>> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export const CAMPAIGN_STATUSES = [
  'draft',
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'archived',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const RUN_STATUSES = [
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_STAGES = [
  'discovery',
  'normalization',
  'verification',
  'enrichment',
  'intelligence',
  'scoring',
  'personalization',
  'done',
] as const;
export type RunStage = (typeof RUN_STAGES)[number];

export const LEAD_STATUSES = [
  'new',
  'qualified',
  'ready',
  'contacted',
  'replied',
  'interested',
  'meeting',
  'won',
  'lost',
  'do_not_contact',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const VERIFICATION_STATUSES = [
  'pending',
  'verified',
  'probable',
  'needs_review',
  'rejected',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const TEMPERATURES = ['hot', 'warm', 'moderate', 'low', 'unscored'] as const;
export type Temperature = (typeof TEMPERATURES)[number];

/**
 * Outreach channels.
 *
 * `manual` is the zero-cost path: LeadForge prepares and validates the message
 * and hands the user a one-click link (wa.me, an Instagram profile, a mailto),
 * and the user sends it from their own account. It needs no provider, costs
 * nothing, and is the only way to cold-contact on Instagram at all.
 */
export const CHANNELS = ['whatsapp', 'instagram', 'email', 'manual'] as const;
export type Channel = (typeof CHANNELS)[number];

export const DRAFT_KINDS = [
  'primary',
  'short',
  'alternative',
  'follow_up_1',
  'follow_up_2',
  'final',
] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const DRAFT_STATUSES = [
  'draft',
  'approved',
  'queued',
  'sent',
  'delivered',
  'replied',
  'follow_up_due',
  'closed',
  'failed',
  'blocked',
  'do_not_contact',
  'cancelled',
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/**
 * Allowed transitions for the outreach state machine (docs/22).
 * Anything not listed here is rejected by the outreach state machine.
 */
export const DRAFT_TRANSITIONS: Readonly<Record<DraftStatus, readonly DraftStatus[]>> = {
  draft: ['approved', 'blocked', 'do_not_contact', 'cancelled'],
  approved: ['queued', 'draft', 'blocked', 'do_not_contact', 'cancelled'],
  queued: ['sent', 'failed', 'blocked', 'do_not_contact', 'cancelled'],
  sent: ['delivered', 'replied', 'failed', 'follow_up_due', 'closed'],
  delivered: ['replied', 'follow_up_due', 'closed', 'failed'],
  replied: ['closed', 'follow_up_due'],
  follow_up_due: ['queued', 'closed', 'do_not_contact', 'cancelled'],
  closed: [],
  failed: ['queued', 'cancelled'],
  blocked: ['cancelled'],
  do_not_contact: [],
  cancelled: [],
};

export const VALIDATION_STATUSES = ['pending', 'passed', 'warned', 'failed'] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export const EVIDENCE_TYPES = [
  'source_record',
  'website',
  'social',
  'contact',
  'rating',
  'category',
  'geography',
  'verification',
  'derived',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const WEBSITE_STATUSES = ['none', 'active', 'broken', 'uncertain'] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

export const SOCIAL_PLATFORMS = [
  'instagram',
  'facebook',
  'linkedin',
  'x',
  'tiktok',
  'youtube',
  'other',
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const CONVERSATION_STATUSES = [
  'open',
  'awaiting_reply',
  'needs_human',
  'snoozed',
  'closed',
] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_DIRECTIONS = ['outbound', 'inbound'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const REPLY_INTENTS = [
  'pricing',
  'availability',
  'interest',
  'not_interested',
  'question',
  'objection',
  'unsubscribe',
  'unknown',
] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

/** Intents that must never be auto-handled; they flag the thread for a human. */
export const HUMAN_TAKEOVER_INTENTS: readonly ReplyIntent[] = [
  'unsubscribe',
  'objection',
  'not_interested',
];

export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const JOB_STATUSES = ['queued', 'active', 'completed', 'failed', 'dead_letter'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const SUPPRESSION_SCOPES = ['phone', 'email', 'domain', 'instagram', 'lead'] as const;
export type SuppressionScope = (typeof SUPPRESSION_SCOPES)[number];

export const ACTIVITY_TYPES = [
  'discovered',
  'normalized',
  'verified',
  'enriched',
  'analyzed',
  'scored',
  'message_generated',
  'message_approved',
  'queued',
  'sent',
  'delivered',
  'replied',
  'follow_up_due',
  'meeting',
  'won',
  'lost',
  'status_changed',
  'note_added',
  'tag_added',
  'tag_removed',
  'task_created',
  'task_completed',
  'suppressed',
  'error',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const AI_TASKS = [
  'classify_business',
  'analyze_business',
  'score_lead',
  'generate_message',
  'validate_message',
  'classify_reply',
  'summarize_conversation',
] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const PLANS = ['free', 'starter', 'growth', 'agency'] as const;
export type Plan = (typeof PLANS)[number];
