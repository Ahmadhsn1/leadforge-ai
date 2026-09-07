import { Injectable } from '@nestjs/common';
import { AppError, HUMAN_TAKEOVER_INTENTS, Channel, ConversationStatus } from '@leadforge/shared';
import { PrismaService } from '@/common/prisma.service';
import { EvidenceService } from '@/common/evidence.service';
import { AiService } from '@/ai/ai.service';
import { IntelligenceService } from '@/intelligence/intelligence.service';
import { SequenceService } from '@/outreach/sequence.service';
import { SuppressionService } from '@/outreach/suppression.service';
import { OutreachService } from '@/outreach/outreach.service';
import { logger } from '@/common/logger';

/**
 * Conversations and the AI sales copilot (docs/26).
 *
 * The copilot classifies an inbound reply, summarises the thread and drafts a
 * response — but the draft goes into the rep's composer, never onto the wire.
 * Certain intents (opt-out, objection, not interested) are flagged for human
 * handling and no suggestion is offered at all.
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: EvidenceService,
    private readonly ai: AiService,
    private readonly intelligence: IntelligenceService,
    private readonly sequences: SequenceService,
    private readonly suppression: SuppressionService,
    private readonly outreach: OutreachService,
  ) {}

  /**
   * Records an inbound message and applies its consequences: the lead becomes
   * "replied", follow-ups stop, and the reply is queued for classification.
   */
  async recordInbound(input: {
    organizationId: string;
    leadId: string;
    channel: Channel;
    body: string;
    provider: string;
    providerMessageId: string;
    externalThreadId: string;
    receivedAt: Date;
  }): Promise<{ conversationId: string; messageId: string; isNew: boolean }> {
    // The provider message ID is the idempotency key: webhooks are re-delivered.
    const existing = await this.prisma.message.findFirst({
      where: { provider: input.provider, providerMessageId: input.providerMessageId },
    });
    if (existing) {
      return { conversationId: existing.conversationId, messageId: existing.id, isNew: false };
    }

    const conversation = await this.findOrCreateConversation(
      input.organizationId,
      input.leadId,
      input.channel,
      input.externalThreadId,
    );

    const message = await this.prisma.message.create({
      data: {
        organizationId: input.organizationId,
        conversationId: conversation.id,
        direction: 'inbound',
        body: input.body,
        provider: input.provider,
        providerMessageId: input.providerMessageId,
        receivedAt: input.receivedAt,
      },
    });

    await this.prisma.$transaction([
      this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          status: 'open',
          lastMessageAt: input.receivedAt,
          firstRepliedAt: conversation.firstRepliedAt ?? input.receivedAt,
        },
      }),
      this.prisma.lead.update({
        where: { id: input.leadId },
        data: { status: 'replied', lastRepliedAt: input.receivedAt },
      }),
      this.prisma.activity.create({
        data: {
          organizationId: input.organizationId,
          leadId: input.leadId,
          conversationId: conversation.id,
          type: 'replied',
          summary: `Reply received on ${input.channel}.`,
          actor: 'provider',
        },
      }),
    ]);

    // A reply always stops the sequence, before any classification runs.
    await this.sequences.stopForLead(input.organizationId, input.leadId, 'replied');

    // Mark the draft that prompted this reply.
    await this.prisma.messageDraft.updateMany({
      where: { conversationId: conversation.id, status: { in: ['sent', 'delivered'] } },
      data: { status: 'replied', repliedAt: input.receivedAt },
    });

    logger('conversations').info(
      { leadId: input.leadId, conversationId: conversation.id, channel: input.channel },
      'inbound reply recorded',
    );

    return { conversationId: conversation.id, messageId: message.id, isNew: true };
  }

  /**
   * Classifies the latest inbound message and stores the verdict.
   * Runs in the worker so a slow model never delays webhook acknowledgement.
   */
  async classifyReply(
    organizationId: string,
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    if (!this.ai.isConfigured()) return;

    const conversation = await this.prisma.conversation.findFirstOrThrow({
      where: { id: conversationId, organizationId },
      include: {
        lead: {
          include: {
            socialProfiles: true,
            campaignLinks: { include: { campaign: true }, take: 1 },
          },
        },
        messages: { orderBy: { createdAt: 'asc' }, take: 40 },
      },
    });

    const message = conversation.messages.find((item) => item.id === messageId);
    if (!message) return;

    const aiSettings = (conversation.lead.campaignLinks[0]?.campaign?.aiSettings ?? {}) as {
      offer?: string;
    };

    const response = await this.ai.run(
      'classify_reply',
      {
        business: this.intelligence.toBusinessFacts(conversation.lead),
        incomingMessage: message.body,
        history: conversation.messages
          .filter((item) => item.id !== messageId)
          .map((item) => ({ direction: item.direction, body: item.body })),
        offer: aiSettings.offer ?? 'General business services.',
      },
      { organizationId, leadId: conversation.leadId },
      { tier: 'economy', latencyPreference: 'fast' },
    );

    const classification = response.result;
    const needsHuman =
      classification.requires_human || HUMAN_TAKEOVER_INTENTS.includes(classification.intent);

    await this.prisma.$transaction([
      this.prisma.message.update({
        where: { id: messageId },
        data: {
          classification: classification as never,
          intent: classification.intent,
          sentiment: classification.sentiment,
        },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastIntent: classification.intent,
          lastSentiment: classification.sentiment,
          summary: classification.summary,
          needsHuman,
          status: needsHuman ? 'needs_human' : 'open',
        },
      }),
    ]);

    // An unsubscribe is a legal obligation, not a preference: honour it now.
    if (classification.intent === 'unsubscribe') {
      await this.honourOptOut(organizationId, conversation.leadId, conversation.channel);
    }

    // A clearly positive reply is a pipeline event worth surfacing.
    if (classification.intent === 'interest' && classification.sentiment === 'positive') {
      await this.prisma.lead.updateMany({
        where: { id: conversation.leadId, status: { in: ['contacted', 'replied'] } },
        data: { status: 'interested' },
      });
    }

    logger('conversations').info(
      { conversationId, intent: classification.intent, needsHuman },
      'reply classified',
    );
  }

  /** Generates a suggested response for the rep to review and edit. */
  async suggestResponse(
    organizationId: string,
    conversationId: string,
    options: { guidance?: string } = {},
  ) {
    if (!this.ai.isConfigured()) throw AppError.providerNotConfigured('The AI gateway');

    const conversation = await this.prisma.conversation.findFirstOrThrow({
      where: { id: conversationId, organizationId },
      include: {
        lead: {
          include: {
            socialProfiles: true,
            campaignLinks: { include: { campaign: true }, take: 1 },
          },
        },
        messages: { orderBy: { createdAt: 'asc' }, take: 40 },
      },
    });

    const lastInbound = [...conversation.messages]
      .reverse()
      .find((item) => item.direction === 'inbound');
    if (!lastInbound) {
      throw new AppError(
        'CONFLICT',
        'There is no inbound message in this conversation to respond to.',
        {
          retryable: false,
        },
      );
    }

    const aiSettings = (conversation.lead.campaignLinks[0]?.campaign?.aiSettings ?? {}) as {
      offer?: string;
    };

    const response = await this.ai.run(
      'classify_reply',
      {
        business: this.intelligence.toBusinessFacts(conversation.lead),
        incomingMessage: lastInbound.body,
        history: conversation.messages
          .filter((item) => item.id !== lastInbound.id)
          .map((item) => ({ direction: item.direction, body: item.body })),
        offer: aiSettings.offer ?? 'General business services.',
        guidance: options.guidance ?? null,
      },
      { organizationId, leadId: conversation.leadId },
      { tier: 'balanced' },
    );

    const classification = response.result;
    const needsHuman =
      classification.requires_human || HUMAN_TAKEOVER_INTENTS.includes(classification.intent);

    // Draft a reply only where a templated answer is appropriate.
    let suggestedResponse: string | null = null;
    if (!needsHuman) {
      const evidence = await this.evidence.factsForLead(conversation.leadId);
      try {
        const draft = await this.ai.run(
          'generate_message',
          {
            business: this.intelligence.toBusinessFacts(conversation.lead),
            evidence,
            angle: classification.next_action,
            channel: conversation.channel,
            kind: 'reply',
            tone: 'friendly',
            cta: classification.next_action,
            offer: aiSettings.offer ?? 'General business services.',
            maxLength: 900,
            targetLength: 400,
            styleGuidance:
              'A direct reply in an existing conversation. No reintroduction, no greeting filler.',
            refinement: options.guidance ?? null,
            previousMessages: conversation.messages.slice(-4).map((item) => item.body),
          },
          { organizationId, leadId: conversation.leadId },
          { tier: 'balanced' },
        );
        suggestedResponse = draft.result.body;
      } catch (error) {
        logger('conversations').warn(
          { err: error, conversationId },
          'reply draft generation failed',
        );
      }
    }

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastIntent: classification.intent,
        lastSentiment: classification.sentiment,
        summary: classification.summary,
        needsHuman,
        ...(needsHuman ? { status: 'needs_human' as ConversationStatus } : {}),
      },
    });

    return {
      intent: classification.intent,
      sentiment: classification.sentiment,
      objection: classification.objection ?? null,
      requiresHuman: needsHuman,
      summary: classification.summary,
      nextAction: classification.next_action,
      confidence: classification.confidence,
      suggestedResponse,
      model: response.model,
      promptVersion: response.promptVersion,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Sends a human-written reply in an existing conversation. */
  async sendReply(
    organizationId: string,
    conversationId: string,
    body: string,
    subject: string | undefined,
    userId: string,
  ) {
    const conversation = await this.prisma.conversation.findFirstOrThrow({
      where: { id: conversationId, organizationId },
      include: { lead: true },
    });

    const suppressed = await this.suppression.checkLead(
      organizationId,
      conversation.leadId,
      conversation.channel,
    );
    if (suppressed) {
      throw new AppError('SUPPRESSED_RECIPIENT', 'This recipient is on the do-not-contact list.', {
        retryable: false,
      });
    }

    // Replies go through the same approve-and-send path as any other message,
    // so suppression, quotas and the audit trail all apply identically.
    const draft = await this.prisma.messageDraft.create({
      data: {
        organizationId,
        leadId: conversation.leadId,
        conversationId,
        channel: conversation.channel,
        kind: 'primary',
        body,
        subject: subject ?? null,
        status: 'draft',
        validationStatus: 'passed',
        validationErrors: [] as never,
      },
    });

    return this.outreach.approve(organizationId, draft.id, { userId, startSequence: false });
  }

  async updateConversation(
    organizationId: string,
    conversationId: string,
    input: {
      status?: ConversationStatus;
      assigneeId?: string | null;
      snoozedUntil?: string | null;
    },
  ) {
    const conversation = await this.prisma.conversation.findFirstOrThrow({
      where: { id: conversationId, organizationId },
    });

    return this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        ...(input.status
          ? { status: input.status, needsHuman: input.status === 'needs_human' }
          : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.snoozedUntil !== undefined
          ? { snoozedUntil: input.snoozedUntil ? new Date(input.snoozedUntil) : null }
          : {}),
      },
    });
  }

  /* ------------------------------------------------------------- helpers */

  private async findOrCreateConversation(
    organizationId: string,
    leadId: string,
    channel: Channel,
    externalThreadId: string,
  ) {
    const byExternal = await this.prisma.conversation.findFirst({
      where: { organizationId, channel, externalId: externalThreadId },
    });
    if (byExternal) return byExternal;

    const open = await this.prisma.conversation.findFirst({
      where: { organizationId, leadId, channel, status: { not: 'closed' } },
    });

    if (open) {
      // Bind the provider thread ID the first time we see it.
      if (!open.externalId) {
        return this.prisma.conversation.update({
          where: { id: open.id },
          data: { externalId: externalThreadId },
        });
      }
      return open;
    }

    return this.prisma.conversation.create({
      data: { organizationId, leadId, channel, externalId: externalThreadId, status: 'open' },
    });
  }

  /** Suppresses the contact and stops every sequence, immediately. */
  private async honourOptOut(
    organizationId: string,
    leadId: string,
    channel: Channel,
  ): Promise<void> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { socialProfiles: { where: { platform: 'instagram' }, take: 1 } },
    });
    if (!lead) return;

    const scope = this.outreach.scopeForChannel(channel);
    const value =
      scope === 'phone'
        ? lead.phoneKey
        : scope === 'email'
          ? lead.email
          : (lead.socialProfiles[0]?.username ?? null);

    if (value) {
      await this.suppression.add(organizationId, scope, value, {
        reason: 'Requested to opt out in a reply.',
        country: lead.country ?? 'GB',
      });
    } else {
      // No channel identifier to suppress; suppress the lead itself.
      await this.suppression.add(organizationId, 'lead', leadId, {
        reason: 'Requested to opt out in a reply.',
      });
    }

    logger('conversations').info({ leadId, channel }, 'opt-out honoured');
  }
}
