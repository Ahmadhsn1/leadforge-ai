'use client';

import * as React from 'react';
import { temperatureForScore, type Temperature } from '@leadforge/shared';
import { cn } from '@/lib/utils';

const TEMPERATURE_META: Record<
  Temperature,
  { label: string; stroke: string; text: string; bg: string; border: string }
> = {
  hot: {
    label: 'High priority',
    stroke: 'stroke-hot',
    text: 'text-hot',
    bg: 'bg-hot/10',
    border: 'border-hot/30',
  },
  warm: {
    label: 'Strong fit',
    stroke: 'stroke-warm',
    text: 'text-warm',
    bg: 'bg-warm/10',
    border: 'border-warm/30',
  },
  moderate: {
    label: 'Moderate',
    stroke: 'stroke-moderate',
    text: 'text-moderate',
    bg: 'bg-moderate/10',
    border: 'border-moderate/30',
  },
  low: {
    label: 'Low priority',
    stroke: 'stroke-cold',
    text: 'text-cold',
    bg: 'bg-muted',
    border: 'border-border',
  },
  unscored: {
    label: 'Not scored',
    stroke: 'stroke-cold',
    text: 'text-muted-foreground',
    bg: 'bg-muted',
    border: 'border-border',
  },
};

export function temperatureMeta(temperature: Temperature) {
  return TEMPERATURE_META[temperature];
}

/**
 * Circular score gauge. The number is the message; the ring is supporting
 * context, so the value stays legible at every size and the colour is always
 * paired with a text label (never colour alone).
 */
export function ScoreRing({
  score,
  size = 'md',
  showLabel = true,
  className,
}: {
  score: number | null | undefined;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showLabel?: boolean;
  className?: string;
}) {
  const temperature = temperatureForScore(score);
  const meta = TEMPERATURE_META[temperature];
  const value = typeof score === 'number' ? Math.max(0, Math.min(100, score)) : 0;

  const dims = {
    sm: { box: 36, stroke: 3, text: 'text-xs', label: 'text-[9px]' },
    md: { box: 56, stroke: 4, text: 'text-lg', label: 'text-2xs' },
    lg: { box: 88, stroke: 5, text: 'text-3xl', label: 'text-2xs' },
    xl: { box: 128, stroke: 6, text: 'text-5xl', label: 'text-xs' },
  }[size];

  const radius = (dims.box - dims.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - value / 100);

  return (
    <div
      className={cn('inline-flex flex-col items-center gap-1', className)}
      role="img"
      aria-label={
        typeof score === 'number'
          ? `Lead score ${value} out of 100, ${meta.label}`
          : 'Lead not yet scored'
      }
    >
      <div className="relative" style={{ width: dims.box, height: dims.box }}>
        <svg width={dims.box} height={dims.box} className="-rotate-90" aria-hidden="true">
          <circle
            cx={dims.box / 2}
            cy={dims.box / 2}
            r={radius}
            fill="none"
            strokeWidth={dims.stroke}
            className="stroke-border"
          />
          <circle
            cx={dims.box / 2}
            cy={dims.box / 2}
            r={radius}
            fill="none"
            strokeWidth={dims.stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={cn(meta.stroke, 'transition-[stroke-dashoffset] duration-700 ease-out')}
          />
        </svg>
        <span
          className={cn(
            'tabular absolute inset-0 flex items-center justify-center font-semibold tracking-tight',
            dims.text,
            typeof score === 'number' ? meta.text : 'text-muted-foreground',
          )}
        >
          {typeof score === 'number' ? Math.round(value) : '—'}
        </span>
      </div>
      {showLabel ? (
        <span className={cn('font-semibold uppercase tracking-wide', dims.label, meta.text)}>
          {meta.label}
        </span>
      ) : null}
    </div>
  );
}

/** Compact inline score used in table rows: number + temperature word. */
export function ScoreChip({
  score,
  className,
  showLabel = true,
}: {
  score: number | null | undefined;
  className?: string;
  showLabel?: boolean;
}) {
  const temperature = temperatureForScore(score);
  const meta = TEMPERATURE_META[temperature];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5',
        meta.bg,
        meta.border,
        className,
      )}
    >
      <span className={cn('tabular text-xs font-semibold leading-none', meta.text)}>
        {typeof score === 'number' ? Math.round(score) : '—'}
      </span>
      {showLabel ? (
        <span
          className={cn('text-2xs font-medium uppercase leading-none tracking-wide', meta.text)}
        >
          {temperature === 'unscored' ? 'n/a' : temperature}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Horizontal bar for one score dimension. Shows the number as well as the bar
 * so the value is readable without relying on length perception.
 */
export function DimensionBar({
  label,
  value,
  reason,
  className,
}: {
  label: string;
  value: number;
  reason?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="tabular text-xs font-semibold">{Math.round(clamped)}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
      {reason ? <p className="text-2xs text-muted-foreground text-pretty">{reason}</p> : null}
    </div>
  );
}

/**
 * Confidence indicator. Confidence is central to trust in this product, so it
 * is always shown as a number plus a qualitative word — never a bare colour.
 */
export function ConfidenceMeter({
  value,
  size = 'sm',
  className,
}: {
  /** 0–1 */
  value: number;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const band = pct >= 80 ? 'High' : pct >= 55 ? 'Moderate' : 'Low';
  const tone = pct >= 80 ? 'text-success' : pct >= 55 ? 'text-warning' : 'text-muted-foreground';
  const barTone = pct >= 80 ? 'bg-success' : pct >= 55 ? 'bg-warning' : 'bg-muted-foreground';

  return (
    <div
      className={cn('flex items-center gap-2', className)}
      title={`${band} confidence (${pct}%)`}
    >
      <div
        className={cn('h-1 overflow-hidden rounded-full bg-muted', size === 'sm' ? 'w-10' : 'w-16')}
        aria-hidden="true"
      >
        <div className={cn('h-full rounded-full', barTone)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn('tabular whitespace-nowrap text-2xs font-medium', tone)}>
        {band} · {pct}%
      </span>
    </div>
  );
}
