import type { ActivityType } from '../domain/enums';

/**
 * Activity timeline entries (docs/27-CRM-AND-ACTIVITY.md).
 * Every meaningful state change writes one of these so a lead's history is
 * reconstructable without reading worker logs.
 */
export interface ActivityInput {
  readonly organizationId: string;
  readonly leadId?: string;
  readonly campaignId?: string;
  readonly conversationId?: string;
  readonly type: ActivityType;
  readonly summary: string;
  readonly actorUserId?: string;
  /** "system" when a worker produced the event. */
  readonly actor?: 'user' | 'system' | 'provider';
  readonly metadata?: Record<string, unknown>;
}

export const ACTIVITY_LABELS: Readonly<Record<ActivityType, string>> = {
  discovered: 'Discovered',
  normalized: 'Normalised',
  verified: 'Verified',
  enriched: 'Enriched',
  analyzed: 'Analysed',
  scored: 'Scored',
  message_generated: 'Message generated',
  message_approved: 'Message approved',
  queued: 'Queued for sending',
  sent: 'Sent',
  delivered: 'Delivered',
  replied: 'Replied',
  follow_up_due: 'Follow-up due',
  meeting: 'Meeting booked',
  won: 'Won',
  lost: 'Lost',
  status_changed: 'Status changed',
  note_added: 'Note added',
  tag_added: 'Tag added',
  tag_removed: 'Tag removed',
  task_created: 'Task created',
  task_completed: 'Task completed',
  suppressed: 'Suppressed',
  error: 'Error',
};
