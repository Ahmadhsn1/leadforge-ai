import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AppError, JOB_NAMES, safeEqualOrFalse } from './webhook-utils';
import { env } from '@leadforge/config';
import { PrismaService } from '@/common/prisma.service';
import { QueueService } from '@/jobs/queue.service';
import { ConversationsService } from '@/conversations/conversations.service';
import { OutreachService } from '@/outreach/outreach.service';
import { statusForEvent } from '@/outreach/outreach.state';
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
      return this.prisma.lead.findFirst({ where: { phoneKey: e164 } });
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
