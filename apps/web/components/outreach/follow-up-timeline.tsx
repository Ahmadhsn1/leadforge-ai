'use client';

import * as React from 'react';
import Link from 'next/link';
import { Ban, CalendarClock, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardSkeleton, EmptyState } from '@/components/ui/states';
import { titleCase } from '@/lib/utils';
import type { SequenceView } from '@/types/api';

const STOP_CONDITIONS = [
  'They reply',
  'A positive outcome is recorded',
  'They opt out',
  'The lead is marked do-not-contact',
  'The lead is closed (won or lost)',
  'The campaign is paused',
] as const;

/**
 * Visual follow-up plan. Timing is relative to the previous step, and the
 * conditions that stop the sequence are shown alongside — a sequence you
 * cannot see stopping is a sequence you cannot trust.
 */
export function FollowUpTimeline({
  sequence,
  loading,
}: {
  sequence: SequenceView | null;
  loading?: boolean;
}) {
  if (loading) return <CardSkeleton className="h-40" />;

  if (!sequence) {
    return (
      <div className="panel">
        <EmptyState
          compact
          icon={<CalendarClock />}
          title="No sequence for this channel"
          description="Without a sequence, an approved message sends once and stops. Create one to schedule follow-ups automatically."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href="/dashboard/settings/outreach">Create a sequence</Link>
            </Button>
          }
        />
      </div>
    );
  }

  let cumulativeHours = 0;

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{sequence.name}</h3>
          {sequence.description ? (
            <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
              {sequence.description}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant={sequence.active ? 'success' : 'default'}>
            {sequence.active ? 'Active' : 'Paused'}
          </Badge>
          {sequence.activeRuns > 0 ? (
            <Badge variant="primary" className="tabular">
              {sequence.activeRuns} running
            </Badge>
          ) : null}
        </div>
      </div>

      <ol className="mt-4 space-y-0">
        {sequence.steps.map((step, index) => {
          cumulativeHours += step.delayHours;
          const label =
            index === 0
              ? 'Today'
              : cumulativeHours < 48
                ? `+${cumulativeHours} hours`
                : `+${Math.round(cumulativeHours / 24)} days`;

          return (
            <li key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
              {index < sequence.steps.length - 1 ? (
                <span
                  className="absolute left-[11px] top-6 h-[calc(100%-16px)] w-px bg-border"
                  aria-hidden="true"
                />
              ) : null}
              <span
                className="tabular relative flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-raised text-2xs font-semibold text-muted-foreground"
                aria-hidden="true"
              >
                {step.order}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="text-sm font-medium">{titleCase(step.kind)}</p>
                  <span className="tabular text-2xs text-muted-foreground">{label}</span>
                </div>
                {step.guidance ? (
                  <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
                    {step.guidance}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 border-t border-border pt-3">
        <p className="eyebrow mb-1.5 flex items-center gap-1.5">
          <Ban className="size-3" aria-hidden="true" />
          The sequence stops when
        </p>
        <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {STOP_CONDITIONS.map((condition) => (
            <li key={condition} className="flex items-start gap-1.5 text-2xs text-muted-foreground">
              <Check className="mt-0.5 size-3 shrink-0 text-success" aria-hidden="true" />
              <span className="text-pretty">{condition}</span>
            </li>
          ))}
        </ul>
      </div>

      <Button variant="ghost" size="xs" className="mt-3" asChild>
        <Link href="/dashboard/settings/outreach">Edit sequences</Link>
      </Button>
    </div>
  );
}
