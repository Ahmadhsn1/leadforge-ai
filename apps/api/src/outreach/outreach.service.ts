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
import { ManualAdapter } from './adapters/manual.adapter';
import { SequenceService } from './sequence.service';
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
    private readonly manual: ManualAdapter,
    private readonly sequences: SequenceService,
  ) {
    this.adapters = { whatsapp, instagram, email, manual };
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

    if (channel === 'manual') {
      // A manual send can go anywhere the user can reach them. Phone first: a
      // WhatsApp message from a real person gets read, and wa.me pre-fills the
      // text, so it needs the fewest steps from the user.
      for (const value of [lead.phone, handle, lead.email]) {
        if (!value) continue;
        const attempt = adapter.validateRecipient(value, lead.country ?? 'GB');
        if (attempt.valid) return { recipient: attempt.normalized, display: value };
      }
      return {
        recipient: null,
        display: null,
        reason: 'This lead has no phone, Instagram handle or email to send to.',
      };
    }

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

    // A manual message has no queue to join: the user sends it themselves. It
    // stops at `approved`, the send link becomes available, and `markSentManually`
    // records the send when they confirm they pressed send.
    if (draft.channel === 'manual') {
      await this.prisma.$transaction([
        this.prisma.activity.create({
          data: {
            organizationId,
            leadId: draft.leadId,
            campaignId: draft.campaignId ?? null,
            type: 'message_approved',
            summary: 'Manual message approved and ready to send.',
            actor: 'user',
            actorUserId: options.userId,
          },
        }),
      ]);

      logger('outreach').info({ draftId }, 'manual draft approved and awaiting the user');
      return updated;
    }

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

  /**
   * The one-click link for a manual send.
   *
   * Returns the URL to open plus the exact text, because Instagram has no way
   * to pre-fill a DM and the UI has to put the body on the clipboard instead.
   */
  async manualSendLink(organizationId: string, draftId: string) {
    const draft = await this.prisma.messageDraft.findFirstOrThrow({
      where: { id: draftId, organizationId },
    });

    if (draft.channel !== 'manual') {
      throw new AppError('BAD_REQUEST', `A ${draft.channel} message is sent by its provider.`, {
        retryable: false,
      });
    }
    if (draft.status !== 'approved' && draft.status !== 'sent') {
      throw new AppError('BAD_REQUEST', 'Approve the message before sending it.', {
        retryable: false,
      });
    }

    // Suppression is re-checked here, not only at approval: this is the last
    // point before a human is handed something to send.
    const suppressed = await this.suppression.checkLead(organizationId, draft.leadId, 'manual');
    if (suppressed) {
      throw new AppError(
        'SUPPRESSED_RECIPIENT',
        `This recipient is on the do-not-contact list (${suppressed.scope}).`,
        { retryable: false },
      );
    }

    const { recipient, display } = await this.resolveRecipient(draft.leadId, 'manual');
    if (!recipient) {
      throw new AppError('VALIDATION_FAILED', 'This lead has no usable contact.', {
        retryable: false,
      });
    }

    const link = this.manual.buildSendLink(recipient, draft.body, draft.subject);
    return {
      draftId,
      recipient: display ?? recipient,
      body: draft.body,
      subject: draft.subject,
      ...link,
      alreadySent: draft.status === 'sent',
    };
  }

  /**
   * Records that the user sent a manual message from their own account.
   *
   * There is no provider to confirm delivery, so this is the user's word — and
   * it is recorded as exactly that. It drives the same state machine as an
   * automated send so follow-ups, the conversation thread and analytics all
   * behave identically from here on.
   */
  async markSentManually(organizationId: string, draftId: string, userId: string) {
    const draft = await this.prisma.messageDraft.findFirstOrThrow({
      where: { id: draftId, organizationId },
    });

    if (draft.channel !== 'manual') {
      throw new AppError('BAD_REQUEST', `A ${draft.channel} message reports its own send.`, {
        retryable: false,
      });
    }
    if (draft.status === 'sent') {
      // Clicking "I sent it" twice is not two messages.
      return draft;
    }

    // The draft really does pass through both states; asserting each keeps the
    // manual path under the same rules as every other channel.
    assertTransition(draft.status as DraftStatus, 'queued');
    assertTransition('queued', 'sent');

    const { recipient, display } = await this.resolveRecipient(draft.leadId, 'manual');
    const sentAt = new Date();

    const updated = await this.prisma.messageDraft.update({
      where: { id: draftId },
      data: {
        status: 'sent',
        sentAt,
        // No provider issued an ID, so the draft is its own reference rather
        // than a fabricated one that looks like a provider receipt.
        providerMessageId: `manual:${draftId}`,
        failureReason: null,
      },
    });

    // The same conversation thread an automated send would have opened, so
    // replies the user forwards in land where the rest of the product expects.
    await this.ensureConversation(
      organizationId,
      draft.leadId,
      'manual',
      draftId,
      draft.body,
      sentAt,
    );

    await this.prisma.$transaction([
      this.prisma.outreachEvent.create({
        data: {
          organizationId,
          draftId,
          leadId: draft.leadId,
          channel: 'manual',
          type: 'sent',
          provider: 'manual',
          payload: { confirmedBy: userId, recipient: display ?? recipient } as never,
        },
      }),
      this.prisma.activity.create({
        data: {
          organizationId,
          leadId: draft.leadId,
          campaignId: draft.campaignId ?? null,
          type: 'sent',
          summary: `Sent manually to ${display ?? recipient ?? 'the lead'}.`,
          actor: 'user',
          actorUserId: userId,
        },
      }),
      this.prisma.lead.update({
        where: { id: draft.leadId },
        data: { status: 'contacted', lastContactedAt: sentAt },
      }),
    ]);

    await this.incrementMessageCounter(organizationId);

    // Follow-ups are the point of recording the send, so start the sequence.
    await this.startSequenceAfterManualSend(organizationId, draft.leadId, draftId);

    logger('outreach').info({ draftId }, 'manual send recorded');
    return updated;
  }

  /**
   * Starts the follow-up sequence after a manual first touch.
   *
   * Mirrors what the outreach worker does after an automated send, so the
   * follow-up cadence does not depend on how the first message went out.
   * Follow-ups only ever chain from a first message, never from a follow-up.
   */
  private async startSequenceAfterManualSend(
    organizationId: string,
    leadId: string,
    draftId: string,
  ): Promise<void> {
    const draft = await this.prisma.messageDraft.findUnique({
      where: { id: draftId },
      include: { campaign: { select: { sequenceId: true } } },
    });
    if (!draft || draft.kind !== 'primary') return;

    await this.sequences.start(
      organizationId,
      leadId,
      'manual',
      draft.campaign?.sequenceId ?? null,
    );
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
    if (channel === 'whatsapp') return 'phone';
    if (channel === 'email') return 'email';
    if (channel === 'instagram') return 'instagram';
    // A manual send could have gone out over any of them, so suppressing one
    // identifier would leave the others open. Suppress the lead itself.
    return 'lead';
  }
}
