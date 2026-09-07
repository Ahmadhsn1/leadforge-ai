'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { cn, formatCount, formatPercent } from '@/lib/utils';
import type { FunnelPointView } from '@/types/api';

const STAGE_LABELS: Record<string, string> = {
  discovered: 'Discovered',
  verified: 'Verified',
  qualified: 'Qualified',
  ready: 'Ready',
  contacted: 'Contacted',
  replied: 'Replied',
  positive: 'Positive',
  meeting: 'Meeting',
  won: 'Won',
};

const STAGE_HREF: Record<string, string> = {
  discovered: '/dashboard/leads',
  verified: '/dashboard/leads?verificationStatus=verified',
  qualified: '/dashboard/leads?status=qualified',
  ready: '/dashboard/leads?status=ready',
  contacted: '/dashboard/leads?status=contacted',
  replied: '/dashboard/leads?status=replied',
  positive: '/dashboard/conversations',
  meeting: '/dashboard/leads?status=meeting',
  won: '/dashboard/leads?status=won',
};

/**
 * The pipeline funnel. Each stage is a proportional bar plus an explicit
 * conversion figure — the bar communicates shape, the number communicates
 * fact, so nothing depends on judging widths by eye.
 */
export function PipelineFunnel({
  points,
  className,
  interactive = true,
}: {
  points: FunnelPointView[];
  className?: string;
  interactive?: boolean;
}) {
  const max = Math.max(1, ...points.map((p) => p.count));

  return (
    <div className={cn('space-y-1', className)}>
      {points.map((point, index) => {
        const width = Math.max(2, (point.count / max) * 100);
        const label = STAGE_LABELS[point.stage] ?? point.stage;
        const href = STAGE_HREF[point.stage];
        const dropOff = index > 0 && point.conversion < 0.35 && point.conversion > 0;

        const row = (
          <div className="group flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/40">
            <span className="w-20 shrink-0 truncate text-xs text-muted-foreground group-hover:text-foreground">
              {label}
            </span>
            <span className="relative h-6 min-w-0 flex-1 overflow-hidden rounded-sm bg-muted/60">
              <span
                className={cn(
                  'absolute inset-y-0 left-0 rounded-sm transition-[width] duration-700 ease-out',
                  index === 0 && 'bg-primary/70',
                  index > 0 && index < 4 && 'bg-primary/55',
                  index >= 4 && index < 6 && 'bg-accent/60',
                  index >= 6 && 'bg-success/60',
                )}
                style={{ width: `${width}%` }}
              />
            </span>
            <span className="tabular w-16 shrink-0 text-right text-sm font-semibold">
              {formatCount(point.count, true)}
            </span>
            <span
              className={cn(
                'tabular w-14 shrink-0 text-right text-2xs',
                index === 0 && 'invisible',
                dropOff ? 'font-medium text-warning' : 'text-muted-foreground',
              )}
              title={
                index === 0 ? undefined : `${formatPercent(point.conversion)} of the previous stage`
              }
            >
              {index === 0 ? '' : formatPercent(point.conversion, 0)}
            </span>
          </div>
        );

        return (
          <div key={point.stage}>
            {interactive && href ? (
              <Link
                href={href}
                className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {row}
              </Link>
            ) : (
              row
            )}
            {index < points.length - 1 ? (
              <div className="flex justify-start pl-[5.5rem]" aria-hidden="true">
                <ChevronDown className="size-3 text-border-strong" />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Compact horizontal variant for campaign cards. */
export function FunnelStrip({
  points,
  className,
}: {
  points: FunnelPointView[];
  className?: string;
}) {
  const total = Math.max(1, points[0]?.count ?? 1);
  return (
    <div className={cn('space-y-1.5', className)}>
      <div
        className="flex h-1.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label="Pipeline distribution"
      >
        {points.slice(0, 6).map((point, index) => (
          <span
            key={point.stage}
            className={cn(
              'h-full transition-[width] duration-500',
              [
                'bg-primary/70',
                'bg-primary/55',
                'bg-accent/65',
                'bg-accent/50',
                'bg-success/60',
                'bg-success/45',
              ][index],
            )}
            style={{ width: `${(point.count / total) * 100}%` }}
            title={`${STAGE_LABELS[point.stage] ?? point.stage}: ${point.count}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted-foreground">
        {points.slice(0, 6).map((point) => (
          <span key={point.stage} className="tabular">
            <span className="font-medium text-foreground">{formatCount(point.count, true)}</span>{' '}
            {STAGE_LABELS[point.stage]?.toLowerCase() ?? point.stage}
          </span>
        ))}
      </div>
    </div>
  );
}
