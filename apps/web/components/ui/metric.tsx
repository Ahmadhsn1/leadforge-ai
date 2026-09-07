'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react';
import { AnimatedNumber } from './motion';
import { cn, formatCount } from '@/lib/utils';

/**
 * A metric module, not a card. Metrics sit in a hairline grid so a row of five
 * reads as one instrument panel rather than five competing boxes.
 */
export function MetricTile({
  label,
  value,
  changePct,
  hint,
  href,
  format = 'count',
  tone = 'default',
  invertChange = false,
  className,
}: {
  label: string;
  value: number | string | null | undefined;
  /** Period-over-period change as a fraction, e.g. 0.184 for +18.4%. */
  changePct?: number | null;
  hint?: string;
  href?: string;
  format?: 'count' | 'percent' | 'raw';
  tone?: 'default' | 'primary' | 'success' | 'warning';
  /** When true, a decrease is good (e.g. failure rate). */
  invertChange?: boolean;
  className?: string;
}) {
  const display =
    typeof value === 'string'
      ? value
      : format === 'percent'
        ? value === null || value === undefined
          ? '—'
          : `${(value * 100).toFixed(1)}%`
        : formatCount(value, true);

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow truncate">{label}</span>
        {href ? (
          <ArrowRight
            className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span
          className={cn(
            'tabular text-2xl font-semibold leading-none tracking-tight',
            tone === 'primary' && 'text-primary',
            tone === 'success' && 'text-success',
            tone === 'warning' && 'text-warning',
          )}
        >
          {/* Numeric metrics count up so a changed value is noticeable. */}
          {typeof value === 'number' && format === 'count' ? (
            <AnimatedNumber value={value} format={(v) => formatCount(Math.round(v), true)} />
          ) : (
            display
          )}
        </span>
        {changePct !== undefined && changePct !== null ? (
          <TrendIndicator value={changePct} invert={invertChange} />
        ) : null}
      </div>
      {hint ? <p className="mt-1 truncate text-2xs text-muted-foreground">{hint}</p> : null}
    </>
  );

  const classes = cn(
    'group block bg-surface p-4 transition-colors duration-200 ease-out',
    href &&
      'cursor-pointer hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
    className,
  );

  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

/** Row container that renders metrics as one hairline-divided panel. */
export function MetricRow({
  children,
  columns = 5,
  className,
}: {
  children: React.ReactNode;
  columns?: 3 | 4 | 5 | 6;
  className?: string;
}) {
  const cols = {
    3: 'sm:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
    5: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
    6: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6',
  }[columns];
  return (
    <div
      className={cn(
        'grid gap-px overflow-hidden rounded-lg border border-border bg-border',
        cols,
        className,
      )}
    >
      {children}
    </div>
  );
}

function TrendIndicator({ value, invert }: { value: number; invert: boolean }) {
  const flat = Math.abs(value) < 0.001;
  const up = value > 0;
  const good = invert ? !up : up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const label = flat
    ? 'no change'
    : `${up ? 'up' : 'down'} ${Math.abs(value * 100).toFixed(1)} percent`;

  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-0.5 text-2xs font-medium',
        flat ? 'text-muted-foreground' : good ? 'text-success' : 'text-destructive',
      )}
      title={`Versus the previous period: ${label}`}
    >
      <Icon className="size-3" aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{flat ? '—' : `${Math.abs(value * 100).toFixed(1)}%`}</span>
    </span>
  );
}
