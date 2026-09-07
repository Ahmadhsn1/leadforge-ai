import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError, socialHandleFromUrl, Channel } from '@leadforge/shared';
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
 * Instagram messaging adapter (docs/24).
 *
 * Uses the supported Meta Messenger Platform endpoints for a connected
 * Instagram professional account. No login automation, no private-data
 * scraping, no anti-bot bypass.
 *
 * Platform reality that shapes this adapter: Instagram does not let a business
 * open a conversation with an arbitrary handle. The API addresses an
 * Instagram-scoped user ID, which only exists once that person has messaged
 * the account. So a stored handle is a draft target, not a send target, and
 * `validateRecipient` says so plainly rather than pretending a send is possible.
 */
@Injectable()
export class InstagramAdapter implements ChannelAdapter {
  readonly channel: Channel = 'instagram';

  isConfigured(): boolean {
    return capabilities().instagram;
  }

  validateRecipient(recipient: string | null | undefined): RecipientValidation {
    if (!recipient) {
      return {
        valid: false,
        normalized: null,
        reason: 'No Instagram profile on record for this lead.',
      };
    }

    // A numeric value is an Instagram-scoped user ID from a prior inbound
    // message; that is the only thing the send endpoint accepts.
    if (/^\d{5,}$/.test(recipient.trim())) {
      return { valid: true, normalized: recipient.trim() };
    }

    const handle = recipient.startsWith('http')
      ? socialHandleFromUrl(recipient)
      : recipient.replace(/^@/, '');
    if (!handle || !/^[A-Za-z0-9._]{1,30}$/.test(handle)) {
      return {
        valid: false,
        normalized: null,
        reason: `"${recipient}" is not a usable Instagram handle.`,
      };
    }

    return {
      valid: false,
      normalized: handle.toLowerCase(),
      reason:
        `Instagram does not permit a business account to start a conversation with @${handle}. ` +
        'The message can be drafted and approved, but it can only be sent after they message you first — ' +
        'at which point the conversation appears in your inbox and can be replied to.',
    };
  }

  async send(request: SendRequest): Promise<SendResult> {
    const config = env();
    if (!this.isConfigured()) throw AppError.providerNotConfigured('Instagram messaging');

    if (!/^\d{5,}$/.test(request.recipient)) {
      throw new AppError(
        'PROVIDER_ERROR',
        'Instagram sends require an Instagram-scoped user ID, which only exists once the business has received a message from that person.',
        { retryable: false },
      );
    }

    const url = `https://graph.facebook.com/${config.META_GRAPH_VERSION}/${config.INSTAGRAM_BUSINESS_ACCOUNT_ID}/messages`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: request.recipient },
          message: { text: request.body },
          messaging_type: 'RESPONSE',
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new AppError('PROVIDER_UNAVAILABLE', 'Could not reach the Instagram messaging API.', {
        cause: error,
        retryable: true,
      });
    }

    const payload = (await response.json().catch(() => ({}))) as {
      message_id?: string;
      error?: { message?: string; code?: number };
    };

    if (!response.ok || payload.error) {
      throw this.toError(response.status, payload.error);
    }

    if (!payload.message_id) {
      throw new AppError(
        'PROVIDER_ERROR',
        'Instagram accepted the request but returned no message ID.',
        {
          retryable: true,
        },
      );
    }

    return {
      providerMessageId: payload.message_id,
      status: 'sent',
      raw: payload as Record<string, unknown>,
    };
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookVerification {
    const secret = env().META_APP_SECRET;
    if (!secret) return { valid: false, reason: 'META_APP_SECRET is not configured.' };

    const header = headers['x-hub-signature-256'];
    if (!header?.startsWith('sha256=')) {
      return { valid: false, reason: 'Missing or malformed X-Hub-Signature-256 header.' };
    }

    const expected = Buffer.from(
      createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex'),
      'hex',
    );
    const provided = Buffer.from(header.slice('sha256='.length), 'hex');

    if (expected.length !== provided.length)
      return { valid: false, reason: 'Signature length mismatch.' };
    return timingSafeEqual(expected, provided)
      ? { valid: true }
      : { valid: false, reason: 'Signature did not match.' };
  }

  parseWebhook(payload: unknown): NormalizedEvent[] {
    const events: NormalizedEvent[] = [];
    const body = payload as {
      entry?: {
        id?: string;
        messaging?: {
          sender?: { id?: string };
          recipient?: { id?: string };
          timestamp?: number;
          message?: { mid?: string; text?: string; is_echo?: boolean };
          read?: { mid?: string };
        }[];
      }[];
    };

    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        const occurredAt = event.timestamp ? new Date(event.timestamp) : new Date();

        if (event.message?.mid && event.message.text) {
          // An echo is our own outbound message reflected back.
          if (event.message.is_echo) {
            events.push({
              type: 'sent',
              providerMessageId: event.message.mid,
              providerEventId: `${event.message.mid}:echo`,
              occurredAt,
              raw: event as Record<string, unknown>,
            });
            continue;
          }

          const senderId = event.sender?.id;
          if (!senderId) continue;

          events.push({
            type: 'replied',
            providerMessageId: null,
            providerEventId: event.message.mid,
            inbound: {
              from: senderId,
              body: event.message.text,
              externalThreadId: senderId,
              receivedAt: occurredAt,
            },
            occurredAt,
            raw: event as Record<string, unknown>,
          });
          continue;
        }

        if (event.read?.mid) {
          events.push({
            type: 'read',
            providerMessageId: event.read.mid,
            providerEventId: `${event.read.mid}:read`,
            occurredAt,
            raw: event as Record<string, unknown>,
          });
        }
      }
    }

    if (events.length === 0) {
      logger('instagram').debug('webhook contained no actionable events');
    }

    return events;
  }

  private toError(
    status: number,
    error: { message?: string; code?: number } | undefined,
  ): AppError {
    const message = error?.message ?? `HTTP ${status}`;

    if (status === 401 || error?.code === 190) {
      return new AppError(
        'PROVIDER_NOT_CONFIGURED',
        `Instagram rejected the access token: ${message}`,
        {
          retryable: false,
        },
      );
    }
    if (status === 429 || error?.code === 4) {
      return new AppError('PROVIDER_RATE_LIMITED', `Instagram rate limit reached: ${message}`, {
        retryable: true,
        retryAfterMs: 60_000,
      });
    }
    if (error?.code === 10 || error?.code === 551) {
      return new AppError(
        'PROVIDER_ERROR',
        `Instagram will not deliver this message: ${message}. The messaging window for this conversation has likely closed.`,
        { retryable: false },
      );
    }
    if (status >= 500) {
      return new AppError('PROVIDER_UNAVAILABLE', `Instagram is unavailable: ${message}`, {
        retryable: true,
      });
    }
    return new AppError('PROVIDER_ERROR', `Instagram rejected the message: ${message}`, {
      retryable: false,
    });
  }
}
