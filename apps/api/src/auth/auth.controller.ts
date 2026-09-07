import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  confirmPasswordResetSchema,
  loginSchema,
  requestPasswordResetSchema,
  signupSchema,
  switchOrganizationSchema,
  verifyEmailSchema,
  passwordSchema,
  trimmed,
} from '@leadforge/shared';
import { capabilities, env } from '@leadforge/config';
import { clientIp, zodBody } from '@/common/http';
import { logger } from '@/common/logger';
import { AuditService } from '@/organizations/audit.service';
import { MailService } from '@/common/mail.service';
import { AuthService } from './auth.service';
import { Auth, Public, Req } from './auth.guard';
import { SESSION_COOKIE, AuthContext, AuthenticatedRequest } from './auth.types';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

const updateProfileSchema = z.object({ name: trimmed(120) });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  @Public()
  @Post('signup')
  async signup(
    @Body(zodBody(signupSchema)) body: z.infer<typeof signupSchema>,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId, organizationId } = await this.authService.signup(body);

    const session = await this.authService.createSession(
      userId,
      { userAgent: req.header('user-agent'), ipAddress: clientIp(req) },
      organizationId,
    );
    this.setSessionCookie(res, session.token, session.expiresAt);

    await this.audit.record({
      organizationId,
      userId,
      action: 'signup',
      resource: 'user',
      resourceId: userId,
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent'),
      requestId: req.requestId,
    });

    // Verification is issued immediately; the account is usable meanwhile.
    const token = await this.authService.issueToken(userId, 'emailVerification', 60 * 24);
    await this.mail.sendEmailVerification(body.email, body.name, token);

    return this.meResponse(session.context);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(zodBody(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await this.authService.authenticate(body.email, body.password);
    const session = await this.authService.createSession(userId, {
      userAgent: req.header('user-agent'),
      ipAddress: clientIp(req),
    });
    this.setSessionCookie(res, session.token, session.expiresAt);

    await this.audit.record({
      organizationId: session.context.organization.id,
      userId,
      action: 'login',
      resource: 'session',
      resourceId: session.context.sessionId,
      ipAddress: clientIp(req),
      userAgent: req.header('user-agent'),
      requestId: req.requestId,
    });

    return this.meResponse(session.context);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Auth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.revokeSession(auth.sessionId);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  @Get('me')
  me(@Auth() auth: AuthContext) {
    return this.meResponse(auth);
  }

  @Patch('profile')
  async updateProfile(
    @Auth() auth: AuthContext,
    @Body(zodBody(updateProfileSchema)) body: z.infer<typeof updateProfileSchema>,
  ) {
    await this.authService.prismaUpdateName(auth.user.id, body.name);
    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'update_profile',
      resource: 'user',
      resourceId: auth.user.id,
    });
    return { ok: true };
  }

  @Post('switch-organization')
  @HttpCode(200)
  async switchOrganization(
    @Auth() auth: AuthContext,
    @Body(zodBody(switchOrganizationSchema)) body: z.infer<typeof switchOrganizationSchema>,
  ) {
    const context = await this.authService.switchOrganization(
      auth.sessionId,
      auth.user.id,
      body.organizationId,
    );
    return this.meResponse(context);
  }

  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @Auth() auth: AuthContext,
    @Body(zodBody(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.authService.changePassword(
      auth.user.id,
      body.currentPassword,
      body.newPassword,
      auth.sessionId,
    );
    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'change_password',
      resource: 'user',
      resourceId: auth.user.id,
      ipAddress: clientIp(req),
    });
  }

  /* ------------------------------------------------------------- sessions */

  @Get('sessions')
  listSessions(@Auth() auth: AuthContext) {
    return this.authService.listSessions(auth.user.id, auth.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@Auth() auth: AuthContext, @Param('id') id: string): Promise<void> {
    const sessions = await this.authService.listSessions(auth.user.id, auth.sessionId);
    // Only ever revoke a session belonging to the caller.
    if (!sessions.some((session) => session.id === id)) return;
    await this.authService.revokeSession(id);
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOthers(@Auth() auth: AuthContext) {
    const count = await this.authService.revokeOtherSessions(auth.user.id, auth.sessionId);
    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'revoke_sessions',
      resource: 'session',
      metadata: { count },
    });
    return { revoked: count };
  }

  /* ------------------------------------------------- password reset / email */

  @Public()
  @Post('password-reset/request')
  @HttpCode(202)
  async requestPasswordReset(
    @Body(zodBody(requestPasswordResetSchema)) body: z.infer<typeof requestPasswordResetSchema>,
  ): Promise<{ accepted: true }> {
    const user = await this.authService.findUserByEmail(body.email);
    if (user) {
      const token = await this.authService.issueToken(user.id, 'passwordReset', 60);
      await this.mail.sendPasswordReset(user.email, user.name, token);
    } else {
      logger('auth').info({ email: '[redacted]' }, 'password reset requested for unknown address');
    }
    // Identical response either way, so the endpoint cannot enumerate accounts.
    return { accepted: true };
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(204)
  async confirmPasswordReset(
    @Body(zodBody(confirmPasswordResetSchema)) body: z.infer<typeof confirmPasswordResetSchema>,
  ): Promise<void> {
    await this.authService.resetPassword(body.token, body.password);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(
    @Body(zodBody(verifyEmailSchema)) body: z.infer<typeof verifyEmailSchema>,
  ): Promise<void> {
    await this.authService.verifyEmail(body.token);
  }

  @Post('verify-email/resend')
  @HttpCode(202)
  async resendVerification(@Auth() auth: AuthContext): Promise<{ accepted: true }> {
    if (!auth.user.emailVerified) {
      const token = await this.authService.issueToken(auth.user.id, 'emailVerification', 60 * 24);
      await this.mail.sendEmailVerification(auth.user.email, auth.user.name, token);
    }
    return { accepted: true };
  }

  /* -------------------------------------------------------------- helpers */

  private meResponse(auth: AuthContext) {
    const caps = capabilities();
    return {
      user: auth.user,
      organization: auth.organization,
      organizations: auth.organizations,
      capabilities: {
        ai: caps.ai,
        googlePlaces: caps.googlePlaces,
        whatsapp: caps.whatsapp,
        instagram: caps.instagram,
        email: caps.email,
      },
    };
  }

  private setSessionCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(SESSION_COOKIE, token, { ...this.cookieOptions(), expires: expiresAt });
  }

  private cookieOptions() {
    const config = env();
    return {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      // Lax still sends the cookie on top-level navigation, and blocks the
      // cross-site POSTs that CSRF depends on.
      sameSite: 'lax' as const,
      path: '/',
      ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
    };
  }
}
