import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError, normalizePhone, Channel } from '@leadforge/shared';
import { capabilities, env } from '@leadforge/config';
import { logger } from '@/common/logger';
import type {
  ChannelAdapter,
  NormalizedEvent,
  RecipientValidation,
  SendRequest,
  SendResult,
  WebhookVerification,
} from './channel-adapter';

/**
 * WhatsApp Business Platform adapter (docs/23).
 *
 * Uses the official Meta Cloud API only. There is deliberately no consumer
 * client automation, no account rotation and no attempt to work around
 * messaging limits — those are the things the product is explicitly built not
 * to do, and they would get the account banned regardless.
 *
 * Note on the 24-hour window: outside an active customer-initiated
 * conversation, Meta only permits approved template messages. Free-form sends
 * will be rejected by the provider, and that rejection is surfaced as-is
 * rather than being retried into a ban.
 */
@Injectable()
export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel: Channel = 'whatsapp';

  isConfigured(): boolean {
    return capabilities().whatsapp;
  }

  validateRecipient(recipient: string | null | undefined, country = 'GB'): RecipientValidation {
    const phone = normalizePhone(recipient, country);
    if (!phone.e164 || !phone.valid) {
      return {
        valid: false,
        normalized: null,
        reason: recipient
          ? `"${recipient}" is not a valid phone number (${phone.reason ?? 'unparseable'}).`
          : 'No phone number on record for this lead.',
      };
    }
    // Meta expects the number without the leading "+".
    return { valid: true, normalized: phone.e164.replace(/^\+/, '') };
  }

  async send(request: SendRequest): Promise<SendResult> {
    const config = env();
    if (!this.isConfigured()) throw AppError.providerNotConfigured('WhatsApp Business');

    const url = `https://graph.facebook.com/${config.META_GRAPH_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: request.recipient,
          type: 'text',
          text: { preview_url: false, body: request.body },
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new AppError('PROVIDER_UNAVAILABLE', 'Could not reach the WhatsApp Cloud API.', {
        cause: error,
        retryable: true,
      });
    }

    const payload = (await response.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { message?: string; code?: number; error_subcode?: number; type?: string };
    };

    if (!response.ok || payload.error) {
      throw this.toError(response.status, payload.error);
    }

    const providerMessageId = payload.messages?.[0]?.id;
    if (!providerMessageId) {
      throw new AppError(
        'PROVIDER_ERROR',
        'WhatsApp accepted the request but returned no message ID.',
        {
          retryable: true,
        },
      );
    }

    return { providerMessageId, status: 'sent', raw: payload as Record<string, unknown> };
  }

  /**
   * Verifies the X-Hub-Signature-256 HMAC. Without the app secret configured
   * the webhook is rejected — accepting unverified payloads would let anyone
   * inject replies into a customer's inbox.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookVerification {
    const secret = env().META_APP_SECRET;
    if (!secret) return { valid: false, reason: 'META_APP_SECRET is not configured.' };

    const header = headers['x-hub-signature-256'];
    if (!header?.startsWith('sha256=')) {
      return { valid: false, reason: 'Missing or malformed X-Hub-Signature-256 header.' };
    }

    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    const provided = header.slice('sha256='.length);

    const expectedBuffer = Buffer.from(expected, 'hex');
    const providedBuffer = Buffer.from(provided, 'hex');
    if (expectedBuffer.length !== providedBuffer.length) {
      return { valid: false, reason: 'Signature length mismatch.' };
    }

    return timingSafeEqual(expectedBuffer, providedBuffer)
      ? { valid: true }
      : { valid: false, reason: 'Signature did not match.' };
  }

  /** Flattens Meta's deeply nested webhook envelope. */
  parseWebhook(payload: unknown): NormalizedEvent[] {
    const events: NormalizedEvent[] = [];
    const body = payload as {
      entry?: {
        changes?: {
          value?: {
            messages?: {
              id?: string;
              from?: string;
              timestamp?: string;
              type?: string;
              text?: { body?: string };
            }[];
            statuses?: {
              id?: string;
              status?: string;
              timestamp?: string;
              recipient_id?: string;
              errors?: { title?: string; message?: string }[];
            }[];
          };
        }[];
      }[];
    };

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        /* Inbound replies. */
        for (const message of value.messages ?? []) {
          if (!message.id || !message.from) continue;
          const text = message.text?.body;
          // Non-text messages (images, audio) carry no body we can classify.
          if (message.type !== 'text' || !text) {
            logger('whatsapp').info({ type: message.type }, 'ignoring non-text inbound message');
            continue;
          }
          const occurredAt = this.toDate(message.timestamp);
          events.push({
            type: 'replied',
            providerMessageId: null,
            providerEventId: message.id,
            inbound: {
              from: message.from,
              body: text,
              externalThreadId: message.from,
              receivedAt: occurredAt,
            },
            occurredAt,
            raw: message as Record<string, unknown>,
          });
        }

        /* Delivery status updates. */
        for (const status of value.statuses ?? []) {
          if (!status.id || !status.status) continue;
          const type = this.mapStatus(status.status);
          if (!type) continue;
          events.push({
            type,
            providerMessageId: status.id,
            // Status IDs repeat across state changes; qualify with the state.
            providerEventId: `${status.id}:${status.status}`,
            error: status.errors?.[0]?.message ?? status.errors?.[0]?.title,
            occurredAt: this.toDate(status.timestamp),
            raw: status as Record<string, unknown>,
          });
        }
      }
    }

    return events;
  }

  private mapStatus(status: string): NormalizedEvent['type'] | null {
    switch (status) {
      case 'sent':
        return 'sent';
      case 'delivered':
        return 'delivered';
      case 'read':
        return 'read';
      case 'failed':
        return 'failed';
      default:
        return null;
    }
  }

  private toDate(timestamp: string | undefined): Date {
    // Meta sends Unix seconds as a string.
    const seconds = Number(timestamp);
    return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
  }

  private toError(
    status: number,
    error: { message?: string; code?: number } | undefined,
  ): AppError {
    const message = error?.message ?? `HTTP ${status}`;

    if (status === 401 || error?.code === 190) {
      return new AppError(
        'PROVIDER_NOT_CONFIGURED',
        `WhatsApp rejected the access token: ${message}`,
        {
          retryable: false,
        },
      );
    }
    if (status === 429 || error?.code === 4 || error?.code === 80007) {
      return new AppError('PROVIDER_RATE_LIMITED', `WhatsApp rate limit reached: ${message}`, {
        retryable: true,
        retryAfterMs: 60_000,
      });
    }
    if (error?.code === 131_047 || error?.code === 131_026) {
      // Outside the 24-hour window, or the number cannot receive messages.
      return new AppError(
        'PROVIDER_ERROR',
        `WhatsApp will not deliver this message: ${message}. Free-form messages are only permitted inside an active 24-hour conversation window; outside it, an approved template is required.`,
        { retryable: false },
      );
    }
    if (status >= 500) {
      return new AppError('PROVIDER_UNAVAILABLE', `WhatsApp is unavailable: ${message}`, {
        retryable: true,
      });
    }
    return new AppError('PROVIDER_ERROR', `WhatsApp rejected the message: ${message}`, {
      retryable: false,
    });
  }
}
