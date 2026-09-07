import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium leading-none transition-colors [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted text-muted-foreground',
        outline: 'border-border-strong bg-transparent text-muted-foreground',
        primary: 'border-primary/25 bg-primary/10 text-primary',
        accent: 'border-accent/25 bg-accent/10 text-accent',
        success: 'border-success/25 bg-success/10 text-success',
        warning: 'border-warning/25 bg-warning/10 text-warning',
        destructive: 'border-destructive/25 bg-destructive/10 text-destructive',
        info: 'border-info/25 bg-info/10 text-info',
        /** Solid — reserve for the single most important state on a row. */
        solid: 'border-transparent bg-foreground text-background',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-2xs',
        md: 'px-2 py-1 text-xs',
      },
    },
    defaultVariants: { variant: 'default', size: 'sm' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Render as the single child element, e.g. to make a badge a link. */
  asChild?: boolean;
}

export function Badge({ className, variant, size, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot : 'span';
  return <Comp className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

/**
 * A small coloured dot used alongside a text label. Never the sole carrier of
 * meaning — always paired with the label (rule: color-not-only).
 */
export function StatusDot({
  tone = 'default',
  pulse = false,
  className,
}: {
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'destructive' | 'info' | 'muted';
  pulse?: boolean;
  className?: string;
}) {
  const toneClass: Record<string, string> = {
    default: 'bg-muted-foreground',
    muted: 'bg-muted-foreground/50',
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    destructive: 'bg-destructive',
    info: 'bg-info',
  };
  return (
    <span className={cn('relative flex size-1.5 shrink-0', className)} aria-hidden="true">
      {pulse ? (
        <span
          className={cn(
            'absolute inline-flex size-full animate-ping rounded-full opacity-60',
            toneClass[tone],
          )}
        />
      ) : null}
      <span className={cn('relative inline-flex size-1.5 rounded-full', toneClass[tone])} />
    </span>
  );
}

export { badgeVariants };
