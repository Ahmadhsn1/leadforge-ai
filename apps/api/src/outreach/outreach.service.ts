import { Injectable } from '@nestjs/common';
import {
  AppError,
  CHANNEL_PROFILES,
  JOB_NAMES,
  PLAN_QUOTAS,
  socialHandleFromUrl,
  Channel,
  DraftStatus,
  Plan,
  SuppressionScope,
} from '@leadforge/shared';
import { currentPeriod } from '@leadforge/database';
import { PrismaService } from '@/common/prisma.service';
import { QueueService } from '@/jobs/queue.service';
import { SuppressionService } from './suppression.service';
import { assertTransition } from './outreach.state';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
import { InstagramAdapter } from './adapters/instagram.adapter';
import { EmailAdapter } from './adapters/email.adapter';
import { logger } from '@/common/logger';
import type { ChannelAdapter } from './adapters/channel-adapter';

/**
 * Outreach orchestration (docs/22).
 *
 * Owns approval, queueing, sending and the state machine. Channel specifics
 * live in adapters; this service only knows "validate the recipient, check
 * suppression, send, record the event".
 */

export interface ApproveOptions {
  readonly body?: string;
  readonly subject?: string;
  readonly scheduledAt?: string;
  readonly startSequence?: boolean;
  readonly userId: string;
}

