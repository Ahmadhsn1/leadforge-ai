'use client';

import * as React from 'react';
import Link from 'next/link';
import { Check, CreditCard } from 'lucide-react';
import { Section } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/primitives';
import { CardSkeleton } from '@/components/ui/states';
import { HoverLift } from '@/components/ui/motion';
import { useMe, useUsage } from '@/lib/queries';
import { PLAN_QUOTAS, PLANS, type Plan } from '@leadforge/shared';
import { cn, formatCount, titleCase } from '@/lib/utils';

const FEATURE_LABELS: Record<string, string> = {
  discovery: 'Lead discovery',
  verification: 'Verification engine',
  enrichment: 'Website enrichment',
  intelligence: 'AI business analysis',
  scoring: 'Explainable lead scoring',
  personalization: 'Message generation',
  outreach: 'Outreach queue and sending',
  sequences: 'Follow-up sequences',
  copilot: 'Conversation copilot',
  analytics: 'Advanced analytics',
  white_label: 'White label',
};

export default function BillingSettingsPage() {
  const me = useMe();
  const usage = useUsage();

  const currentPlan = (me.data?.organization.plan ?? 'free') as Plan;

  return (
    <div className="space-y-6">
      <Section title="Current plan">
        {usage.isLoading ? (
          <CardSkeleton className="h-40" />
        ) : (
          <div className="panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                  {PLAN_QUOTAS[currentPlan].label}
                  <Badge variant="primary">Active</Badge>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Billing period {usage.data?.period ?? 'current month'}
                </p>
              </div>
              <Button variant="secondary" size="sm" disabled>
                <CreditCard aria-hidden="true" />
                Manage payment
              </Button>
            </div>

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

            <p className="mt-4 rounded-md border border-dashed border-border bg-raised px-3 py-2 text-xs text-muted-foreground text-pretty">
              Self-serve payment is not wired up in this deployment. Quotas are enforced from the
              plan on your workspace record; an operator changes it directly. Everything below shows
              what each plan allows.
            </p>
          </div>
        )}
      </Section>

      <Section title="Plans" description="Quotas reset at the start of each billing period.">
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan) => {
            const quota = PLAN_QUOTAS[plan];
            const current = plan === currentPlan;
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
                      <dt className="text-muted-foreground">Members</dt>
                      <dd className="tabular font-medium">{quota.maxMembers}</dd>
                    </div>
                  </dl>

                  <ul className="mt-3 flex-1 space-y-1 border-t border-border pt-3">
                    {quota.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-1.5 text-2xs">
                        <Check className="mt-0.5 size-3 shrink-0 text-success" aria-hidden="true" />
                        <span className="text-pretty">
                          {FEATURE_LABELS[feature] ?? titleCase(feature)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </article>
              </HoverLift>
            );
          })}
        </div>
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
