import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { AppError } from '@leadforge/shared';
import { capabilities, env } from '@leadforge/config';
import { logger } from './logger';

export interface SendMailInput {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly replyTo?: string;
}

export interface SendMailResult {
  readonly messageId: string;
  readonly accepted: readonly string[];
}

/**
 * SMTP transport, used both for transactional email (verification, resets)
 * and as the email outreach channel.
 *
 * When SMTP is not configured, transactional mail degrades to a logged link
 * (so local development works without a mail server) while outreach sending
 * fails loudly — silently dropping a prospect email would be worse than an
 * error the user can see.
 */
@Injectable()
export class MailService {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter | null {
    if (!capabilities().email) return null;
    if (this.transporter) return this.transporter;

    const config = env();
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      // 465 is implicit TLS; everything else upgrades via STARTTLS.
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    return this.transporter;
  }

  isConfigured(): boolean {
    return capabilities().email;
  }

  /** Sends an operational email. Throws when SMTP is unavailable. */
  async send(input: SendMailInput): Promise<SendMailResult> {
    const transporter = this.getTransporter();
    if (!transporter) throw AppError.providerNotConfigured('SMTP email');

    try {
      const info = await transporter.sendMail({
        from: env().SMTP_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
        replyTo: input.replyTo,
      });
      return { messageId: info.messageId, accepted: (info.accepted ?? []).map(String) };
    } catch (error) {
      throw new AppError('PROVIDER_ERROR', 'The SMTP server rejected the message.', {
        cause: error,
        retryable: true,
      });
    }
  }

  /**
   * Transactional mail. Never throws: a failure to send a verification email
   * must not roll back the signup that triggered it.
   */
  private async sendTransactional(
    input: SendMailInput,
    fallbackLabel: string,
    link: string,
  ): Promise<void> {
    if (!this.isConfigured()) {
      // Development path: the operator can copy the link from the logs.
      logger('mail').warn(
        { to: input.to, subject: input.subject, link },
        `SMTP not configured — ${fallbackLabel} link logged instead of sent`,
      );
      return;
    }
    try {
      await this.send(input);
      logger('mail').info({ subject: input.subject }, 'transactional email sent');
    } catch (error) {
      logger('mail').error({ err: error, subject: input.subject }, 'transactional email failed');
    }
  }

  async sendEmailVerification(email: string, name: string, token: string): Promise<void> {
    const link = `${env().APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
    await this.sendTransactional(
      {
        to: email,
        subject: 'Verify your LeadForge email address',
        text: `Hi ${name},

Confirm this address to finish setting up your LeadForge workspace:

${link}

This link expires in 24 hours. If you did not create a LeadForge account, ignore this email.`,
      },
      'email verification',
      link,
    );
  }

  async sendPasswordReset(email: string, name: string, token: string): Promise<void> {
    const link = `${env().APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await this.sendTransactional(
      {
        to: email,
        subject: 'Reset your LeadForge password',
        text: `Hi ${name},

Use this link to choose a new password:

${link}

It expires in one hour and can be used once. If you did not request this, you can ignore it — your password has not changed.`,
      },
      'password reset',
      link,
    );
  }

  async sendInvite(
    email: string,
    organizationName: string,
    inviterName: string,
    token: string,
  ): Promise<void> {
    const link = `${env().APP_URL}/invite?token=${encodeURIComponent(token)}`;
    await this.sendTransactional(
      {
        to: email,
        subject: `${inviterName} invited you to ${organizationName} on LeadForge`,
        text: `${inviterName} has invited you to join the ${organizationName} workspace on LeadForge.

Accept the invitation:

${link}

This link expires in 7 days.`,
      },
      'workspace invite',
      link,
    );
  }

  /** Liveness check used by the health endpoint. */
  async verifyConnection(): Promise<boolean> {
    const transporter = this.getTransporter();
    if (!transporter) return false;
    try {
      await transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}
