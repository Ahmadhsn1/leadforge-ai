'use client';

import * as React from 'react';
import { AlertTriangle, Check, Circle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* Skeletons                                                                  */
/* -------------------------------------------------------------------------- */

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton h-4 w-full', className)} aria-hidden="true" {...props} />;
}

/** Skeleton matching the shape of a metric tile row. */
export function MetricSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2 bg-surface p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton matching the leads table so the layout does not shift on load. */
export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-border" aria-busy="true" aria-label="Loading results">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={c}
              className={cn('h-4', c === 0 ? 'w-1/4 min-w-32' : 'w-16')}
              style={{ animationDelay: `${(r * columns + c) * 12}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('panel space-y-3 p-4', className)} aria-busy="true">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty / error                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Empty states always explain what belongs here and offer the next action —
 * never a blank panel.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact = false,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-6 py-8' : 'gap-3 px-6 py-14',
        className,
      )}
    >
      {icon ? (
        <div
          className="flex size-10 items-center justify-center rounded-lg border border-border bg-raised text-muted-foreground [&_svg]:size-[18px]"
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <h3 className="text-md font-semibold tracking-tight">{title}</h3>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground text-pretty">
            {description}
          </p>
        ) : null}
      </div>
      {action || secondaryAction ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Errors state the cause and offer a recovery path (rule: error-recovery).
 */
export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  retrying = false,
  action,
  className,
  compact = false,
}: {
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        compact ? 'px-6 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <div
        className="flex size-10 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10 text-destructive"
        aria-hidden="true"
      >
        <AlertTriangle className="size-[18px]" />
      </div>
      <div className="space-y-1">
        <h3 className="text-md font-semibold tracking-tight">{title}</h3>
        {description ? (
          <p className="mx-auto max-w-md text-sm text-muted-foreground text-pretty">
            {description}
          </p>
        ) : null}
      </div>
      {onRetry || action ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying}>
              {retrying ? null : <RefreshCw aria-hidden="true" />}
              Try again
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Process feedback                                                           */
/* -------------------------------------------------------------------------- */

export type StepState = 'pending' | 'active' | 'complete' | 'failed' | 'skipped';

export interface ProcessStep {
  readonly key: string;
  readonly label: string;
  readonly state: StepState;
  readonly detail?: string;
}

/**
 * Named progress for multi-stage AI/pipeline work. Long operations must say
 * what they are doing rather than showing an undifferentiated spinner.
 */
export function ProcessTimeline({
  steps,
  orientation = 'vertical',
  className,
}: {
  steps: readonly ProcessStep[];
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}) {
  if (orientation === 'horizontal') {
    return (
      <ol className={cn('flex flex-wrap items-center gap-x-1 gap-y-2', className)}>
        {steps.map((step, index) => (
          <li key={step.key} className="flex items-center gap-1">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-2xs font-medium',
                step.state === 'complete' && 'border-success/25 bg-success/10 text-success',
                step.state === 'active' && 'border-primary/30 bg-primary/10 text-primary',
                step.state === 'failed' &&
                  'border-destructive/30 bg-destructive/10 text-destructive',
                (step.state === 'pending' || step.state === 'skipped') &&
                  'border-border bg-muted/60 text-muted-foreground',
              )}
            >
              <StepIcon state={step.state} />
              {step.label}
            </span>
            {index < steps.length - 1 ? (
              <span className="h-px w-3 bg-border" aria-hidden="true" />
            ) : null}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <ol className={cn('space-y-0', className)}>
      {steps.map((step, index) => (
        <li key={step.key} className="relative flex gap-3 pb-3 last:pb-0">
          {index < steps.length - 1 ? (
            <span
              className={cn(
                'absolute left-[7px] top-5 h-[calc(100%-12px)] w-px',
                step.state === 'complete' ? 'bg-success/40' : 'bg-border',
              )}
              aria-hidden="true"
            />
          ) : null}
          <span className="relative mt-0.5 shrink-0">
            <StepIcon state={step.state} size="md" />
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'text-sm leading-tight',
                step.state === 'active' && 'font-medium text-foreground',
                step.state === 'complete' && 'text-foreground',
                step.state === 'failed' && 'font-medium text-destructive',
                (step.state === 'pending' || step.state === 'skipped') && 'text-muted-foreground',
              )}
            >
              {step.label}
            </p>
            {step.detail ? (
              <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{step.detail}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepIcon({ state, size = 'sm' }: { state: StepState; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'size-3' : 'size-4';
  if (state === 'complete') {
    return (
      <span
        className={cn(
          'flex items-center justify-center rounded-full bg-success/15 text-success',
          size === 'sm' ? 'size-3.5' : 'size-4',
        )}
        aria-label="Complete"
      >
        <Check className={cn(box, 'p-px')} strokeWidth={3} aria-hidden="true" />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span
        className={cn(
          'flex items-center justify-center rounded-full bg-primary/15 text-primary',
          size === 'sm' ? 'size-3.5' : 'size-4',
        )}
        aria-label="In progress"
      >
        <Loader2 className={cn(box, 'animate-spin p-px')} aria-hidden="true" />
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span
        className={cn(
          'flex items-center justify-center rounded-full bg-destructive/15 text-destructive',
          size === 'sm' ? 'size-3.5' : 'size-4',
        )}
        aria-label="Failed"
      >
        <AlertTriangle className={cn(box, 'p-px')} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'flex items-center justify-center rounded-full border border-border text-muted-foreground',
        size === 'sm' ? 'size-3.5' : 'size-4',
      )}
      aria-label={state === 'skipped' ? 'Skipped' : 'Not started'}
    >
      <Circle className="size-1.5 fill-current" aria-hidden="true" />
    </span>
  );
}

/** Three-dot indicator for streaming AI output. */
export function StreamingDots({
  className,
  label = 'Generating',
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}
    >
      <span className="flex gap-0.5" aria-hidden="true">
        <span className="size-1 animate-stream-dot rounded-full bg-primary" />
        <span className="size-1 animate-stream-dot rounded-full bg-primary [animation-delay:150ms]" />
        <span className="size-1 animate-stream-dot rounded-full bg-primary [animation-delay:300ms]" />
      </span>
      <span>{label}</span>
    </span>
  );
}
