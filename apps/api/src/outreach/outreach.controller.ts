import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  approveDraftSchema,
  cancelDraftSchema,
  createSequenceSchema,
  createSuppressionSchema,
  listOutreachQueueSchema,
  paginate,
  paginationSchema,
  skipTake,
  optionalTrimmed,
  trimmed,
} from '@leadforge/shared';
import { zodBody, zodQuery } from '@/common/http';
import { Auth, OrgId, RequireRole } from '@/auth/auth.guard';
import { PrismaService } from '@/common/prisma.service';
import { AuditService } from '@/organizations/audit.service';
import { LeadsService } from '@/leads/leads.service';
import { PersonalizationService } from '@/personalization/personalization.service';
import { OutreachService } from './outreach.service';
import { SequenceService } from './sequence.service';
import { SuppressionService } from './suppression.service';
import type { AuthContext } from '@/auth/auth.types';

const updateDraftSchema = z.object({
  body: trimmed(4_000),
  subject: optionalTrimmed(200),
});

const listSuppressionsSchema = paginationSchema.extend({ search: optionalTrimmed(320) });

@Controller('outreach')
export class OutreachController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outreach: OutreachService,
    private readonly sequences: SequenceService,
    private readonly suppression: SuppressionService,
    private readonly personalization: PersonalizationService,
    private readonly leads: LeadsService,
    private readonly audit: AuditService,
  ) {}

  /** The approval queue, filtered by status/channel/campaign. */
  @Get('queue')
  async queue(
    @OrgId() organizationId: string,
    @Query(zodQuery(listOutreachQueueSchema)) query: z.infer<typeof listOutreachQueueSchema>,
  ) {
    const where = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.search
        ? { lead: { canonicalName: { contains: query.search, mode: 'insensitive' as const } } }
        : {}),
    };

    const [drafts, total] = await Promise.all([
      this.prisma.messageDraft.findMany({
        where,
        include: {
          lead: { select: { canonicalName: true } },
          campaign: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.messageDraft.count({ where }),
    ]);

    const items = await Promise.all(
      drafts.map((draft) =>
        this.leads.serializeDraft(draft, draft.lead.canonicalName, draft.campaign?.name ?? null),
      ),
    );

    return paginate(items, total, query);
  }

  @Patch(':id')
  @RequireRole('member')
  async updateDraft(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Body(zodBody(updateDraftSchema)) body: z.infer<typeof updateDraftSchema>,
  ) {
    // Editing re-runs validation: an edit can introduce an unsupported claim.
    const draft = await this.personalization.revalidate(
      auth.organization.id,
      id,
      body.body,
      body.subject,
    );
    const lead = await this.prisma.lead.findUniqueOrThrow({
      where: { id: draft.leadId },
      select: { canonicalName: true },
    });
    return this.leads.serializeDraft(draft, lead.canonicalName, null);
  }

  @Post(':id/approve')
  @RequireRole('member')
  @HttpCode(200)
  async approve(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Body(zodBody(approveDraftSchema)) body: z.infer<typeof approveDraftSchema>,
  ) {
    const draft = await this.outreach.approve(auth.organization.id, id, {
      body: body.body,
      subject: body.subject,
      scheduledAt: body.scheduledAt,
      startSequence: body.startSequence,
      userId: auth.user.id,
    });

    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'approve_message',
      resource: 'message_draft',
      resourceId: id,
      metadata: { channel: draft.channel, scheduled: Boolean(body.scheduledAt) },
    });

    const lead = await this.prisma.lead.findUniqueOrThrow({
      where: { id: draft.leadId },
      select: { canonicalName: true },
    });
    return this.leads.serializeDraft(draft, lead.canonicalName, null);
  }

  /**
   * The one-click send link for a manual message.
   *
   * A read, not a send: it returns where to open and what to say. Nothing
   * leaves the system until the user confirms with `/send-link/confirm`.
   */
  @Get(':id/send-link')
  @RequireRole('member')
  async sendLink(@OrgId() organizationId: string, @Param('id') id: string) {
    return this.outreach.manualSendLink(organizationId, id);
  }

  /**
   * Records that the user sent the manual message themselves.
   *
   * Audited as a send, because that is what it is — there is just no provider
   * receipt behind it, only the user's confirmation.
   */
  @Post(':id/mark-sent')
  @RequireRole('member')
  @HttpCode(200)
  async markSent(@Auth() auth: AuthContext, @Param('id') id: string) {
    const draft = await this.outreach.markSentManually(auth.organization.id, id, auth.user.id);

    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'mark_message_sent',
      resource: 'message_draft',
      resourceId: id,
      metadata: { channel: draft.channel, confirmedByUser: true },
    });

    const lead = await this.prisma.lead.findUniqueOrThrow({
      where: { id: draft.leadId },
      select: { canonicalName: true },
    });
    return this.leads.serializeDraft(draft, lead.canonicalName, null);
  }

  @Post(':id/cancel')
  @RequireRole('member')
  @HttpCode(200)
  async cancel(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Body(zodBody(cancelDraftSchema)) body: z.infer<typeof cancelDraftSchema>,
  ) {
    const draft = await this.outreach.cancel(auth.organization.id, id, body.reason, auth.user.id);
    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'cancel_message',
      resource: 'message_draft',
      resourceId: id,
      metadata: { reason: body.reason },
    });
    const lead = await this.prisma.lead.findUniqueOrThrow({
      where: { id: draft.leadId },
      select: { canonicalName: true },
    });
    return this.leads.serializeDraft(draft, lead.canonicalName, null);
  }

  /* --------------------------------------------------------- sequences */

  @Get('sequences')
  listSequences(@OrgId() organizationId: string) {
    return this.sequences.list(organizationId);
  }

  @Post('sequences')
  @RequireRole('admin')
  async createSequence(
    @Auth() auth: AuthContext,
    @Body(zodBody(createSequenceSchema)) body: z.infer<typeof createSequenceSchema>,
  ) {
    const sequence = await this.sequences.create(auth.organization.id, body);
    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'create_sequence',
      resource: 'outreach_sequence',
      resourceId: sequence.id,
      metadata: { name: sequence.name, channel: sequence.channel, steps: body.steps.length },
    });
    return sequence;
  }

  @Delete('sequences/:id')
  @RequireRole('admin')
  @HttpCode(204)
  async deleteSequence(@Auth() auth: AuthContext, @Param('id') id: string): Promise<void> {
    await this.sequences.remove(auth.organization.id, id);
    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'delete_sequence',
      resource: 'outreach_sequence',
      resourceId: id,
    });
  }

  /* ------------------------------------------------------- suppressions */

  @Get('suppressions')
  listSuppressions(
    @OrgId() organizationId: string,
    @Query(zodQuery(listSuppressionsSchema)) query: z.infer<typeof listSuppressionsSchema>,
  ) {
    return this.suppression.list(organizationId, query);
  }

  @Post('suppressions')
  @RequireRole('member')
  async createSuppression(
    @Auth() auth: AuthContext,
    @Body(zodBody(createSuppressionSchema)) body: z.infer<typeof createSuppressionSchema>,
  ) {
    const suppression = await this.suppression.add(auth.organization.id, body.scope, body.value, {
      reason: body.reason,
      createdById: auth.user.id,
    });

    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'create_suppression',
      resource: 'suppression',
      resourceId: suppression.id,
      metadata: { scope: body.scope, reason: body.reason },
    });

    return {
      id: suppression.id,
      scope: suppression.scope,
      value: suppression.value,
      reason: suppression.reason,
      createdAt: suppression.createdAt.toISOString(),
    };
  }

  @Delete('suppressions/:id')
  @RequireRole('admin')
  @HttpCode(204)
  async deleteSuppression(@Auth() auth: AuthContext, @Param('id') id: string): Promise<void> {
    await this.suppression.remove(auth.organization.id, id);
    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'delete_suppression',
      resource: 'suppression',
      resourceId: id,
    });
  }
}
