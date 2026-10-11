import Link from 'next/link';
import { Check } from 'lucide-react';
import { PLAN_QUOTAS, PLANS, type Plan } from '@leadforge/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** What each feature flag means in words a buyer would use. */
export const PLAN_FEATURE_LABELS: Record<string, string> = {
  discovery: 'Lead discovery',
  verification: 'Verification engine',
  enrichment: 'Website enrichment',
  intelligence: 'AI business analysis with evidence',
  scoring: 'Explainable lead scoring',
  personalization: 'Message generation',
  outreach: 'Approval queue and sending',
  sequences: 'Follow-up sequences',
  copilot: 'Conversation copilot',
  analytics: 'Analytics export (CSV)',
};

const HIGHLIGHT: Plan = 'growth';

const count = (value: number) => value.toLocaleString('en-GB');

/**
 * The plan cards, read straight from PLAN_QUOTAS — the same record the API
 * enforces. A number on this page cannot drift from what a workspace gets.
 */
export function PricingGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {PLANS.map((plan) => {
        const quota = PLAN_QUOTAS[plan];
        const highlighted = plan === HIGHLIGHT;
        // Each card lists only what it adds over the plan before it.
        const previous = PLANS[PLANS.indexOf(plan) - 1];
        const inherited = previous ? new Set(PLAN_QUOTAS[previous].features) : new Set<string>();
        const added = quota.features.filter((feature) => !inherited.has(feature));

        return (
          <article
            key={plan}
            className={cn(
              'flex flex-col rounded-xl border p-5',
              highlighted ? 'border-primary bg-primary/[0.05]' : 'border-border bg-surface',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold tracking-tight">{quota.label}</h3>
              {highlighted ? (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                  Most teams
                </span>
              ) : null}
            </div>
            <p className="mt-1 min-h-10 mk-body text-muted-foreground text-pretty">
              {quota.audience}
            </p>

            <p className="mt-4 flex items-baseline gap-1">
              <span className="tabular text-4xl font-semibold tracking-tight">
                ${quota.monthlyPriceUsd}
              </span>
              <span className="text-sm text-muted-foreground">/ month</span>
            </p>

            <Button variant={highlighted ? 'primary' : 'secondary'} className="mt-4 w-full" asChild>
              <Link href="/signup">
                {quota.monthlyPriceUsd === 0 ? 'Start free' : `Start with ${quota.label}`}
              </Link>
            </Button>

            <dl className="mt-5 space-y-1.5 border-t border-border pt-4 text-sm">
              <Row label="Leads / month" value={count(quota.monthlyLeads)} />
              <Row label="AI requests / month" value={count(quota.monthlyAiRequests)} />
              <Row label="Messages / month" value={count(quota.monthlyMessages)} />
              <Row label="Campaigns" value={count(quota.maxCampaigns)} />
              <Row label="Team members" value={count(quota.maxMembers)} />
            </dl>

            <ul className="mt-4 flex-1 space-y-1.5 border-t border-border pt-4">
              {previous ? (
                <li className="text-xs font-medium text-muted-foreground">
                  Everything in {PLAN_QUOTAS[previous].label}
                  {added.length > 0 ? ', plus:' : ', with higher limits.'}
                </li>
              ) : null}
              {added.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                  <span className="text-pretty">{PLAN_FEATURE_LABELS[feature] ?? feature}</span>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}
