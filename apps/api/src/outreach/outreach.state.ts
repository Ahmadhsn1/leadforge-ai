import { AppError, DRAFT_TRANSITIONS, DraftStatus } from '@leadforge/shared';

/**
 * Outreach state machine (docs/22).
 *
 * Every status change goes through `assertTransition`. Having one place that
 * knows the legal moves is what stops a retried worker from resurrecting a
 * cancelled draft or sending one that was never approved.
 */

export function canTransition(from: DraftStatus, to: DraftStatus): boolean {
  if (from === to) return true;
  return DRAFT_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: DraftStatus, to: DraftStatus): void {
  if (!canTransition(from, to)) {
    throw AppError.invalidTransition(from, to);
  }
}

/** Statuses from which a draft can still be edited by a human. */
export function isEditable(status: DraftStatus): boolean {
  return status === 'draft' || status === 'approved' || status === 'follow_up_due';
}

/** Statuses that count as "the message reached them". */
export function isDelivered(status: DraftStatus): boolean {
  return status === 'sent' || status === 'delivered' || status === 'replied' || status === 'closed';
}

/** Terminal statuses: nothing further will happen without human action. */
export function isTerminal(status: DraftStatus): boolean {
  return DRAFT_TRANSITIONS[status].length === 0;
}

/** Maps a normalised provider event onto the status it implies. */
export function statusForEvent(
  event: 'sent' | 'delivered' | 'read' | 'failed' | 'replied',
): DraftStatus | null {
  switch (event) {
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'failed':
      return 'failed';
    case 'replied':
      return 'replied';
    // A read receipt is useful telemetry but does not change the draft state.
    case 'read':
      return null;
    default:
      return null;
  }
}
