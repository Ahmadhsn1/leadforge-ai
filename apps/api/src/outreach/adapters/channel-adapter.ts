import type { Channel } from '@leadforge/shared';

/**
 * Channel adapter contract (docs/22-OUTREACH-ARCHITECTURE.md).
 *
 * Core outreach logic knows nothing about any provider. It validates a
 * recipient, sends, and normalises webhook events — everything provider-shaped
 * is behind this boundary.
 */

export interface RecipientValidation {
  readonly valid: boolean;
  /** The identifier the provider expects (E.164, email, IG user id). */
  readonly normalized: string | null;
  readonly reason?: string;
}

export interface SendRequest {
  readonly recipient: string;
  readonly body: string;
  readonly subject?: string | null;
  /** Deduplicates a retried send at the provider where supported. */
  readonly idempotencyKey: string;
  readonly leadId: string;
  readonly draftId: string;
}

export interface SendResult {
  readonly providerMessageId: string;
  /** Provider-reported state at accept time. */
  readonly status: 'sent' | 'queued';
  readonly raw?: Record<string, unknown>;
}

/** A provider event, flattened into the vocabulary the core understands. */
export interface NormalizedEvent {
  readonly type: 'sent' | 'delivered' | 'read' | 'failed' | 'replied';
  readonly providerMessageId: string | null;
  readonly providerEventId: string;
  /** Present on inbound replies. */
  readonly inbound?: {
    readonly from: string;
    readonly body: string;
    readonly externalThreadId: string;
    readonly receivedAt: Date;
  };
  readonly error?: string;
  readonly occurredAt: Date;
  readonly raw: Record<string, unknown>;
}

export interface WebhookVerification {
  readonly valid: boolean;
  readonly reason?: string;
}

export interface ChannelAdapter {
  readonly channel: Channel;
  isConfigured(): boolean;
  /** Checks a recipient before anything is queued. */
  validateRecipient(recipient: string | null | undefined, country?: string): RecipientValidation;
  send(request: SendRequest): Promise<SendResult>;
  /** Confirms a webhook really came from the provider. */
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookVerification;
  /** Flattens a provider payload into zero or more normalised events. */
  parseWebhook(payload: unknown): NormalizedEvent[];
}
