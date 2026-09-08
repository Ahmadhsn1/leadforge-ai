import { cn } from '@/lib/utils';

/**
 * The LeadForge mark.
 *
 * A funnel that distils to a single spark: many candidates go in at the mouth,
 * one qualified lead comes out. That is literally the product — discovery finds
 * hundreds, and everything after it is narrowing.
 *
 * The spark is the one element in a second colour, so the eye lands on the
 * output rather than the funnel. It stays legible at 16px because the whole
 * mark is four strokes and one solid shape.
 *
 * `unique` scopes the gradient ids. Two SVGs on one page sharing an id makes
 * the second one inherit the first one's gradient, which is invisible until a
 * theme change moves one of them.
 */
export function Logo({
  className,
  size = 24,
  unique = 'a',
}: {
  className?: string;
  size?: number;
  unique?: string;
}) {
  const body = `lf-body-${unique}`;

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
        <linearGradient id={body} x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="hsl(var(--primary))" />
          <stop offset="1" stopColor="hsl(var(--accent))" />
        </linearGradient>
      </defs>

      <rect x="1" y="1" width="30" height="30" rx="9" fill={`url(#${body})`} />

      {/*
        Fixed white rather than --primary-foreground: that token is near-black
        in dark mode, which is right for a button label and wrong for a logo.
        A mark that inverts between themes reads as two different logos, and
        white has contrast on the blue-to-cyan gradient either way.
      */}
      <path
        d="M10.2 8.8 16 15.2l5.8-6.4"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.72"
      />

      {/*
        The qualified lead. Solid white against the funnel's 72% makes the
        output the brightest thing in the mark, which is the point — a second
        accent colour was tried here and disappeared into the cyan end of the
        gradient it sits on.
      */}
      <path d="M16 17.6 19.4 21 16 24.4 12.6 21z" fill="#fff" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Logo size={22} unique="wordmark" />
      <span className="text-[15px] font-semibold tracking-tight">
        LeadForge
        <span className="ml-1 align-middle text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
          AI
        </span>
      </span>
    </span>
  );
}
