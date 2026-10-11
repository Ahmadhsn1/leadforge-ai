'use client';

import * as React from 'react';
import { Check, Minus } from 'lucide-react';
import { AnimatedNumber, useInView, useReducedMotion } from '@/components/ui/motion';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* Spotlight                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A section whose background glow follows the pointer.
 *
 * The light moves; nothing else does. Content stays exactly where it is, so
 * there is no element drifting toward the cursor and no target to chase.
 */
export function SpotlightSection({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLElement>(null);

  const onMove = (event: React.MouseEvent<HTMLElement>) => {
    const element = ref.current;
    if (!element || reduced) return;
    const rect = element.getBoundingClientRect();
    element.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
    element.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
  };

  return (
    <section ref={ref} onMouseMove={onMove} className={cn('group/spot relative', className)}>
      <div aria-hidden="true" className="mk-grid pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover/spot:opacity-100"
        style={{
          background:
            'radial-gradient(520px circle at var(--spot-x, 50%) var(--spot-y, 0%), hsl(var(--primary) / 0.13), transparent 70%)',
        }}
      />
      <div className="relative">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Count-up figures                                                            */
/* -------------------------------------------------------------------------- */

/** A figure that counts up from zero the first time it scrolls into view. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>({ threshold: 0.4 });
  return (
    <span ref={ref} className={className}>
      <AnimatedNumber value={inView ? value : 0} duration={900} />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Comparison                                                                  */
/* -------------------------------------------------------------------------- */

export interface ComparisonRow {
  readonly aspect: string;
  readonly typical: string;
  readonly leadforge: string;
}

/**
 * The same six questions answered two ways. A switch rather than a table: the
 * visitor flips between them and watches every answer change, which makes the
 * difference something they did rather than something they were told.
 */
export function ComparisonSwitch({ rows }: { rows: readonly ComparisonRow[] }) {
  const [side, setSide] = React.useState<'typical' | 'leadforge'>('leadforge');
  const ours = side === 'leadforge';

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Compare"
        className="inline-flex rounded-lg border border-border bg-surface p-1"
      >
        {(
          [
            ['typical', 'A typical lead tool'],
            ['leadforge', 'LeadForge'],
          ] as const
        ).map(([value, label]) => {
          const selected = side === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setSide(value)}
              className={cn(
                'h-11 cursor-pointer rounded-md px-4 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.97]',
                selected
                  ? value === 'leadforge'
                    ? 'bg-primary text-primary-foreground shadow-subtle'
                    : 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
        {rows.map((row, index) => (
          <li
            key={row.aspect}
            className={cn(
              'rounded-lg border p-4 transition-[border-color,background-color,transform] duration-300 ease-out hover:-translate-y-0.5',
              ours ? 'border-primary/30 bg-primary/[0.05]' : 'border-border bg-surface',
            )}
            style={{ transitionDelay: `${index * 35}ms` }}
          >
            <p className="eyebrow">{row.aspect}</p>
            <p className="mt-2 flex items-start gap-2 text-md font-medium text-pretty">
              {ours ? (
                <Check className="mt-1 size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <Minus className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className={ours ? undefined : 'text-muted-foreground'}>
                {ours ? row.leadforge : row.typical}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Score explorer                                                              */
/* -------------------------------------------------------------------------- */

const DIMENSIONS = [
  {
    id: 'fit',
    label: 'Fit',
    value: 88,
    reason:
      'A dentist in the search area, in the category this campaign targets. Computed from the listing category and the address.',
  },
  {
    id: 'opportunity',
    label: 'Opportunity',
    value: 91,
    reason:
      'No booking link was found on the site, and that is exactly what the campaign offers. Each weakness is an observation with a source.',
  },
  {
    id: 'contactability',
    label: 'Contactability',
    value: 84,
    reason:
      'A valid phone number and a working website. No email address was found, so email scores nothing here.',
  },
  {
    id: 'maturity',
    label: 'Maturity',
    value: 70,
    reason:
      'A real site on its own domain with a contact page, but no sign of an online presence beyond it.',
  },
  {
    id: 'confidence',
    label: 'Confidence',
    value: 86,
    reason:
      'Five of five verification checks passed and the evidence was gathered today. Older or thinner evidence lowers this.',
  },
  {
    id: 'urgency',
    label: 'Urgency',
    value: 62,
    reason:
      'Nothing suggests a deadline. This stays moderate unless the evidence shows a reason to act now.',
  },
] as const;

/**
 * The six numbers behind a score, each with the reason it is what it is.
 * Hovering, focusing or tapping a dimension shows its reason — the point being
 * that there is one, for every number, every time.
 */
export function ScoreExplorer() {
  const [active, setActive] = React.useState(1);
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.25 });
  const current = DIMENSIONS[active] ?? DIMENSIONS[0];

  return (
    <div ref={ref} className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr] lg:items-stretch">
      <ul className="panel divide-y divide-border">
        {DIMENSIONS.map((dimension, index) => {
          const selected = index === active;
          return (
            <li key={dimension.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onClick={() => setActive(index)}
                aria-pressed={selected}
                className={cn(
                  'flex min-h-11 w-full cursor-pointer items-center gap-4 px-4 py-3 text-left transition-colors duration-200 active:bg-primary/10',
                  selected ? 'bg-primary/[0.06]' : 'hover:bg-muted/50',
                )}
              >
                <span
                  className={cn(
                    'w-28 shrink-0 text-sm font-medium transition-colors duration-200',
                    selected ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {dimension.label}
                </span>
                <span
                  className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                  aria-hidden="true"
                >
                  <span
                    className={cn(
                      'block h-full origin-left rounded-full transition-[transform,background-color] duration-700 ease-out',
                      selected ? 'bg-primary' : 'bg-primary/45',
                    )}
                    style={{
                      width: `${dimension.value}%`,
                      transform: inView ? 'scaleX(1)' : 'scaleX(0)',
                      transitionDelay: inView ? `${index * 70}ms` : '0ms',
                    }}
                  />
                </span>
                <span className="tabular w-8 shrink-0 text-right text-sm font-semibold">
                  {dimension.value}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="panel-raised flex flex-col justify-between p-5" aria-live="polite">
        <div>
          <p className="eyebrow">
            Why {current.label.toLowerCase()} is {current.value}
          </p>
          <p key={current.id} className="mk-body mt-2 animate-fade-in text-pretty">
            {current.reason}
          </p>
        </div>
        <p className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground text-pretty">
          Illustrative figures. In the product each number is calculated in code from stored facts,
          so the same business scores the same every time.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Marquee                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A slow strip of the kinds of business a campaign can target. It pauses on
 * hover or focus, and under reduced motion it is a plain wrapped list.
 */
export function CategoryMarquee({ items }: { items: readonly string[] }) {
  return (
    <div className="mk-marquee group relative overflow-hidden" aria-label="Example categories">
      <ul className="mk-marquee-track flex w-max gap-2.5 group-hover:[animation-play-state:paused]">
        {[...items, ...items].map((item, index) => (
          <li
            key={`${item}-${index}`}
            // The second copy exists only to make the loop seamless.
            aria-hidden={index >= items.length || undefined}
            className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-muted-foreground transition-colors duration-200 hover:border-primary/40 hover:text-foreground"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
