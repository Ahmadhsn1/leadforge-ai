'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CreditCard } from 'lucide-react';
import { Section } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/primitives';
import { CardSkeleton } from '@/components/ui/states';
import { HoverLift } from '@/components/ui/motion';
import { PLAN_FEATURE_LABELS } from '@/components/marketing/pricing-grid';
import { api, ApiError } from '@/lib/api-client';
import { openPaddleCheckout } from '@/lib/paddle';
import { useBilling, useMe, useUsage } from '@/lib/queries';
import { PLAN_QUOTAS, PLANS, type Plan } from '@leadforge/shared';
import { cn, formatCount, formatDate, titleCase } from '@/lib/utils';
import type { BillingView, PlanChangeResult } from '@/types/api';

type PaidPlan = Exclude<Plan, 'free'>;

type StatusCopy = { label: string; variant: 'primary' | 'warning' | 'outline' };

const ACTIVE_STATUS: StatusCopy = { label: 'Active', variant: 'primary' };

const STATUS_COPY: Record<string, StatusCopy> = {
  active: ACTIVE_STATUS,
  trialing: { label: 'Trial', variant: 'primary' },
  past_due: { label: 'Payment failed', variant: 'warning' },
  paused: { label: 'Paused', variant: 'outline' },
  canceled: { label: 'Cancelled', variant: 'outline' },
};

