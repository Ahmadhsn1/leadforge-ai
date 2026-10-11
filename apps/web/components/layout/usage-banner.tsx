'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, formatCount } from '@/lib/utils';
import type { UsageView } from '@/types/api';

const LABELS: Record<string, string> = {
  leads: 'leads',
  ai_requests: 'AI requests',
  messages: 'messages',
};

/** The point at which running out becomes worth interrupting someone for. */
const WARN_AT = 0.8;

/**
 * Warns before an allowance runs out, rather than letting the first sign be a
 * refused action in the middle of a campaign.
 *
 * Shows the single most-used allowance. Dismissing hides it for that metric
 * until it crosses the next threshold — a warning dismissed at 80% comes back
 * at 100%, because "nearly out" and "out" are different facts.
 */
export function UsageBanner({ usage }: { usage: UsageView | undefined }) {
  const [dismissed, setDismissed] = React.useState<string | null>(null);

  const worst = React.useMemo(() => {
    const candidates = (usage?.quotas ?? []).filter((quota) => quota.pct >= WARN_AT);
    return candidates.sort((a, b) => b.pct - a.pct)[0];
  }, [usage]);

  if (!usage || !worst) return null;

  const exhausted = worst.remaining <= 0;
  const key = `${usage.period}:${worst.metric}:${exhausted ? 'out' : 'low'}`;
  if (dismissed === key) return null;

  const label = LABELS[worst.metric] ?? worst.metric;

  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-xs',
        exhausted ? 'border-destructive/30 bg-destructive/10' : 'border-warning/30 bg-warning/10',
      )}
    >
      <AlertTriangle
        className={cn('size-4 shrink-0', exhausted ? 'text-destructive' : 'text-warning')}
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-pretty">
        {exhausted ? (
          <>
            <span className="font-semibold">This month’s {label} are used up.</span> Anything that
            needs more will be refused until the allowance resets next month.
          </>
        ) : (
          <>
            <span className="font-semibold">
              {formatCount(worst.remaining)} {label} left this month
            </span>{' '}
            of {formatCount(worst.limit)}.
          </>
        )}
      </p>
      <Button variant="secondary" size="xs" asChild>
        <Link href="/dashboard/settings/billing">See plans</Link>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss this notice"
        onClick={() => setDismissed(key)}
      >
        <X />
      </Button>
    </div>
  );
}
