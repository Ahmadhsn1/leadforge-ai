import { Injectable } from '@nestjs/common';
import { env } from '@leadforge/config';
import { PrismaService } from './prisma.service';
import { MailService } from './mail.service';
import { logger } from './logger';

/** Events a workspace can be emailed about. Keys match the preferences screen. */
export type NotificationKind = 'newReply' | 'needsHuman' | 'campaignCompleted';

/** What applies when a workspace has never touched its preferences. */
const DEFAULT_ON: Readonly<Record<NotificationKind, boolean>> = {
  newReply: true,
  needsHuman: true,
  campaignCompleted: true,
};

/**
 * Email notifications to the people in a workspace.
 *
 * The preferences screen existed before anything read it. This is the reader:
 * a notification goes out only if the workspace has that kind switched on, and
 * only to members whose address is confirmed — an unverified address might not
 * belong to the person who signed up.
 *
 * Never throws and never blocks the caller: a reply being recorded must not
 * depend on whether a courtesy email could be sent about it.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  notify(
    organizationId: string,
    kind: NotificationKind,
    message: { subject: string; text: string; path: string },
  ): void {
    void this.deliver(organizationId, kind, message).catch((error) => {
      logger('notifications').warn({ err: error, kind }, 'notification failed');
    });
  }

  private async deliver(
    organizationId: string,
    kind: NotificationKind,
    message: { subject: string; text: string; path: string },
  ): Promise<void> {
    if (!this.mail.isConfigured()) return;

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, settings: true },
    });
    if (!organization) return;

    const preferences =
      (organization.settings as { notifications?: Record<string, unknown> } | null)
        ?.notifications ?? {};
    const enabled = typeof preferences[kind] === 'boolean' ? preferences[kind] : DEFAULT_ON[kind];
    if (!enabled) return;

    // Viewers are read-only; a reply is not theirs to act on.
    const members = await this.prisma.membership.findMany({
      where: { organizationId, role: { in: ['owner', 'admin', 'member'] } },
      include: { user: { select: { email: true, emailVerified: true } } },
    });
    const recipients = members
      .filter((member) => member.user.emailVerified)
      .map((member) => member.user.email);
    if (recipients.length === 0) return;

    const link = `${env().APP_URL.replace(/\/+$/, '')}${message.path}`;
    const text = `${message.text}\n\nOpen it in LeadForge:\n${link}\n\n--\nYou are receiving this because you are a member of ${organization.name}. Change what you are emailed about in Settings → Notifications.`;

    await Promise.all(
      recipients.map((to) => this.mail.sendNotification(to, message.subject, text)),
    );
    logger('notifications').info({ kind, recipients: recipients.length }, 'notification sent');
  }
}
