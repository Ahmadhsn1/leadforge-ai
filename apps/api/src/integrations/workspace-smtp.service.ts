import { Injectable } from '@nestjs/common';
import * as dns from 'node:dns/promises';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { z } from 'zod';
import {
  AppError,
  emailSchema,
  isObviouslyPrivateHost,
  isPrivateIpv4,
  isPrivateIpv6,
  trimmed,
} from '@leadforge/shared';
import { env } from '@leadforge/config';
import { PrismaService } from '@/common/prisma.service';
import { openSecret, sealSecret } from '@/common/secret-box';
import { logger } from '@/common/logger';

/** Submission ports only. Anything else is a port scan with extra steps. */
const ALLOWED_PORTS = [25, 465, 587, 2525] as const;

export const workspaceSmtpSchema = z.object({
  host: trimmed(253).regex(/^[a-z0-9.-]+$/i, 'Enter a hostname such as smtp.example.com'),
  port: z
    .number()
    .int()
    .refine((port) => (ALLOWED_PORTS as readonly number[]).includes(port), {
      message: `Port must be one of ${ALLOWED_PORTS.join(', ')}`,
    }),
  username: trimmed(320),
  password: z.string().min(1).max(1_000),
  fromAddress: emailSchema,
  fromName: trimmed(120).optional(),
});
export type WorkspaceSmtpInput = z.infer<typeof workspaceSmtpSchema>;

export interface WorkspaceSmtp {
  readonly transporter: Transporter;
  /** RFC 5322 from value, with the display name when one was given. */
  readonly from: string;
  readonly fromAddress: string;
}

/** The non-secret half of a connection, as stored and as shown in settings. */
export interface StoredConfig {
  host?: string;
  port?: number;
  username?: string;
  fromAddress?: string;
  fromName?: string;
}

const PROVIDER = 'email';

/**
 * A workspace's own SMTP account.
 *
 * On a shared deployment every customer must send from their own mailbox: mail
 * from one operator-wide account would put every customer's outreach under one
 * sender reputation and one From address. The password is sealed with
 * `secret-box` and is never returned by any endpoint.
 */
@Injectable()
export class WorkspaceSmtpService {
  /** One live transporter per workspace, rebuilt when its row changes. */
  private readonly cache = new Map<string, { version: number; smtp: WorkspaceSmtp }>();

  constructor(private readonly prisma: PrismaService) {}

  private context(organizationId: string): string {
    return `${organizationId}:${PROVIDER}`;
  }

  /**
   * Refuses hosts that resolve inside our own network. The host is typed by a
   * customer, and "connect to this address and tell me what happened" is
   * exactly the primitive an internal port scan needs.
   */
  private async assertPublicHost(host: string): Promise<void> {
    if (env().ALLOW_PRIVATE_NETWORK_FETCH) return;

    const refuse = () =>
      new AppError('UNSAFE_URL', 'That mail server address is not reachable from here.', {
        retryable: false,
      });

    if (isObviouslyPrivateHost(host)) throw refuse();

    let addresses: { address: string; family: number }[];
    try {
      addresses = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
      throw new AppError('VALIDATION_FAILED', `The mail server "${host}" could not be found.`, {
        retryable: false,
      });
    }

    for (const { address, family } of addresses) {
      if (family === 6 ? isPrivateIpv6(address) : isPrivateIpv4(address)) throw refuse();
    }
  }

  private buildTransporter(input: {
    host: string;
    port: number;
    username: string;
    password: string;
  }): Transporter {
    return nodemailer.createTransport({
      host: input.host,
      port: input.port,
      secure: input.port === 465,
      auth: { user: input.username, pass: input.password },
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  /**
   * Checks the credentials against the server, then stores them. Nothing is
   * saved unless the server accepted the login — a typo should fail here, in
   * front of the person who can fix it, not on the first prospect email.
   */
  async save(organizationId: string, input: WorkspaceSmtpInput) {
    await this.assertPublicHost(input.host);

    const transporter = this.buildTransporter(input);
    try {
      await transporter.verify();
    } catch (error) {
      logger('integrations').warn({ err: error, host: input.host }, 'workspace SMTP check failed');
      throw new AppError(
        'VALIDATION_FAILED',
        'The mail server did not accept those details. Check the host, port, username and password.',
        { retryable: false },
      );
    } finally {
      transporter.close();
    }

    const config: StoredConfig = {
      host: input.host.toLowerCase(),
      port: input.port,
      username: input.username,
      fromAddress: input.fromAddress,
      ...(input.fromName ? { fromName: input.fromName } : {}),
    };
    const encryptedSecret = sealSecret(
      input.password,
      env().AUTH_SECRET,
      this.context(organizationId),
    );
    const now = new Date();

    await this.prisma.integration.upsert({
      where: { organizationId_provider: { organizationId, provider: PROVIDER } },
      create: {
        organizationId,
        provider: PROVIDER,
        enabled: true,
        config: config as never,
        encryptedSecret,
        status: 'connected',
        lastCheckedAt: now,
      },
      update: {
        enabled: true,
        config: config as never,
        encryptedSecret,
        status: 'connected',
        lastCheckedAt: now,
        lastError: null,
      },
    });

    this.cache.delete(organizationId);
    logger('integrations').info({ organizationId }, 'workspace SMTP connected');
    return config;
  }

  async remove(organizationId: string): Promise<void> {
    await this.prisma.integration.updateMany({
      where: { organizationId, provider: PROVIDER },
      data: { encryptedSecret: null, config: {} as never, status: 'disconnected' },
    });
    this.cache.delete(organizationId);
  }

  /** Whether this workspace has its own, enabled, mail account. */
  async has(organizationId: string): Promise<boolean> {
    const row = await this.prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: PROVIDER } },
      select: { enabled: true, encryptedSecret: true },
    });
    return Boolean(row?.enabled && row.encryptedSecret);
  }

  /** The workspace's transport, or null when it has not connected one. */
  async load(organizationId: string): Promise<WorkspaceSmtp | null> {
    const row = await this.prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: PROVIDER } },
    });
    if (!row?.enabled || !row.encryptedSecret) return null;

    const version = row.updatedAt.getTime();
    const cached = this.cache.get(organizationId);
    if (cached?.version === version) return cached.smtp;

    const config = (row.config ?? {}) as StoredConfig;
    const password = openSecret(
      row.encryptedSecret,
      env().AUTH_SECRET,
      this.context(organizationId),
    );

    if (!password || !config.host || !config.port || !config.username || !config.fromAddress) {
      // Unreadable (for instance after AUTH_SECRET was rotated). Say so on the
      // integrations screen rather than failing every send with no explanation.
      await this.prisma.integration.update({
        where: { id: row.id },
        data: {
          status: 'error',
          lastError: 'The saved mail password can no longer be read. Enter the details again.',
        },
      });
      return null;
    }

    const smtp: WorkspaceSmtp = {
      transporter: this.buildTransporter({
        host: config.host,
        port: config.port,
        username: config.username,
        password,
      }),
      from: config.fromName
        ? `"${config.fromName.replace(/["\\\r\n]/g, '')}" <${config.fromAddress}>`
        : config.fromAddress,
      fromAddress: config.fromAddress,
    };

    cached?.smtp.transporter.close();
    this.cache.set(organizationId, { version, smtp });
    return smtp;
  }
}
