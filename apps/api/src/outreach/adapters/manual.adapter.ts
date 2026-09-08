import { Injectable } from '@nestjs/common';
import {
  AppError,
  normalizeEmail,
  normalizePhone,
  socialHandleFromUrl,
  type Channel,
} from '@leadforge/shared';
import type {
  ChannelAdapter,
  NormalizedEvent,
  RecipientValidation,
  SendRequest,
  SendResult,
  WebhookVerification,
} from './channel-adapter';

/**
 * Manual send — the zero-cost outreach channel.
 *
 * LeadForge does everything up to the send: research, evidence, angle, drafting
 * and validation. The user then clicks one link, their own WhatsApp / Instagram
 * / mail client opens with the message already written, and they press send.
 *
 * Why this exists, rather than being a fallback:
 *
 *   - It costs nothing. The WhatsApp Business API charges per marketing message
 *     and caps how many a person can receive; a message sent from your own
 *     WhatsApp account costs nothing.
 *   - It is the only way to cold-contact on Instagram at all. The API cannot
 *     address someone who has not messaged the business account first.
 *   - It sends from a real person's account, which is what a small business
 *     owner actually responds to.
 *
 * The trade-off is honest: it does not scale to thousands per day and there are
 * no delivery receipts. Replies come back to the user's own inbox and are
 * logged here when they record them.
 *
 * This is not automation of a consumer client. It generates a link a human
 * clicks — the same thing as typing the message by hand, minus the typing.
 */
@Injectable()
export class ManualAdapter implements ChannelAdapter {
  readonly channel: Channel = 'manual';

  /** No credentials, so it is always available. */
  isConfigured(): boolean {
    return true;
  }

  /**
   * Anything a person can be reached on counts: a phone number, an Instagram
   * handle or an email address.
   */
  validateRecipient(recipient: string | null | undefined, country = 'GB'): RecipientValidation {
    if (!recipient) {
      return {
        valid: false,
        normalized: null,
        reason: 'No phone, Instagram handle or email on record.',
      };
    }

    const phone = normalizePhone(recipient, country);
    if (phone.valid && phone.e164) return { valid: true, normalized: phone.e164 };

    const email = normalizeEmail(recipient);
    if (email) return { valid: true, normalized: email };

    const handle = recipient.startsWith('http')
      ? socialHandleFromUrl(recipient)
      : recipient.replace(/^@/, '');
    if (handle && /^[A-Za-z0-9._]{1,30}$/.test(handle)) {
      return { valid: true, normalized: `@${handle.toLowerCase()}` };
    }

    return { valid: false, normalized: null, reason: `"${recipient}" is not a usable contact.` };
  }

  /**
   * A manual send is completed by the user, not by this process.
   *
   * The outreach worker never calls this: `OutreachService` routes manual
   * drafts to `markSentManually` instead. Throwing here makes an accidental
   * automated send impossible rather than merely unlikely.
   */
  async send(_request: SendRequest): Promise<SendResult> {
    throw new AppError(
      'BAD_REQUEST',
      'A manual message is sent by a person, not by the server. Open the lead and use the send link.',
      { retryable: false },
    );
  }

  verifyWebhook(): WebhookVerification {
    return { valid: false, reason: 'The manual channel receives no webhooks.' };
  }

  parseWebhook(): NormalizedEvent[] {
    return [];
  }

  /**
   * Builds the one-click send link.
   *
   * `wa.me` is WhatsApp's own documented deep link: it opens the app (or
   * WhatsApp Web) with the recipient and message pre-filled, and the person
   * still has to press send.
   */
  buildSendLink(
    recipient: string,
    body: string,
    subject?: string | null,
  ): { url: string; kind: 'whatsapp' | 'instagram' | 'email'; instruction: string } {
    if (recipient.startsWith('@')) {
      const handle = recipient.slice(1);
      return {
        url: `https://www.instagram.com/${encodeURIComponent(handle)}/`,
        kind: 'instagram',
        // Instagram has no deep link that pre-fills a DM, so the message is
        // copied to the clipboard instead and the profile is opened.
        instruction:
          'The message is on your clipboard. Open the profile, tap Message, and paste it.',
      };
    }

    if (recipient.includes('@')) {
      const params = new URLSearchParams();
      if (subject) params.set('subject', subject);
      params.set('body', body);
      return {
        url: `mailto:${recipient}?${params.toString()}`,
        kind: 'email',
        instruction: 'Your mail client will open with the message ready. Review it, then send.',
      };
    }

    const digits = recipient.replace(/[^\d]/g, '');
    return {
      url: `https://wa.me/${digits}?text=${encodeURIComponent(body)}`,
      kind: 'whatsapp',
      instruction: 'WhatsApp will open with the message written. Read it once, then press send.',
    };
  }
}
