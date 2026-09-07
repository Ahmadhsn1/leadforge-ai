import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Standard page frame. Every screen answers the same three questions in the
 * same place: what am I looking at (title), why it matters (description),
 * what can I do (actions).
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  className,
  size = 'md',
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
  size?: 'md' | 'lg';
}) {
  return (
    <div
      className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}
    >
      <div className="min-w-0">
        <h1
          className={cn(
            'font-semibold tracking-tight text-balance',
            size === 'lg' ? 'text-2xl' : 'text-xl',
          )}
        >
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty">{description}</p>
        ) : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Consistent page padding and max width. */
export function PageShell({
  children,
  className,
  wide = false,
}: {
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 py-5 sm:px-6',
        wide ? 'max-w-[1600px]' : 'max-w-7xl',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Titled block used between page sections. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn('space-y-3', className)}>
      {title || actions ? (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title ? <h2 className="text-md font-semibold tracking-tight">{title}</h2> : null}
            {description ? (
              <p className="mt-0.5 text-sm text-muted-foreground text-pretty">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
