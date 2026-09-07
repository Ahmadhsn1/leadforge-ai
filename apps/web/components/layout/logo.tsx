import { cn } from '@/lib/utils';

/**
 * LeadForge mark: a forged chevron cut from a rounded square. Uses the theme's
 * accent gradient so it reads as part of the system in both modes.
 */
export function Logo({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={cn('shrink-0', className)}
      role="img"
      aria-label="LeadForge"
    >
      <defs>
        <linearGradient id="lf-mark" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="hsl(var(--primary))" />
          <stop offset="1" stopColor="hsl(var(--accent))" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#lf-mark)" />
      <path
        d="M11 9.5v13h9.5"
        stroke="hsl(var(--primary-foreground))"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 16h4.5"
        stroke="hsl(var(--primary-foreground))"
        strokeWidth="2.75"
        strokeLinecap="round"
        opacity="0.75"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Logo size={22} />
      <span className="text-[15px] font-semibold tracking-tight">
        LeadForge
        <span className="ml-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary align-middle">
          AI
        </span>
      </span>
    </span>
  );
}
