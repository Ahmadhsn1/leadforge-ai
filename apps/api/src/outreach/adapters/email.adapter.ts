import { Injectable } from '@nestjs/common';
import { AppError, normalizeEmail, Channel } from '@leadforge/shared';
import { capabilities } from '@leadforge/config';
import { MailService } from '@/common/mail.service';
import type {
  ChannelAdapter,
  NormalizedEvent,
  RecipientValidation,
  SendRequest,
  SendResult,
  WebhookVerification,
} from './channel-adapter';

/**
 * Email adapter (SMTP).
 *
 * Plain text only, and no tracking pixels: an invisible tracker in a cold
 * email is the fastest way to land in spam and the least defensible thing to
 * explain to a prospect. Reply detection is therefore the recipient replying
 * to the address, not a pixel firing.
 */
@Injectable()
export class EmailAdapter implements ChannelAdapter {
  readonly channel: Channel = 'email';

  constructor(private readonly mail: MailService) {}

  isConfigured(): boolean {
    return capabilities().email;
  }

  validateRecipient(recipient: string | null | undefined): RecipientValidation {
    const email = normalizeEmail(recipient);
    if (!email) {
      return {
        valid: false,
        normalized: null,
        reason: recipient
          ? `"${recipient}" is not a valid email address.`
          : 'No email address on record for this lead.',
      };
    }

    // Role addresses reach a shared inbox and rarely reach a decision-maker,
    // but they are still legitimate targets for a small business.
    return { valid: true, normalized: email };
  }

  isConfiguredFor(organizationId: string): Promise<boolean> {
    return this.mail.isConfiguredFor(organizationId);
  }

  async send(request: SendRequest): Promise<SendResult> {
    if (!(await this.isConfiguredFor(request.organizationId))) {
      throw AppError.providerNotConfigured('Email sending');
    }

    const subject = request.subject?.trim();
    if (!subject) {
      throw new AppError(
        'VALIDATION_FAILED',
        'An email draft needs a subject line before it can be sent.',
        {
          retryable: false,
        },
      );
    }

    // Every commercial email carries a way out, both as a line a person can
    // read and as the headers mail clients turn into an "Unsubscribe" button
    // (RFC 8058). Gmail and Yahoo require the latter of bulk senders.
    const unsubscribe = request.unsubscribeUrl;
    const result = await this.mail.sendForOrganization(request.organizationId, {
      to: request.recipient,
      subject,
      text: unsubscribe
        ? `${request.body}\n\n--\nNot relevant? Opt out of further emails: ${unsubscribe}`
        : request.body,
      // Unset means "reply to the sender", which the mail service fills in.
      replyTo: request.replyTo,
      headers: unsubscribe
        ? {
            'List-Unsubscribe': `<${request.unsubscribePostUrl ?? unsubscribe}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          }
        : undefined,
    });

    if (result.accepted.length === 0) {
      throw new AppError(
        'PROVIDER_ERROR',
        'The SMTP server accepted no recipients for this message.',
        {
          retryable: false,
        },
      );
    }

    return {
      providerMessageId: result.messageId,
      status: 'sent',
      raw: { accepted: result.accepted },
    };
  }

  /**
   * SMTP has no webhook. Inbound email would arrive via a separate mailbox
   * poller or an inbound-parse provider; neither is configured, so nothing is
   * accepted here rather than pretending a payload is trustworthy.
   */
  verifyWebhook(): WebhookVerification {
    return { valid: false, reason: 'The SMTP email channel does not receive webhooks.' };
  }

  parseWebhook(): NormalizedEvent[] {
    return [];
  }
}