@Injectable()
export class OutreachService {
  private readonly adapters: Record<Channel, ChannelAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly suppression: SuppressionService,
    whatsapp: WhatsAppAdapter,
    instagram: InstagramAdapter,
    email: EmailAdapter,
  ) {
    this.adapters = { whatsapp, instagram, email };
  }

  adapterFor(channel: Channel): ChannelAdapter {
    return this.adapters[channel];
  }

  /** The identifier a channel would actually send to, or null. */
  async resolveRecipient(
    leadId: string,
    channel: Channel,
  ): Promise<{ recipient: string | null; display: string | null; reason?: string }> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { socialProfiles: { where: { platform: 'instagram' }, take: 1 } },
    });
    if (!lead) return { recipient: null, display: null, reason: 'Lead not found.' };

    const adapter = this.adapterFor(channel);

    if (channel === 'whatsapp') {
      const validation = adapter.validateRecipient(lead.phone, lead.country ?? 'GB');
      return { recipient: validation.normalized, display: lead.phone, reason: validation.reason };
    }
    if (channel === 'email') {
      const validation = adapter.validateRecipient(lead.email);
      return { recipient: validation.normalized, display: lead.email, reason: validation.reason };
    }

    const profile = lead.socialProfiles[0];
    const handle = profile?.username ?? (profile ? socialHandleFromUrl(profile.profileUrl) : null);
    const validation = adapter.validateRecipient(handle);
    return {
      // Instagram cannot cold-start: `valid` is false until they message first.
      recipient: validation.valid ? validation.normalized : null,
      display: handle ? `@${handle}` : null,
      reason: validation.reason,
    };
  }

  /**
   * Approves a draft and queues it.
   *
   * Refuses on: a failed validation, a missing recipient, an exhausted message
   * quota, or an active suppression. Each refusal names the specific problem.
   */
  async approve(organizationId: string, draftId: string, options: ApproveOptions) {
    const draft = await this.prisma.messageDraft.findFirstOrThrow({
      where: { id: draftId, organizationId },
      include: { lead: true },
    });

    assertTransition(draft.status as DraftStatus, 'approved');

    const body = options.body?.trim() || draft.body;
    const subject = options.subject?.trim() ?? draft.subject;

    if (draft.validationStatus === 'failed') {
      throw new AppError(
        'VALIDATION_FAILED',
        'This message failed factual validation. Fix the flagged issues before approving it.',
        { retryable: false, details: draft.validationErrors },
      );
    }

    const profile = CHANNEL_PROFILES[draft.channel];
    if (body.length > profile.maxLength) {
      throw new AppError(
        'VALIDATION_FAILED',
        `The message is ${body.length} characters, over the ${profile.maxLength} limit for ${draft.channel}.`,
        { retryable: false },
      );
    }
    if (profile.supportsSubject && !subject) {
      throw new AppError(
        'VALIDATION_FAILED',
        'An email needs a subject line before it can be approved.',
        {
          retryable: false,
        },
      );
    }

    const suppressed = await this.suppression.checkLead(
      organizationId,
      draft.leadId,
      draft.channel,
    );
    if (suppressed) {
      await this.prisma.messageDraft.update({
        where: { id: draftId },
        data: { status: 'do_not_contact', failureReason: `Suppressed by ${suppressed.scope}.` },
      });
      throw new AppError(
        'SUPPRESSED_RECIPIENT',
        `This recipient is on the do-not-contact list (${suppressed.scope}). The message has been blocked.`,
        { retryable: false },
      );
    }

    const { recipient, reason } = await this.resolveRecipient(draft.leadId, draft.channel);
    if (!recipient) {
      throw new AppError(
        'VALIDATION_FAILED',
        reason ?? `This lead has no usable ${draft.channel} recipient.`,
        { retryable: false },
      );
    }

    await this.assertMessageQuota(organizationId);

    const scheduledAt = options.scheduledAt ? new Date(options.scheduledAt) : null;
    // A deterministic key so a double-click cannot send twice.
    const sendKey = this.queue.buildKey(
      'outreach.send',
      draftId,
      body.length,
      scheduledAt?.getTime() ?? 0,
    );

    const updated = await this.prisma.messageDraft.update({
      where: { id: draftId },
      data: {
        body,
        subject,
        status: 'approved',
        approvedAt: new Date(),
        approvedById: options.userId,
        scheduledAt,
        sendIdempotencyKey: sendKey,
        failureReason: null,
      },
    });

    const delayMs = scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : 0;

    await this.queue.enqueue(
      'outreach',
      JOB_NAMES.sendOutreach,
      {
        organizationId,
        idempotencyKey: sendKey,
        inputVersion: 1,
        draftId,
        leadId: draft.leadId,
        campaignId: draft.campaignId ?? undefined,
        channel: draft.channel,
        scheduledAt: scheduledAt?.toISOString(),
        startSequence: options.startSequence ?? true,
      },
      { delayMs },
    );

    await this.prisma.$transaction([
      this.prisma.messageDraft.update({ where: { id: draftId }, data: { status: 'queued' } }),
      this.prisma.activity.create({
        data: {
          organizationId,
          leadId: draft.leadId,
          campaignId: draft.campaignId ?? null,
          type: 'message_approved',
          summary: scheduledAt
            ? `${draft.channel} message approved and scheduled for ${scheduledAt.toISOString()}.`
            : `${draft.channel} message approved and queued for sending.`,
          actor: 'user',
          actorUserId: options.userId,
        },
      }),
      this.prisma.outreachEvent.create({
        data: {
          organizationId,
          draftId,
          leadId: draft.leadId,
          channel: draft.channel,
          type: 'queued',
          provider: draft.channel,
          payload: { scheduledAt: scheduledAt?.toISOString() ?? null } as never,
        },
      }),
    ]);

    logger('outreach').info(
      { draftId, channel: draft.channel, delayMs },
      'draft approved and queued',
    );

    return { ...updated, status: 'queued' as DraftStatus };
  }

  /** Cancels a draft that has not been sent. */
  async cancel(
    organizationId: string,
    draftId: string,
    reason: string | undefined,
    userId: string,
  ) {
    const draft = await this.prisma.messageDraft.findFirstOrThrow({
      where: { id: draftId, organizationId },
    });

    assertTransition(draft.status as DraftStatus, 'cancelled');

    const updated = await this.prisma.messageDraft.update({
      where: { id: draftId },
      data: { status: 'cancelled', failureReason: reason ?? 'Cancelled during review.' },
    });

    await this.prisma.activity.create({
      data: {
        organizationId,
        leadId: draft.leadId,
        type: 'status_changed',
        summary: `${draft.channel} draft cancelled${reason ? `: ${reason}` : '.'}`,
        actor: 'user',
        actorUserId: userId,
      },
    });

    return updated;
  }

  /**
   * Performs the actual send. Called only by the outreach worker.
   *
   * Re-checks suppression here: this is the last point before the message
   * leaves, and a suppression added while it was queued must still win.
   */
  async send(organizationId: string, draftId: string): Promise<{ providerMessageId: string }> {
    const draft = await this.prisma.messageDraft.findFirstOrThrow({
      where: { id: draftId, organizationId },
      include: { lead: true },
    });

    if (draft.status === 'sent' || draft.status === 'delivered') {
      // A retried job for an already-sent message is a no-op, not a resend.
      logger('outreach').info({ draftId }, 'send skipped: already sent');
      return { providerMessageId: draft.providerMessageId ?? '' };
    }

    if (draft.status !== 'queued' && draft.status !== 'approved') {
      throw AppError.invalidTransition(draft.status, 'sent');
    }

    const suppressed = await this.suppression.checkLead(
      organizationId,
      draft.leadId,
      draft.channel,
    );
    if (suppressed) {
      await this.prisma.messageDraft.update({
        where: { id: draftId },
        data: {
          status: 'do_not_contact',
          failureReason: `Suppressed by ${suppressed.scope} before sending.`,
        },
      });
      throw new AppError(
        'SUPPRESSED_RECIPIENT',
        'The recipient was suppressed before this message was sent.',
        {
          retryable: false,
        },
      );
    }

    const adapter = this.adapterFor(draft.channel);
    if (!adapter.isConfigured()) {
      throw AppError.providerNotConfigured(`The ${draft.channel} channel`);
    }

    const { recipient } = await this.resolveRecipient(draft.leadId, draft.channel);
    if (!recipient) {
      throw new AppError(
        'VALIDATION_FAILED',
        `No usable ${draft.channel} recipient for this lead.`,
        {
          retryable: false,
        },
      );
    }

    try {
      const result = await adapter.send({
        recipient,
        body: draft.body,
        subject: draft.subject,
        idempotencyKey: draft.sendIdempotencyKey ?? draftId,
        leadId: draft.leadId,
        draftId,
      });

      const sentAt = new Date();

      await this.prisma.$transaction([
        this.prisma.messageDraft.update({
          where: { id: draftId },
          data: {
            status: 'sent',
            sentAt,
            providerMessageId: result.providerMessageId,
            failureReason: null,
          },
        }),
        this.prisma.lead.update({
          where: { id: draft.leadId },
          data: {
            lastContactedAt: sentAt,
            // Only advance a lead that is still pre-contact.
            status: ['new', 'qualified', 'ready'].includes(draft.lead.status)
              ? 'contacted'
              : draft.lead.status,
          },
        }),
        this.prisma.outreachEvent.create({
          data: {
            organizationId,
            draftId,
            leadId: draft.leadId,
            channel: draft.channel,
            type: 'sent',
            provider: draft.channel,
            providerMessageId: result.providerMessageId,
            payload: (result.raw ?? {}) as never,
            occurredAt: sentAt,
          },
        }),
        this.prisma.activity.create({
          data: {
            organizationId,
            leadId: draft.leadId,
            campaignId: draft.campaignId ?? null,
            type: 'sent',
            summary: `${draft.channel} message sent.`,
            actor: 'system',
            metadata: { providerMessageId: result.providerMessageId },
          },
        }),
      ]);

      await this.incrementMessageCounter(organizationId);
      await this.ensureConversation(
        organizationId,
        draft.leadId,
        draft.channel,
        draftId,
        draft.body,
        sentAt,
      );

      logger('outreach').info({ draftId, channel: draft.channel }, 'message sent');
      return { providerMessageId: result.providerMessageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown send failure';
      const retryable = error instanceof AppError ? error.retryable : true;

      await this.prisma.messageDraft.update({
        where: { id: draftId },
        // A retryable failure keeps the draft queued so the worker can try again.
        data: retryable
          ? { failureReason: message }
          : { status: 'failed', failedAt: new Date(), failureReason: message },
      });

      await this.prisma.outreachEvent.create({
        data: {
          organizationId,
          draftId,
          leadId: draft.leadId,
          channel: draft.channel,
          type: 'failed',
          provider: draft.channel,
          payload: { error: message, retryable } as never,
        },
      });

      throw error;
    }
  }

  /** Opens or reuses the conversation an outbound message belongs to. */
  async ensureConversation(
    organizationId: string,
    leadId: string,
    channel: Channel,
    draftId: string,
    body: string,
    sentAt: Date,
  ): Promise<string> {
    const existing = await this.prisma.conversation.findFirst({
      where: { organizationId, leadId, channel, status: { not: 'closed' } },
    });

    const conversation =
      existing ??
      (await this.prisma.conversation.create({
        data: { organizationId, leadId, channel, status: 'awaiting_reply' },
      }));

    await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          organizationId,
          conversationId: conversation.id,
          direction: 'outbound',
          body,
          provider: channel,
          sentAt,
        },
      }),
      this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: sentAt, status: 'awaiting_reply' },
      }),
      this.prisma.messageDraft.update({
        where: { id: draftId },
        data: { conversationId: conversation.id },
      }),
    ]);

    return conversation.id;
  }

  /* --------------------------------------------------------------- quotas */

  private async assertMessageQuota(organizationId: string): Promise<void> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { plan: true },
    });
    const quota = PLAN_QUOTAS[organization.plan as Plan];

    const counter = await this.prisma.usageCounter.findUnique({
      where: {
        organizationId_metric_period: {
          organizationId,
          metric: 'messages',
          period: currentPeriod(),
        },
      },
    });

    if ((counter?.value ?? 0) >= quota.monthlyMessages) {
      throw new AppError(
        'QUOTA_EXCEEDED',
        `This workspace has used all ${quota.monthlyMessages.toLocaleString('en-GB')} messages included in the ${quota.label} plan this month.`,
        { retryable: false },
      );
    }
  }

  private async incrementMessageCounter(organizationId: string): Promise<void> {
    await this.prisma.usageCounter
      .upsert({
        where: {
          organizationId_metric_period: {
            organizationId,
            metric: 'messages',
            period: currentPeriod(),
          },
        },
        create: { organizationId, metric: 'messages', period: currentPeriod(), value: 1 },
        update: { value: { increment: 1 } },
      })
      .catch(() => undefined);
  }

  /** Scope a suppression should use for a given channel. */
  scopeForChannel(channel: Channel): SuppressionScope {
    return channel === 'whatsapp' ? 'phone' : channel === 'email' ? 'email' : 'instagram';
  }
}
