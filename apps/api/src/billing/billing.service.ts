import { Injectable } from '@nestjs/common';
import { AppError, PLAN_QUOTAS, Plan } from '@leadforge/shared';
import { capabilities, env } from '@leadforge/config';
import { PrismaService } from '@/common/prisma.service';
import { logger } from '@/common/logger';
import {
  PaddleEvent,
  PaddleSubscription,
  PaidPlan,
  PriceMap,
  entitledPlan,
  isPaddleSubscription,
  planForPrice,
} from './billing.logic';

const PADDLE_API = {
  sandbox: 'https://sandbox-api.paddle.com',
  production: 'https://api.paddle.com',
} as const;

/**
 * Subscriptions (docs/37 phase 8).
 *
 * Paddle is the merchant of record: it owns the checkout, the card, tax and
 * invoices. This service does three things — opens a checkout for the right
 * workspace, changes or manages an existing subscription, and applies what
 * Paddle's webhooks say to `Organization.plan`.
 *
 * The plan on the organization row is what every quota check reads, and only
 * a verified webhook ever raises it. A checkout that "succeeds" in the browser
 * changes nothing here by itself, so a forged success page buys nothing.
 */
@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  isEnabled(): boolean {
    return capabilities().billing;
  }

  private prices(): PriceMap {
    const config = env();
    return {
      starter: config.PADDLE_PRICE_STARTER,
      growth: config.PADDLE_PRICE_GROWTH,
      agency: config.PADDLE_PRICE_AGENCY,
    };
  }

  /* ------------------------------------------------------------- overview */

  /** Everything the billing screen needs. */
  async overview(organizationId: string) {
    const [organization, subscription] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { plan: true },
      }),
      this.prisma.subscription.findUnique({ where: { organizationId } }),
    ]);

    const paid = Boolean(subscription?.externalSubscriptionId) && organization.plan !== 'free';
    const config = env();

    return {
      enabled: this.isEnabled(),
      plan: organization.plan,
      status: paid ? (subscription?.status ?? 'active') : 'active',
      // A free plan has no renewal; reporting one would imply a charge.
      currentPeriodEnd: paid ? (subscription?.currentPeriodEnd.toISOString() ?? null) : null,
      cancelAtPeriodEnd: paid ? (subscription?.cancelAtPeriodEnd ?? false) : false,
      hasSubscription: paid,
      // Only what Paddle.js needs, and only public values.
      checkout: this.isEnabled()
        ? { environment: config.PADDLE_ENVIRONMENT, clientToken: config.PADDLE_CLIENT_TOKEN }
        : null,
    };
  }

  /* ------------------------------------------------------- checkout/change */

  /**
   * Moves a workspace to a paid plan.
   *
   * With no subscription yet, this creates a Paddle transaction carrying the
   * workspace id and returns it for the browser to open in Paddle's checkout.
   * The id is attached here, server-side, because anything the browser sends
   * to the checkout could be edited to point at a different workspace.
   *
   * With a live subscription, it swaps the price on that subscription instead
   * — a second checkout would create a second subscription and bill twice.
   */
  async startPlanChange(
    organizationId: string,
    plan: PaidPlan,
    user: { email: string },
  ): Promise<{ mode: 'checkout'; transactionId: string } | { mode: 'updated'; plan: PaidPlan }> {
    this.assertEnabled();

    const priceId = this.prices()[plan];
    if (!priceId) throw AppError.providerNotConfigured(`The ${PLAN_QUOTAS[plan].label} plan price`);

    const [organization, subscription] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { plan: true },
      }),
      this.prisma.subscription.findUnique({ where: { organizationId } }),
    ]);

    if (
      subscription?.externalSubscriptionId &&
      ['active', 'trialing', 'past_due'].includes(subscription.status)
    ) {
      if (organization.plan === plan && !subscription.cancelAtPeriodEnd) {
        throw AppError.conflict(
          `This workspace is already on the ${PLAN_QUOTAS[plan].label} plan.`,
        );
      }

      await this.paddle('PATCH', `/subscriptions/${subscription.externalSubscriptionId}`, {
        items: [{ price_id: priceId, quantity: 1 }],
        // Charge or credit the difference now, so the new limits can apply now.
        proration_billing_mode: 'prorated_immediately',
        // Choosing a plan again is also how a pending cancellation is undone.
        scheduled_change: null,
      });

      // The plan itself changes when Paddle's webhook confirms it.
      logger('billing').info({ organizationId, plan }, 'subscription plan change requested');
      return { mode: 'updated', plan };
    }

    const transaction = await this.paddle<{ id: string }>('POST', '/transactions', {
      items: [{ price_id: priceId, quantity: 1 }],
      collection_mode: 'automatic',
      custom_data: { organizationId, requestedBy: user.email },
    });

    logger('billing').info({ organizationId, plan }, 'checkout transaction created');
    return { mode: 'checkout', transactionId: transaction.id };
  }

  /** A link to Paddle's hosted portal: invoices, payment method, cancellation. */
  async portalUrl(organizationId: string): Promise<{ url: string }> {
    this.assertEnabled();

    const subscription = await this.prisma.subscription.findUnique({ where: { organizationId } });
    if (!subscription?.externalCustomerId) {
      throw AppError.conflict('This workspace has no paid subscription to manage yet.');
    }

    const session = await this.paddle<{ urls?: { general?: { overview?: string } } }>(
      'POST',
      `/customers/${subscription.externalCustomerId}/portal-sessions`,
      subscription.externalSubscriptionId
        ? { subscription_ids: [subscription.externalSubscriptionId] }
        : {},
    );

    const url = session.urls?.general?.overview;
    if (!url) {
      throw new AppError('PROVIDER_ERROR', 'The billing portal did not return a link.', {
        retryable: true,
      });
    }
    return { url };
  }

  /* -------------------------------------------------------------- webhooks */

  /**
   * Applies one verified Paddle event. Idempotent, and safe against events
   * arriving out of order.
   *
   * @returns what was done, for the delivery log.
   */
  async applyEvent(event: PaddleEvent): Promise<'applied' | 'ignored' | 'stale'> {
    if (!event.event_type.startsWith('subscription.')) return 'ignored';
    if (!isPaddleSubscription(event.data)) return 'ignored';

    const subscription: PaddleSubscription = event.data;
    const organizationId = await this.resolveOrganization(subscription);
    if (!organizationId) {
      logger('billing').warn(
        { subscriptionId: subscription.id, eventType: event.event_type },
        'subscription event could not be matched to a workspace',
      );
      return 'ignored';
    }

    const occurredAt = new Date(event.occurred_at);
    const existing = await this.prisma.subscription.findUnique({ where: { organizationId } });

    // A workspace has one subscription. An event for a different, older one
    // (say, a cancelled predecessor) must not touch the current one.
    if (
      existing?.externalSubscriptionId &&
      existing.externalSubscriptionId !== subscription.id &&
      ['active', 'trialing', 'past_due'].includes(existing.status)
    ) {
      logger('billing').warn(
        { organizationId, subscriptionId: subscription.id },
        'event for a subscription that is not the workspace’s current one ignored',
      );
      return 'ignored';
    }

    if (
      existing?.lastEventAt &&
      existing.externalSubscriptionId === subscription.id &&
      occurredAt.getTime() < existing.lastEventAt.getTime()
    ) {
      return 'stale';
    }

    const subscribedPlan = planForPrice(subscription.items?.[0]?.price?.id, this.prices());
    if (!subscribedPlan) {
      logger('billing').error(
        { organizationId, priceId: subscription.items?.[0]?.price?.id },
        'subscription uses a price that maps to no plan; workspace left on free',
      );
    }

    const plan: Plan = entitledPlan(subscription.status, subscribedPlan);
    const period = subscription.current_billing_period;
    const periodStart = period?.starts_at
      ? new Date(period.starts_at)
      : (existing?.currentPeriodStart ?? occurredAt);
    const periodEnd = period?.ends_at
      ? new Date(period.ends_at)
      : (existing?.currentPeriodEnd ?? occurredAt);
    const cancelAtPeriodEnd = subscription.scheduled_change?.action === 'cancel';

    const fields = {
      plan,
      status: subscription.status,
      provider: 'paddle',
      externalCustomerId: subscription.customer_id,
      externalSubscriptionId: subscription.id,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd,
      lastEventAt: occurredAt,
    };

    await this.prisma.$transaction([
      this.prisma.subscription.upsert({
        where: { organizationId },
        create: { organizationId, ...fields },
        update: fields,
      }),
      this.prisma.organization.update({ where: { id: organizationId }, data: { plan } }),
      this.prisma.auditLog.create({
        data: {
          organizationId,
          action: 'subscription_changed',
          resource: 'subscription',
          resourceId: subscription.id,
          metadata: {
            eventType: event.event_type,
            status: subscription.status,
            plan,
            previousPlan: existing?.plan ?? 'free',
            cancelAtPeriodEnd,
          },
        },
      }),
    ]);

    logger('billing').info(
      { organizationId, plan, status: subscription.status, eventType: event.event_type },
      'subscription event applied',
    );
    return 'applied';
  }

  /**
   * Which workspace a subscription belongs to. A subscription we already know
   * wins over `custom_data`, which is only trusted for the first event.
   */
  private async resolveOrganization(subscription: PaddleSubscription): Promise<string | null> {
    const known = await this.prisma.subscription.findUnique({
      where: { externalSubscriptionId: subscription.id },
      select: { organizationId: true },
    });
    if (known) return known.organizationId;

    const claimed = subscription.custom_data?.organizationId;
    if (typeof claimed !== 'string' || claimed.length === 0) return null;

    const organization = await this.prisma.organization.findUnique({
      where: { id: claimed },
      select: { id: true },
    });
    return organization?.id ?? null;
  }

  /* ---------------------------------------------------------------- paddle */

  private assertEnabled(): void {
    if (!this.isEnabled()) throw AppError.providerNotConfigured('Billing');
  }

  private async paddle<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const config = env();

    let response: Response;
    try {
      response = await fetch(`${PADDLE_API[config.PADDLE_ENVIRONMENT]}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.PADDLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new AppError('PROVIDER_UNAVAILABLE', 'The payment provider could not be reached.', {
        cause: error,
        retryable: true,
      });
    }

    const payload = (await response.json().catch(() => null)) as {
      data?: T;
      error?: { code?: string; detail?: string };
    } | null;

    if (!response.ok || !payload?.data) {
      logger('billing').error(
        {
          status: response.status,
          path,
          code: payload?.error?.code,
          detail: payload?.error?.detail,
        },
        'paddle request failed',
      );
      throw new AppError('PROVIDER_ERROR', 'The payment provider rejected the request.', {
        retryable: response.status >= 500,
      });
    }

    return payload.data;
  }
}
