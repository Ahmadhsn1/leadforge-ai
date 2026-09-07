import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AppError, OrgRole } from '@leadforge/shared';
import { newToken, sha256, safeEqual } from '@leadforge/shared/server';
import { env } from '@leadforge/config';
import { PrismaService } from '@/common/prisma.service';
import { logger } from '@/common/logger';
import type { AuthContext, AuthOrganization } from './auth.types';

/**
 * Session-based authentication with server-side validation (docs/04, docs/30).
 *
 * The cookie holds an opaque random token; only its SHA-256 is stored, so a
 * database leak cannot be replayed as a session. Every request revalidates the
 * session against the database rather than trusting a signed payload.
 */

export interface SessionMetadata {
  readonly userAgent?: string;
  readonly ipAddress?: string;
}

export interface CreatedSession {
  readonly token: string;
  readonly expiresAt: Date;
  readonly context: AuthContext;
}

const TOKEN_PURPOSES = {
  emailVerification: 'email_verification',
  passwordReset: 'password_reset',
} as const;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------------------------------------------------------- hashing */

  async hashPassword(password: string): Promise<string> {
    // Argon2id with parameters that stay comfortably above the OWASP minimum.
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /* ------------------------------------------------------------- signup/login */

  async signup(input: {
    email: string;
    password: string;
    name: string;
    organizationName: string;
  }): Promise<{ userId: string; organizationId: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw AppError.conflict('An account already exists with that email address.');
    }

    const passwordHash = await this.hashPassword(input.password);
    const slug = await this.uniqueSlug(input.organizationName);

    // One transaction: a user without an organization is unusable, and an
    // organization without an owner is orphaned.
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, passwordHash, name: input.name },
      });

      const organization = await tx.organization.create({
        data: {
          name: input.organizationName,
          slug,
          plan: 'free',
          memberships: { create: { userId: user.id, role: 'owner' } },
          subscription: {
            create: {
              plan: 'free',
              status: 'active',
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          },
        },
      });

      return { userId: user.id, organizationId: organization.id };
    });

    logger('auth').info(
      { userId: result.userId, organizationId: result.organizationId },
      'workspace created',
    );
    return result;
  }

  async authenticate(email: string, password: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Hash a dummy value so a missing account and a wrong password take the
      // same time; otherwise the endpoint enumerates registered emails.
      await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      });
      throw AppError.unauthenticated('Invalid email or password.');
    }

    const valid = await this.verifyPassword(user.passwordHash, password);
    if (!valid) throw AppError.unauthenticated('Invalid email or password.');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return user.id;
  }

  /* ---------------------------------------------------------------- sessions */

  async createSession(
    userId: string,
    metadata: SessionMetadata = {},
    organizationId?: string,
  ): Promise<CreatedSession> {
    const memberships = await this.membershipsFor(userId);
    if (memberships.length === 0) {
      throw AppError.forbidden('This account does not belong to any workspace.');
    }

    const active =
      memberships.find((membership) => membership.id === organizationId) ??
      (memberships[0] as AuthOrganization);

    const token = newToken(32);
    const expiresAt = new Date(Date.now() + env().SESSION_TTL_HOURS * 60 * 60 * 1000);

    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(token),
        activeOrganizationId: active.id,
        userAgent: metadata.userAgent?.slice(0, 500),
        ipAddress: metadata.ipAddress,
        expiresAt,
      },
    });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    return {
      token,
      expiresAt,
      context: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
        },
        organization: active,
        sessionId: session.id,
        organizations: memberships,
      },
    };
  }

  /**
   * Resolves a raw cookie token to an auth context, or null when the session
   * is missing, expired or revoked. Also refreshes `lastSeenAt` at most once
   * a minute so an active session does not write on every request.
   */
  async resolveSession(token: string | undefined): Promise<AuthContext | null> {
    if (!token || token.length < 20) return null;

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;

    const memberships = await this.membershipsFor(session.userId);
    if (memberships.length === 0) return null;

    const active =
      memberships.find((membership) => membership.id === session.activeOrganizationId) ??
      (memberships[0] as AuthOrganization);

    if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
      await this.prisma.session
        .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        emailVerified: session.user.emailVerified,
      },
      organization: active,
      sessionId: session.id,
      organizations: memberships,
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session
      .update({ where: { id: sessionId }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
  }

  async revokeOtherSessions(userId: string, keepSessionId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, id: { not: keepSessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
    return sessions.map((session) => ({
      id: session.id,
      current: session.id === currentSessionId,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      lastSeenAt: session.lastSeenAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    }));
  }

  async switchOrganization(
    sessionId: string,
    userId: string,
    organizationId: string,
  ): Promise<AuthContext> {
    const memberships = await this.membershipsFor(userId);
    const target = memberships.find((membership) => membership.id === organizationId);
    if (!target) throw AppError.forbidden('You are not a member of that workspace.');

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { activeOrganizationId: organizationId },
    });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified },
      organization: target,
      sessionId,
      organizations: memberships,
    };
  }

  /* ------------------------------------------------------------ credentials */

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    keepSessionId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const valid = await this.verifyPassword(user.passwordHash, currentPassword);
    if (!valid) throw AppError.unauthenticated('Your current password is not correct.');

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.hashPassword(newPassword) },
    });

    // A password change invalidates every other session by definition.
    await this.revokeOtherSessions(userId, keepSessionId);
  }

  /**
   * Issues a single-use token. The raw token is returned once (to be emailed);
   * only its hash is stored.
   */
  async issueToken(
    userId: string,
    purpose: keyof typeof TOKEN_PURPOSES,
    ttlMinutes: number,
  ): Promise<string> {
    const token = newToken(32);
    await this.prisma.verificationToken.create({
      data: {
        userId,
        purpose: TOKEN_PURPOSES[purpose],
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
      },
    });
    return token;
  }

  async consumeToken(token: string, purpose: keyof typeof TOKEN_PURPOSES): Promise<string> {
    const record = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: sha256(token) },
    });

    if (
      !record ||
      record.usedAt ||
      record.expiresAt.getTime() < Date.now() ||
      !safeEqual(record.purpose, TOKEN_PURPOSES[purpose])
    ) {
      throw AppError.badRequest('That link is invalid or has expired.');
    }

    await this.prisma.verificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return record.userId;
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const userId = await this.consumeToken(token, 'passwordReset');
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.hashPassword(newPassword) },
    });
    await this.revokeAllSessions(userId);
  }

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.consumeToken(token, 'emailVerification');
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  }

  async findUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /** Updates the display name. Email changes are deliberately not self-serve. */
  async prismaUpdateName(userId: string, name: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { name } });
  }

  /* ------------------------------------------------------------------ helpers */

  private async membershipsFor(userId: string): Promise<AuthOrganization[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      role: membership.role as OrgRole,
      plan: membership.organization.plan,
    }));
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'workspace';

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const taken = await this.prisma.organization.findUnique({ where: { slug: candidate } });
      if (!taken) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
}
