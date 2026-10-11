import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  AppError,
  PLAN_QUOTAS,
  QUOTA_FIELD_BY_METRIC,
  ROLE_RANK,
  USAGE_METRICS,
  inviteMemberSchema,
  jsonValueSchema,
  paginationSchema,
  trimmed,
  updateMemberSchema,
  Plan,
} from '@leadforge/shared';
import { newToken, sha256 } from '@leadforge/shared/server';
import { currentPeriod } from '@leadforge/database';
import type { Prisma } from '@leadforge/database';
import { zodBody, zodQuery } from '@/common/http';
import { PrismaService } from '@/common/prisma.service';
import { MailService } from '@/common/mail.service';
import { Auth, OrgId, RequireRole } from '@/auth/auth.guard';
import { AnalyticsService } from '@/analytics/analytics.service';
import { AuditService } from './audit.service';
import { logger } from '@/common/logger';
import { SESSION_COOKIE, AuthContext } from '@/auth/auth.types';

const updateOrganizationSchema = z.object({
  name: trimmed(120).optional(),
  settings: z.record(jsonValueSchema).optional(),
});

const deleteOrganizationSchema = z.object({ confirmName: z.string().min(1).max(200) });

@Controller()
export class OrganizationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  /* ------------------------------------------------------- organization */

  @Get('organizations/current')
  async current(@OrgId() organizationId: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      plan: organization.plan,
      settings: organization.settings,
      createdAt: organization.createdAt.toISOString(),
    };
  }

  @Patch('organizations/current')
  @RequireRole('admin')
  async update(
    @Auth() auth: AuthContext,
    @Body(zodBody(updateOrganizationSchema)) body: z.infer<typeof updateOrganizationSchema>,
  ) {
    // Settings are one JSON document shared by several screens. Merge rather
    // than replace, or saving the workspace form would erase the notification
    // preferences that live beside it.
    const existing = body.settings
      ? await this.prisma.organization.findUniqueOrThrow({
          where: { id: auth.organization.id },
          select: { settings: true },
        })
      : null;

    const organization = await this.prisma.organization.update({
      where: { id: auth.organization.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.settings
          ? {
              settings: {
                ...((existing?.settings as Record<string, unknown> | null) ?? {}),
                ...body.settings,
              } as never,
            }
          : {}),
      },
    });

    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'update_organization',
      resource: 'organization',
      resourceId: auth.organization.id,
      metadata: { fields: Object.keys(body) },
    });

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      plan: organization.plan,
      settings: organization.settings,
    };
  }

  /* ------------------------------------------------- export and deletion */

  /**
   * Everything the workspace holds, as one JSON document. The right to a copy
   * of your data should not depend on asking someone for it.
   */
  @Get('organizations/export')
  @RequireRole('owner')
  @Header('Content-Type', 'application/json; charset=utf-8')
  async exportData(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    const organizationId = auth.organization.id;
    const where = { organizationId };

    const [organization, campaigns, leads, notes, tasks, drafts, conversations, suppressions] =
      await Promise.all([
        this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
        this.prisma.campaign.findMany({ where }),
        this.prisma.lead.findMany({
          where,
          include: { contacts: true, socialProfiles: true, evidence: true, scores: true },
        }),
        this.prisma.note.findMany({ where }),
        this.prisma.task.findMany({ where }),
        this.prisma.messageDraft.findMany({ where }),
        this.prisma.conversation.findMany({ where, include: { messages: true } }),
        this.prisma.suppression.findMany({ where }),
      ]);

    await this.audit.record({
      organizationId,
      userId: auth.user.id,
      action: 'export_workspace',
      resource: 'organization',
      resourceId: organizationId,
      metadata: { leads: leads.length, conversations: conversations.length },
    });

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="leadforge-${organization.slug}-${new Date().toISOString().slice(0, 10)}.json"`,
    );

    return {
      exportedAt: new Date().toISOString(),
      workspace: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        plan: organization.plan,
        settings: organization.settings,
        createdAt: organization.createdAt,
      },
      campaigns,
      leads,
      notes,
      tasks,
      messageDrafts: drafts,
      conversations,
      suppressions,
    };
  }

  /**
   * Deletes the workspace and everything in it. Irreversible, so it asks for
   * the workspace name typed out, and refuses while a paid subscription is
   * live — otherwise the customer would keep being charged for nothing.
   */
  @Delete('organizations/current')
  @RequireRole('owner')
  @HttpCode(204)
  async deleteWorkspace(
    @Auth() auth: AuthContext,
    @Body(zodBody(deleteOrganizationSchema)) body: z.infer<typeof deleteOrganizationSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const organizationId = auth.organization.id;
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { subscription: true },
    });

    if (body.confirmName.trim() !== organization.name) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Type the workspace name exactly as shown to confirm.',
        { retryable: false },
      );
    }

    const subscription = organization.subscription;
    if (
      subscription?.externalSubscriptionId &&
      ['active', 'trialing', 'past_due'].includes(subscription.status) &&
      organization.plan !== 'free'
    ) {
      throw AppError.conflict(
        'Cancel the paid subscription in Settings → Billing before deleting this workspace, so you are not charged again.',
      );
    }

    const members = await this.prisma.membership.findMany({
      where: { organizationId },
      select: { userId: true },
    });

    // A large workspace cascades through a lot of rows; the default five
    // seconds is not a safe ceiling for that.
    await this.prisma.$transaction(
      (tx) =>
        this.deleteEverything(
          tx,
          organizationId,
          members.map((member) => member.userId),
        ),
      { timeout: 120_000, maxWait: 20_000 },
    );

    logger('organizations').info({ organizationId, members: members.length }, 'workspace deleted');
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  private async deleteEverything(
    tx: Prisma.TransactionClient,
    organizationId: string,
    memberUserIds: string[],
  ): Promise<void> {
    // Not cascaded by the schema: these rows carry no foreign key.
    await tx.mergeCandidate.deleteMany({ where: { organizationId } });
    await tx.organization.delete({ where: { id: organizationId } });

    // An account that belonged only to this workspace has nowhere left to
    // sign in to. Remove it rather than leave a login that leads nowhere.
    await tx.user.deleteMany({
      where: { id: { in: memberUserIds }, memberships: { none: {} } },
    });

    // Anyone who was signed in to it is signed out of it.
    await tx.session.updateMany({
      where: { activeOrganizationId: organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /* ------------------------------------------------------------ members */

  @Get('organizations/members')
  async members(@OrgId() organizationId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((membership) => ({
      id: membership.id,
      userId: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      role: membership.role,
      createdAt: membership.createdAt.toISOString(),
      lastLoginAt: membership.user.lastLoginAt?.toISOString() ?? null,
    }));
  }

  @Patch('organizations/members/:id')
  @RequireRole('admin')
  async updateMember(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Body(zodBody(updateMemberSchema)) body: z.infer<typeof updateMemberSchema>,
  ) {
    const membership = await this.prisma.membership.findFirst({
      where: { id, organizationId: auth.organization.id },
    });
    if (!membership) throw AppError.notFound('Member', id);

    // Nobody may grant a role above their own, or change someone senior.
    if (ROLE_RANK[body.role] > ROLE_RANK[auth.organization.role]) {
      throw AppError.forbidden('You cannot grant a role higher than your own.');
    }
    if (
      ROLE_RANK[membership.role] >= ROLE_RANK[auth.organization.role] &&
      membership.userId !== auth.user.id
    ) {
      throw AppError.forbidden('You cannot change the role of someone at or above your own level.');
    }

    // An organisation must always retain at least one owner.
    if (membership.role === 'owner' && body.role !== 'owner') {
      const owners = await this.prisma.membership.count({
        where: { organizationId: auth.organization.id, role: 'owner' },
      });
      if (owners <= 1) {
        throw AppError.conflict('A workspace must have at least one owner.');
      }
    }

    const updated = await this.prisma.membership.update({
      where: { id },
      data: { role: body.role },
    });

    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'update_member_role',
      resource: 'membership',
      resourceId: id,
      metadata: { from: membership.role, to: body.role },
    });

    return { id: updated.id, role: updated.role };
  }

  @Delete('organizations/members/:id')
  @RequireRole('admin')
  @HttpCode(204)
  async removeMember(@Auth() auth: AuthContext, @Param('id') id: string): Promise<void> {
    const membership = await this.prisma.membership.findFirst({
      where: { id, organizationId: auth.organization.id },
    });
    if (!membership) throw AppError.notFound('Member', id);

    if (ROLE_RANK[membership.role] >= ROLE_RANK[auth.organization.role]) {
      throw AppError.forbidden('You cannot remove someone at or above your own level.');
    }

    await this.prisma.membership.delete({ where: { id } });
    // Their sessions on this workspace are no longer valid.
    await this.prisma.session.updateMany({
      where: {
        userId: membership.userId,
        activeOrganizationId: auth.organization.id,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'remove_member',
      resource: 'membership',
      resourceId: id,
      metadata: { removedUserId: membership.userId },
    });
  }

  /* ------------------------------------------------------------ invites */

  @Get('organizations/invites')
  @RequireRole('admin')
  async invites(@OrgId() organizationId: string) {
    const invites = await this.prisma.invite.findMany({
      where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    return invites.map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
      createdAt: invite.createdAt.toISOString(),
    }));
  }

  @Post('organizations/invites')
  @RequireRole('admin')
  async invite(
    @Auth() auth: AuthContext,
    @Body(zodBody(inviteMemberSchema)) body: z.infer<typeof inviteMemberSchema>,
  ) {
    if (ROLE_RANK[body.role] > ROLE_RANK[auth.organization.role]) {
      throw AppError.forbidden('You cannot invite someone at a higher role than your own.');
    }

    const existingMember = await this.prisma.membership.findFirst({
      where: { organizationId: auth.organization.id, user: { email: body.email } },
    });
    if (existingMember)
      throw AppError.conflict('That person is already a member of this workspace.');

    const quota = PLAN_QUOTAS[auth.organization.plan as Plan];
    const memberCount = await this.prisma.membership.count({
      where: { organizationId: auth.organization.id },
    });
    if (memberCount >= quota.maxMembers) {
      throw new AppError(
        'QUOTA_EXCEEDED',
        `The ${quota.label} plan allows ${quota.maxMembers} members. Upgrade to invite more.`,
        { retryable: false },
      );
    }

    const token = newToken(32);
    const invite = await this.prisma.invite.upsert({
      where: { organizationId_email: { organizationId: auth.organization.id, email: body.email } },
      create: {
        organizationId: auth.organization.id,
        email: body.email,
        role: body.role,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      update: {
        role: body.role,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        acceptedAt: null,
      },
    });

    await this.mail.sendInvite(body.email, auth.organization.name, auth.user.name, token);

    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'invite_member',
      resource: 'invite',
      resourceId: invite.id,
      metadata: { role: body.role },
    });

    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
      createdAt: invite.createdAt.toISOString(),
    };
  }

  @Delete('organizations/invites/:id')
  @RequireRole('admin')
  @HttpCode(204)
  async revokeInvite(@Auth() auth: AuthContext, @Param('id') id: string): Promise<void> {
    await this.prisma.invite.deleteMany({ where: { id, organizationId: auth.organization.id } });
    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'revoke_invite',
      resource: 'invite',
      resourceId: id,
    });
  }

  /* ---------------------------------------------------------- audit log */

  @Get('organizations/audit-log')
  @RequireRole('admin')
  auditLog(
    @OrgId() organizationId: string,
    @Query(zodQuery(paginationSchema)) query: z.infer<typeof paginationSchema>,
  ) {
    return this.audit.list(organizationId, query);
  }

  /* -------------------------------------------------------------- usage */

  @Get('usage')
  async usage(@Auth() auth: AuthContext) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: auth.organization.id },
      select: { plan: true },
    });
    const quota = PLAN_QUOTAS[organization.plan as Plan];
    const period = currentPeriod();

    const counters = await this.prisma.usageCounter.findMany({
      where: { organizationId: auth.organization.id, period },
    });
    const byMetric = new Map(counters.map((counter) => [counter.metric, counter.value]));

    const quotas = USAGE_METRICS.map((metric) => {
      const limit = quota[QUOTA_FIELD_BY_METRIC[metric]] as number;
      const used = byMetric.get(metric) ?? 0;
      return {
        metric,
        used,
        limit,
        remaining: Math.max(0, limit - used),
        pct: limit > 0 ? Math.min(1, used / limit) : 0,
      };
    });

    const periodStart = new Date(`${period}-01T00:00:00.000Z`);
    const aiUsage = await this.analytics.aiUsage(auth.organization.id, { from: periodStart });

    return { plan: organization.plan, period, quotas, aiUsage };
  }
}
