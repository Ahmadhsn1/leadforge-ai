import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  AppError,
  listConversationsSchema,
  paginate,
  sendConversationMessageSchema,
  skipTake,
  suggestResponseSchema,
  updateConversationSchema,
} from '@leadforge/shared';
import { zodBody, zodQuery } from '@/common/http';
import { Auth, OrgId, RequireRole } from '@/auth/auth.guard';
import { PrismaService } from '@/common/prisma.service';
import { AuditService } from '@/organizations/audit.service';
import { LeadsService } from '@/leads/leads.service';
import { ConversationsService } from './conversations.service';
import type { AuthContext } from '@/auth/auth.types';

@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly leads: LeadsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @OrgId() organizationId: string,
    @Query(zodQuery(listConversationsSchema)) query: z.infer<typeof listConversationsSchema>,
  ) {
    const where = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.needsHuman !== undefined ? { needsHuman: query.needsHuman } : {}),
      ...(query.search
        ? { lead: { canonicalName: { contains: query.search, mode: 'insensitive' as const } } }
        : {}),
    };

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        include: {
          lead: { select: { canonicalName: true } },
          assignee: { select: { name: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { messages: true } },
        },
        orderBy: [{ needsHuman: 'desc' }, { lastMessageAt: 'desc' }],
        ...skipTake(query),
      }),
      this.prisma.conversation.count({ where }),
    ]);

    const items = conversations.map((conversation) => {
      const last = conversation.messages[0];
      return {
        id: conversation.id,
        leadId: conversation.leadId,
        leadName: conversation.lead.canonicalName,
        channel: conversation.channel,
        status: conversation.status,
        needsHuman: conversation.needsHuman,
        lastIntent: conversation.lastIntent,
        lastSentiment: conversation.lastSentiment,
        summary: conversation.summary,
        assigneeName: conversation.assignee?.name ?? null,
        lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
        lastMessagePreview: last ? last.body.slice(0, 160) : null,
        // "Unread" here means an inbound message we have not classified yet.
        unreadInbound: last?.direction === 'inbound' && !last.intent ? 1 : 0,
        createdAt: conversation.createdAt.toISOString(),
      };
    });

    return paginate(items, total, query);
  }

  @Get(':id')
  async get(@OrgId() organizationId: string, @Param('id') id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, organizationId },
      include: {
        lead: {
          include: {
            websiteAnalysis: { select: { opportunitySignals: true } },
            socialProfiles: { where: { platform: 'instagram' }, select: { id: true }, take: 1 },
            drafts: {
              where: { status: { in: ['draft', 'approved'] } },
              select: { channel: true },
              take: 1,
            },
          },
        },
        assignee: { select: { name: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!conversation) throw AppError.notFound('Conversation', id);

    const lastInbound = [...conversation.messages].reverse().find((m) => m.direction === 'inbound');

    return {
      id: conversation.id,
      leadId: conversation.leadId,
      leadName: conversation.lead.canonicalName,
      channel: conversation.channel,
      status: conversation.status,
      needsHuman: conversation.needsHuman,
      lastIntent: conversation.lastIntent,
      lastSentiment: conversation.lastSentiment,
      summary: conversation.summary,
      assigneeName: conversation.assignee?.name ?? null,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      lastMessagePreview: null,
      unreadInbound: 0,
      createdAt: conversation.createdAt.toISOString(),

      lead: this.leads.serializeSummary(conversation.lead),

      messages: conversation.messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        body: message.body,
        subject: message.subject,
        intent: message.intent,
        sentiment: message.sentiment,
        provider: message.provider,
        sentAt: message.sentAt?.toISOString() ?? null,
        receivedAt: message.receivedAt?.toISOString() ?? null,
        createdAt: message.createdAt.toISOString(),
      })),

      // The stored classification, so the panel has content before the user
      // asks for a fresh suggestion.
      copilot:
        lastInbound?.classification && conversation.lastIntent
          ? {
              intent: conversation.lastIntent,
              sentiment: conversation.lastSentiment ?? 'neutral',
              objection: (lastInbound.classification as { objection?: string }).objection ?? null,
              requiresHuman: conversation.needsHuman,
              summary: conversation.summary ?? '',
              nextAction:
                (lastInbound.classification as { next_action?: string }).next_action ?? '',
              confidence: (lastInbound.classification as { confidence?: number }).confidence ?? 0.5,
              suggestedResponse: null,
              model: null,
              promptVersion: null,
              generatedAt: lastInbound.createdAt.toISOString(),
            }
          : null,
    };
  }

  @Post(':id/suggest-response')
  @RequireRole('member')
  @HttpCode(200)
  async suggest(
    @OrgId() organizationId: string,
    @Param('id') id: string,
    @Body(zodBody(suggestResponseSchema)) body: z.infer<typeof suggestResponseSchema>,
  ) {
    return this.conversations.suggestResponse(organizationId, id, { guidance: body.guidance });
  }

  @Post(':id/messages')
  @RequireRole('member')
  @HttpCode(202)
  async sendMessage(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Body(zodBody(sendConversationMessageSchema))
    body: z.infer<typeof sendConversationMessageSchema>,
  ) {
    const draft = await this.conversations.sendReply(
      auth.organization.id,
      id,
      body.body,
      body.subject,
      auth.user.id,
    );

    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'send_reply',
      resource: 'conversation',
      resourceId: id,
      metadata: { draftId: draft.id },
    });

    return { queued: true, draftId: draft.id };
  }

  @Patch(':id')
  @RequireRole('member')
  update(
    @OrgId() organizationId: string,
    @Param('id') id: string,
    @Body(zodBody(updateConversationSchema)) body: z.infer<typeof updateConversationSchema>,
  ) {
    return this.conversations.updateConversation(organizationId, id, body);
  }
}