export default function BillingSettingsPage() {
  const me = useMe();
  const usage = useUsage();
  const billing = useBilling();
  const queryClient = useQueryClient();

  const [pendingPlan, setPendingPlan] = React.useState<PaidPlan | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [openingPortal, setOpeningPortal] = React.useState(false);

  const currentPlan = (billing.data?.plan ?? me.data?.organization.plan ?? 'free') as Plan;
  const isOwner = me.data?.organization.role === 'owner';
  const status = STATUS_COPY[billing.data?.status ?? 'active'] ?? ACTIVE_STATUS;

  /**
   * The plan only changes when the provider's webhook reaches the API, which
   * is usually a second or two after the checkout closes. Poll briefly rather
   * than showing the old plan and making a paying customer wonder.
   */
  async function waitForPlan(expected: PaidPlan) {
    setConfirming(true);
    try {
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const latest = await api.get<BillingView>('/billing');
        if (latest.plan === expected) {
          await queryClient.invalidateQueries();
          toast.success(`You are now on the ${PLAN_QUOTAS[expected].label} plan`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      await queryClient.invalidateQueries();
      toast.message('Payment received — still confirming', {
        description:
          'Your plan will update as soon as the payment provider confirms it. Refresh this page in a minute.',
      });
    } finally {
      setConfirming(false);
    }
  }

  async function choosePlan(plan: PaidPlan) {
    setPendingPlan(plan);
    try {
      const result = await api.post<PlanChangeResult>('/billing/plan', { plan });

      if (result.mode === 'updated') {
        setPendingPlan(null);
        await waitForPlan(plan);
        return;
      }

      const checkout = billing.data?.checkout;
      if (!checkout) throw new Error('Checkout is not configured.');

      await openPaddleCheckout({
        environment: checkout.environment,
        clientToken: checkout.clientToken,
        transactionId: result.transactionId,
        onCompleted: () => void waitForPlan(plan),
        onClosed: () => setPendingPlan(null),
      });
    } catch (error) {
      setPendingPlan(null);
      toast.error('Could not start the upgrade', {
        description:
          error instanceof ApiError ? error.userMessage : 'Check your connection and try again.',
      });
    }
  }

  async function openPortal() {
    setOpeningPortal(true);
    try {
      const { url } = await api.post<{ url: string }>('/billing/portal');
      window.location.assign(url);
    } catch (error) {
      setOpeningPortal(false);
      toast.error('Could not open the billing portal', {
        description: error instanceof ApiError ? error.userMessage : undefined,
      });
    }
  }

  return (
    <div className="space-y-6">
      <Section title="Current plan">
        {usage.isLoading || billing.isLoading ? (
          <CardSkeleton className="h-40" />
        ) : (
          <div className="panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                  {PLAN_QUOTAS[currentPlan].label}
                  <Badge variant={status.variant}>{status.label}</Badge>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {billing.data?.hasSubscription && billing.data.currentPeriodEnd
                    ? billing.data.cancelAtPeriodEnd
                      ? `Cancels on ${formatDate(billing.data.currentPeriodEnd)}. You keep this plan until then.`
                      : `Renews on ${formatDate(billing.data.currentPeriodEnd)}.`
                    : `Usage period ${usage.data?.period ?? 'current month'}`}
                </p>
              </div>
              {billing.data?.hasSubscription && isOwner ? (
                <Button variant="secondary" size="sm" onClick={openPortal} loading={openingPortal}>
                  <CreditCard aria-hidden="true" />
                  Invoices and payment method
                </Button>
              ) : null}
            </div>

            {billing.data?.status === 'past_due' ? (
              <p
                role="alert"
                className="mt-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-pretty"
              >
                The last payment did not go through. Your plan stays active while the payment
                provider retries, but it will end if the retries fail.{' '}
                {isOwner
                  ? 'Update the payment method to keep it.'
                  : 'Ask the workspace owner to update the payment method.'}
              </p>
            ) : null}

            {usage.data ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {usage.data.quotas.map((quota) => (
                  <div key={quota.metric}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="eyebrow">{titleCase(quota.metric)}</span>
                      <span className="tabular text-2xs text-muted-foreground">
                        {formatCount(quota.used, true)} / {formatCount(quota.limit, true)}
                      </span>
                    </div>
                    <Progress
                      value={quota.pct * 100}
                      tone={
                        quota.pct >= 0.9 ? 'destructive' : quota.pct >= 0.75 ? 'warning' : 'primary'
                      }
                      className="mt-1.5"
                    />
                  </div>
                ))}
              </div>
            ) : null}

            {billing.data && !billing.data.enabled ? (
              <p className="mt-4 rounded-md border border-dashed border-border bg-raised px-3 py-2 text-xs text-muted-foreground text-pretty">
                Self-serve payment is not set up on this deployment, so plans cannot be changed from
                here. Whoever runs it can change the plan on the workspace directly.
              </p>
            ) : null}

            {confirming ? (
              <p
                role="status"
                className="mt-4 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-pretty"
              >
                Confirming your plan change with the payment provider…
              </p>
            ) : null}
          </div>
        )}
      </Section>

      <Section
        title="Plans"
        description="Usage allowances reset on the first day of each calendar month."
      >
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan) => {
            const quota = PLAN_QUOTAS[plan];
            const current = plan === currentPlan;
            const paid = plan !== 'free';
            const upgrade = quota.monthlyPriceUsd > PLAN_QUOTAS[currentPlan].monthlyPriceUsd;
            return (
              <HoverLift
                key={plan}
                className="h-full rounded-lg"
                intensity={current ? 'none' : 'subtle'}
              >
                <article
                  className={cn(
                    'flex h-full flex-col rounded-lg border p-4',
                    current ? 'border-primary bg-primary/[0.06]' : 'border-border bg-surface',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-md font-semibold tracking-tight">{quota.label}</h3>
                    {current ? <Badge variant="primary">Current</Badge> : null}
                  </div>
                  <p className="mt-1 flex items-baseline gap-1">
                    <span className="tabular text-2xl font-semibold tracking-tight">
                      ${quota.monthlyPriceUsd}
                    </span>
                    <span className="text-2xs text-muted-foreground">/ month</span>
                  </p>

                  <dl className="mt-3 space-y-1 text-xs">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Leads / month</dt>
                      <dd className="tabular font-medium">
                        {formatCount(quota.monthlyLeads, true)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">AI requests</dt>
                      <dd className="tabular font-medium">
                        {formatCount(quota.monthlyAiRequests, true)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Messages</dt>
                      <dd className="tabular font-medium">
                        {formatCount(quota.monthlyMessages, true)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Campaigns</dt>
                      <dd className="tabular font-medium">{quota.maxCampaigns}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Members</dt>
                      <dd className="tabular font-medium">{quota.maxMembers}</dd>
                    </div>
                  </dl>

                  <ul className="mt-3 flex-1 space-y-1 border-t border-border pt-3">
                    {quota.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-1.5 text-2xs">
                        <Check className="mt-0.5 size-3 shrink-0 text-success" aria-hidden="true" />
                        <span className="text-pretty">
                          {PLAN_FEATURE_LABELS[feature] ?? titleCase(feature)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {billing.data?.enabled && paid && !current && isOwner ? (
                    <Button
                      variant={upgrade ? 'primary' : 'secondary'}
                      size="sm"
                      className="mt-3 w-full"
                      loading={pendingPlan === plan}
                      disabled={pendingPlan !== null || confirming}
                      onClick={() => choosePlan(plan as PaidPlan)}
                    >
                      {upgrade ? `Upgrade to ${quota.label}` : `Switch to ${quota.label}`}
                    </Button>
                  ) : null}
                </article>
              </HoverLift>
            );
          })}
        </div>

        {billing.data?.enabled && !isOwner ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Only the workspace owner can change the plan.
          </p>
        ) : null}
        {billing.data?.enabled && billing.data.hasSubscription && isOwner ? (
          <p className="mt-3 text-xs text-muted-foreground text-pretty">
            Switching plans charges or credits the difference for the rest of the current period
            straight away. To cancel and return to Free, use “Invoices and payment method” above.
          </p>
        ) : null}
      </Section>

      <Section title="Usage detail">
        <div className="panel p-4">
          <p className="text-sm text-muted-foreground text-pretty">
            AI spend, model mix and per-task cost are broken down on the usage page.
          </p>
          <Button variant="secondary" size="sm" className="mt-3" asChild>
            <Link href="/dashboard/usage">View AI usage</Link>
          </Button>
        </div>
      </Section>
    </div>
  );
}
