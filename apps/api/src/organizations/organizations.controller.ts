import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
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
import { zodBody, zodQuery } from '@/common/http';
import { PrismaService } from '@/common/prisma.service';
import { MailService } from '@/common/mail.service';
import { Auth, OrgId, RequireRole } from '@/auth/auth.guard';
import { AnalyticsService } from '@/analytics/analytics.service';
import { AuditService } from './audit.service';
import type { AuthContext } from '@/auth/auth.types';

const updateOrganizationSchema = z.object({
  name: trimmed(120).optional(),
  settings: z.record(jsonValueSchema).optional(),
});

@Controller()
export class OrganizationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  /* ------------------------------------------------------- organization */

  @Patch('organizations/current')
  @RequireRole('admin')
  async update(
    @Auth() auth: AuthContext,
    @Body(zodBody(updateOrganizationSchema)) body: z.infer<typeof updateOrganizationSchema>,
  ) {
    const organization = await this.prisma.organization.update({
      where: { id: auth.organization.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.settings ? { settings: body.settings as never } : {}),
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
