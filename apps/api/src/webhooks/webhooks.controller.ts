import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AppError, JOB_NAMES, safeEqualOrFalse } from './webhook-utils';
import { env } from '@leadforge/config';
import { PrismaService } from '@/common/prisma.service';
import { QueueService } from '@/jobs/queue.service';
import { ConversationsService } from '@/conversations/conversations.service';
import { OutreachService } from '@/outreach/outreach.service';
import { statusForEvent } from '@/outreach/outreach.state';
import { parseReplyAddress, stripQuotedReply } from '@/outreach/reply-address';
import { parseInboundEmail } from './inbound-email';
import { Public } from '@/auth/auth.guard';
import { logger } from '@/common/logger';
import type { NormalizedEvent } from '@/outreach/adapters/channel-adapter';
import type { Channel, DraftStatus } from '@leadforge/shared';

/**
 * Provider webhooks (docs/23, docs/29).
 *
 * Three rules, in order:
 *   1. Verify the signature. An unverified payload is discarded, not processed.
 *   2. Record the delivery, keyed by the provider's event ID, so a
 *      re-delivered webhook is a no-op.
 *   3. Acknowledge fast; do the slow work (AI classification) on a queue.
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly outreach: OutreachService,
    private readonly conversations: ConversationsService,
  ) {}

  /**
   * Meta's subscription handshake. Meta issues a GET with a challenge that must
   * be echoed back verbatim when the verify token matches.
   */
  @Public()
  @Get(':provider')
  verify(
    @Param('provider') provider: string,
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    const expected = env().META_WEBHOOK_VERIFY_TOKEN;

    if (!expected) {
      logger('webhooks').warn(
        { provider },
        'verification attempted but META_WEBHOOK_VERIFY_TOKEN is not set',
      );
      throw AppError.providerNotConfigured('Webhook verification');
    }

    if (mode !== 'subscribe' || !safeEqualOrFalse(token ?? '', expected)) {
      logger('webhooks').warn({ provider, mode }, 'webhook verification rejected');
      throw AppError.forbidden('Webhook verification failed.');
    }

    logger('webhooks').info({ provider }, 'webhook subscription verified');
    return challenge;
  }

  /**
   * Replies to outreach email, forwarded by an inbound-parse provider.
   *
   * Declared before the `:provider` route so it is matched first. The caller
   * proves itself with the shared secret (as a header, or as the password of
   * HTTP basic auth, which is how Postmark and Mailgun attach credentials).
   * Which message a reply answers comes from the signed Reply-To address it
   * was sent to — never from the From line, which is trivially forged.
   */
  @Public()
  @Post('inbound-email')
  @HttpCode(200)
  async inboundEmail(
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
    const secret = env().INBOUND_EMAIL_SECRET;
    if (!secret || !this.inboundSecretMatches(headers, secret)) {
      logger('webhooks').warn('rejected unauthenticated inbound email');
      return { received: true };
    }

    const mail = parseInboundEmail(body);
    if (!mail) return { received: true };

    const draftId = parseReplyAddress(mail.to, env().AUTH_SECRET);
    const draft = draftId
      ? await this.prisma.messageDraft.findUnique({
          where: { id: draftId },
          select: { id: true, leadId: true, organizationId: true },
        })
      : null;

    const delivery = await this.prisma.webhookDelivery
      .create({
        data: {
          provider: 'email',
          externalId: mail.messageId,
          signatureValid: true,
          organizationId: draft?.organizationId ?? null,
          // Headers and addresses only: the body is stored once, on the message.
          payload: { from: mail.from, to: mail.to, subject: mail.subject } as never,
          error: draft ? null : 'Not addressed to a known reply address.',
        },
      })
      .catch(() => null);

    // No delivery row means this message id was already processed.
    if (!delivery || !draft) return { received: true };

    try {
      const receivedAt = new Date();
      await this.ingestReply(
        { id: draft.leadId, organizationId: draft.organizationId },
        'email',
        'email',
        {
          type: 'replied',
          providerMessageId: null,
          providerEventId: mail.messageId,
          inbound: {
            from: mail.from,
            body: stripQuotedReply(mail.text).slice(0, 10_000),
            externalThreadId: mail.from,
            receivedAt,
          },
          occurredAt: receivedAt,
          raw: { subject: mail.subject },
        },
        delivery.id,
      );
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { processedAt: new Date() },
      });
    } catch (error) {
      logger('webhooks').error({ err: error }, 'failed to process inbound email');
    }

    return { received: true };
  }

  private inboundSecretMatches(
    headers: Record<string, string | undefined>,
    secret: string,
  ): boolean {
    const direct = headers['x-inbound-secret'];
    if (direct && safeEqualOrFalse(direct, secret)) return true;

    const authorization = headers.authorization;
    if (authorization?.startsWith('Basic ')) {
      const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
      const password = decoded.slice(decoded.indexOf(':') + 1);
      return safeEqualOrFalse(password, secret);
    }
    return false;
  }

  @Public()
  @Post(':provider')
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Req() req: Request,
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
    const channel = this.channelFor(provider);
    if (!channel) {
      logger('webhooks').warn({ provider }, 'webhook for unknown provider ignored');
      return { received: true };
    }

    const adapter = this.outreach.adapterFor(channel);
    // The raw body is captured by the verify hook in main.ts; the parsed body
    // is not byte-identical and would fail HMAC comparison.
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(body);

    const verification = adapter.verifyWebhook(rawBody, headers);
    if (!verification.valid) {
      logger('webhooks').warn(
        { provider, reason: verification.reason },
        'rejected unverified webhook',
      );
      // 200 anyway: telling an attacker their signature was wrong helps them,
      // and a non-200 makes Meta retry a payload we will never accept.
      return { received: true };
    }

    const events = adapter.parseWebhook(body);
    if (events.length === 0) return { received: true };

    for (const event of events) {
      try {
        await this.processEvent(provider, channel, event, body);
      } catch (error) {
        logger('webhooks').error(
          { err: error, provider, eventId: event.providerEventId },
          'failed to process webhook event',
        );
      }
    }

    return { received: true };
  }

  /** Applies one normalised event, idempotently. */
  private async processEvent(
    provider: string,
    channel: Channel,
    event: NormalizedEvent,
    rawPayload: unknown,
  ): Promise<void> {
    // The delivery table is the idempotency guard for the whole event.
    const delivery = await this.prisma.webhookDelivery
      .create({
        data: {
          provider,
          externalId: event.providerEventId,
          signatureValid: true,
          payload: rawPayload as never,
        },
      })
      .catch(() => null);

    if (!delivery) {
      logger('webhooks').debug(
        { provider, eventId: event.providerEventId },
        'duplicate webhook event ignored',
      );
      return;
    }

    if (event.inbound) {
      await this.handleInbound(provider, channel, event, delivery.id);
    } else if (event.providerMessageId) {
      await this.handleStatus(provider, channel, event, delivery.id);
    }

    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { processedAt: new Date() },
    });
  }

  /** An inbound reply: find the lead, record it, queue classification. */
  private async handleInbound(
    provider: string,
    channel: Channel,
    event: NormalizedEvent,
    deliveryId: string,
  ): Promise<void> {
    const inbound = event.inbound;
    if (!inbound) return;

    const lead = await this.findLeadForInbound(channel, inbound.from, inbound.externalThreadId);
    if (!lead) {
      // A message from someone we never contacted. Recorded for the operator
      // to inspect, but there is no lead to attach it to.
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: { error: `No lead matches inbound sender "${inbound.from}".` },
      });
      logger('webhooks').warn(
        { channel, from: inbound.from },
        'inbound message from an unknown sender',
      );
      return;
    }

    await this.ingestReply(lead, provider, channel, event, deliveryId);
  }

  /** Records a reply against a known lead and queues its classification. */
  private async ingestReply(
    lead: { id: string; organizationId: string },
    provider: string,
    channel: Channel,
    event: NormalizedEvent,
    deliveryId: string,
  ): Promise<void> {
    const inbound = event.inbound;
    if (!inbound) return;

    const result = await this.conversations.recordInbound({
      organizationId: lead.organizationId,
      leadId: lead.id,
      channel,
      body: inbound.body,
      provider,
      providerMessageId: event.providerEventId,
      externalThreadId: inbound.externalThreadId,
      receivedAt: inbound.receivedAt,
    });

    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { organizationId: lead.organizationId },
    });

    if (!result.isNew) return;

    await this.prisma.outreachEvent.create({
      data: {
        organizationId: lead.organizationId,
        leadId: lead.id,
        conversationId: result.conversationId,
        channel,
        type: 'replied',
        provider,
        providerEventId: event.providerEventId,
        payload: event.raw as never,
        occurredAt: event.occurredAt,
      },
    });

    // Classification is an AI call: queue it rather than holding the webhook.
    await this.queue.enqueue('outreach', JOB_NAMES.classifyReply, {
      organizationId: lead.organizationId,
      idempotencyKey: this.queue.buildKey('outreach.classify-reply', result.messageId),
      inputVersion: 1,
      leadId: lead.id,
      conversationId: result.conversationId,
      messageId: result.messageId,
    });
  }

  /** A delivery status update for a message we sent. */
  private async handleStatus(
    provider: string,
    channel: Channel,
    event: NormalizedEvent,
    deliveryId: string,
  ): Promise<void> {
    const draft = await this.prisma.messageDraft.findFirst({
      where: { providerMessageId: event.providerMessageId },
    });
    if (!draft) return;

    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { organizationId: draft.organizationId },
    });

    await this.prisma.outreachEvent.create({
      data: {
        organizationId: draft.organizationId,
        draftId: draft.id,
        leadId: draft.leadId,
        channel,
        type: event.type,
        provider,
        providerEventId: event.providerEventId,
        providerMessageId: event.providerMessageId,
        payload: event.raw as never,
        occurredAt: event.occurredAt,
      },
    });

    const nextStatus = statusForEvent(event.type);
    if (!nextStatus) return;

    // Never move a draft backwards: a late "sent" must not undo "delivered".
    const rank: Record<string, number> = {
      queued: 0,
      sent: 1,
      delivered: 2,
      replied: 3,
      closed: 4,
      failed: 1,
    };
    if ((rank[nextStatus] ?? 0) <= (rank[draft.status] ?? 0) && nextStatus !== 'failed') return;

    await this.prisma.messageDraft.update({
      where: { id: draft.id },
      data: {
        status: nextStatus as DraftStatus,
        ...(event.type === 'delivered' ? { deliveredAt: event.occurredAt } : {}),
        ...(event.type === 'failed'
          ? {
              failedAt: event.occurredAt,
              failureReason: event.error ?? 'The provider reported a delivery failure.',
            }
          : {}),
      },
    });

    if (event.type === 'failed') {
      await this.prisma.activity.create({
        data: {
          organizationId: draft.organizationId,
          leadId: draft.leadId,
          type: 'error',
          summary: `Delivery failed on ${channel}: ${event.error ?? 'no reason given'}.`,
          actor: 'provider',
        },
      });
    }
  }

  /**
   * Maps an inbound sender back to a lead. WhatsApp gives an E.164 number;
   * Instagram gives a scoped user ID that we can only match to an existing
   * conversation.
   */
  private async findLeadForInbound(channel: Channel, from: string, threadId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { channel, externalId: threadId },
      include: { lead: true },
    });
    if (conversation) return conversation.lead;

    if (channel === 'whatsapp') {
      const e164 = from.startsWith('+') ? from : `+${from}`;
      // The same business can be a lead in several workspaces. A reply belongs
      // to whoever messaged them most recently, not to whichever row the
      // database happens to return first.
      return this.prisma.lead.findFirst({
        where: { phoneKey: e164, lastContactedAt: { not: null } },
        orderBy: { lastContactedAt: 'desc' },
      });
    }

    if (channel === 'instagram') {
      // Only resolvable via an existing conversation, which we already checked.
      return null;
    }

    return null;
  }

  private channelFor(provider: string): Channel | null {
    if (provider === 'whatsapp') return 'whatsapp';
    if (provider === 'instagram') return 'instagram';
    return null;
  }
}
