'use client';

import * as React from 'react';
import { Brain, Check, Pause, Play, Search, Send, ShieldCheck } from 'lucide-react';
import { AnimatedNumber, useInView, useReducedMotion } from '@/components/ui/motion';
import { cn } from '@/lib/utils';

/**
 * The hero's working model of the product: the four stages a lead goes
 * through, played in order and steerable by the visitor.
 *
 * It advances on a timer, pauses while the pointer or keyboard focus is inside
 * it, and stops entirely under reduced motion — where every stage simply shows
 * its finished state. All of the content is invented and labelled as such.
 */

const STAGE_MS = 5200;

const STAGES = [
  { id: 'discover', label: 'Discover', icon: Search },
  { id: 'verify', label: 'Verify', icon: ShieldCheck },
  { id: 'understand', label: 'Understand', icon: Brain },
  { id: 'write', label: 'Write', icon: Send },
] as const;

type StageId = (typeof STAGES)[number]['id'];

export function PipelineDemo() {
  const reduced = useReducedMotion();
  const [active, setActive] = React.useState(0);
  const [hovering, setHovering] = React.useState(false);
  const [stopped, setStopped] = React.useState(false);
  // Bumped on every stage change so each panel replays its entrance.
  const [run, setRun] = React.useState(0);

  // Nothing plays to an empty room: the timer also stops while the demo is
  // scrolled out of view or the tab is in the background.
  const [viewRef, inView] = useInView<HTMLElement>({ once: false, threshold: 0.3 });
  const [tabVisible, setTabVisible] = React.useState(true);
  React.useEffect(() => {
    const onChange = () => setTabVisible(document.visibilityState === 'visible');
    onChange();
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  const playing = !reduced && !hovering && !stopped && inView && tabVisible;

  React.useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      setActive((index) => (index + 1) % STAGES.length);
      setRun((value) => value + 1);
    }, STAGE_MS);
    return () => clearTimeout(timer);
  }, [playing, active, run]);

  const select = (index: number) => {
    setActive(index);
    setRun((value) => value + 1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = (active + (event.key === 'ArrowRight' ? 1 : STAGES.length - 1)) % STAGES.length;
    select(next);
    document.getElementById(`demo-tab-${STAGES[next]?.id}`)?.focus();
  };

  const stage = STAGES[active] ?? STAGES[0];

  return (
    <figure
      ref={viewRef}
      className="panel-raised overflow-hidden shadow-overlay"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocusCapture={() => setHovering(true)}
      onBlurCapture={() => setHovering(false)}
    >
      <figcaption className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="eyebrow">How a lead is researched — illustrative example</span>
        {!reduced ? (
          <button
            type="button"
            onClick={() => setStopped((value) => !value)}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={stopped ? 'Play the walkthrough' : 'Pause the walkthrough'}
            aria-pressed={stopped}
          >
            {stopped ? (
              <Play className="size-3.5" aria-hidden="true" />
            ) : (
              <Pause className="size-3.5" aria-hidden="true" />
            )}
          </button>
        ) : null}
      </figcaption>

      <div
        role="tablist"
        aria-label="Pipeline stages"
        className="grid grid-cols-4 border-b border-border"
        onKeyDown={onKeyDown}
      >
        {STAGES.map((item, index) => {
          const selected = index === active;
          return (
            <button
              key={item.id}
              id={`demo-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="demo-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => select(index)}
              className={cn(
                'group relative flex min-h-11 cursor-pointer flex-col items-center gap-1 px-1 py-3 text-xs font-medium transition-colors duration-200 active:bg-primary/10 sm:flex-row sm:justify-center sm:gap-1.5',
                selected
                  ? 'bg-primary/[0.06] text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              <item.icon
                className={cn(
                  'size-4 transition-transform duration-200 group-hover:scale-110',
                  selected && 'text-primary',
                )}
                aria-hidden="true"
              />
              {item.label}
              {/* Fills while this stage is on screen; doubles as the "which one" marker. */}
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-transparent"
              >
                {selected ? (
                  <span
                    key={`${run}-${playing}`}
                    className="block h-full origin-left bg-primary"
                    style={
                      playing
                        ? { animation: `demo-progress ${STAGE_MS}ms linear forwards` }
                        : undefined
                    }
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <div
        id="demo-panel"
        role="tabpanel"
        aria-labelledby={`demo-tab-${stage.id}`}
        className="min-h-[21rem] p-4 sm:p-5"
      >
        <StagePanel key={`${stage.id}-${run}`} stage={stage.id} animate={!reduced} />
      </div>
    </figure>
  );
}

function StagePanel({ stage, animate }: { stage: StageId; animate: boolean }) {
  if (stage === 'discover') return <DiscoverPanel animate={animate} />;
  if (stage === 'verify') return <VerifyPanel animate={animate} />;
  if (stage === 'understand') return <UnderstandPanel animate={animate} />;
  return <WritePanel animate={animate} />;
}

/** Fades and lifts a row in, `index` steps after the panel appears. */
function Row({
  index,
  animate,
  className,
  children,
}: {
  index: number;
  animate: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={className}
      style={
        animate
          ? {
              animation: 'demo-row 420ms cubic-bezier(0.22, 1, 0.36, 1) both',
              animationDelay: `${index * 140}ms`,
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

function PanelHeading({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-3.5">
      <p className="text-md font-semibold tracking-tight">{title}</p>
      <p className="mt-0.5 text-sm text-muted-foreground text-pretty">{body}</p>
    </div>
  );
}

const BUSINESSES = [
  { name: 'Harbour Street Dental', meta: 'Dentist · Bristol', note: 'Phone, website' },
  { name: 'Clifton Smile Studio', meta: 'Dentist · Bristol', note: 'Phone, website' },
  { name: 'Redland Family Dentists', meta: 'Dentist · Bristol', note: 'Phone only' },
  { name: 'Harbour St. Dental Ltd', meta: 'Same phone as the first', note: 'Merged', merged: true },
];

function DiscoverPanel({ animate }: { animate: boolean }) {
  return (
    <div>
      <PanelHeading
        title="Dentists within 8 km of Bristol"
        body="Businesses are pulled from open map data. A second listing for the same phone number is merged, not counted twice."
      />
      <ul className="space-y-2">
        {BUSINESSES.map((business, index) => (
          <li key={business.name}>
            <Row
              index={index}
              animate={animate}
              className={cn(
                'flex items-center justify-between gap-3 rounded-md border px-3 py-2',
                business.merged
                  ? 'border-dashed border-border bg-transparent text-muted-foreground'
                  : 'border-border bg-surface',
              )}
            >
              <span className="min-w-0">
                <span
                  className={cn(
                    'block truncate text-sm font-medium',
                    business.merged && 'line-through',
                  )}
                >
                  {business.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {business.meta}
                </span>
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-sm px-1.5 py-0.5 text-xs font-medium',
                  business.merged ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground',
                )}
              >
                {business.note}
              </span>
            </Row>
          </li>
        ))}
      </ul>
    </div>
  );
}

const CHECKS = [
  'Phone number is valid for the area',
  'Website answers and is secure',
  'Website belongs to this business',
  'Address is inside the search area',
  'Category matches the listing',
];

function VerifyPanel({ animate }: { animate: boolean }) {
  // Checks resolve one at a time, the way they are actually computed.
  const [done, setDone] = React.useState(animate ? 0 : CHECKS.length);

  React.useEffect(() => {
    if (!animate || done >= CHECKS.length) return;
    const timer = setTimeout(() => setDone((value) => value + 1), 520);
    return () => clearTimeout(timer);
  }, [animate, done]);

  const score = Math.round((done / CHECKS.length) * 86);

  return (
    <div>
      <PanelHeading
        title="Harbour Street Dental"
        body="Every check runs in code. A model never decides whether a business is real."
      />
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <ul className="space-y-2">
          {CHECKS.map((check, index) => {
            const passed = index < done;
            return (
              <li key={check} className="flex items-center gap-2.5 text-sm">
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-300',
                    passed
                      ? 'border-success bg-success/15 text-success'
                      : 'border-border-strong text-transparent',
                  )}
                  aria-hidden="true"
                >
                  <Check className="size-3" />
                </span>
                <span
                  className={cn(
                    'transition-colors duration-300',
                    passed ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {check}
                  <span className="sr-only">{passed ? ' — passed' : ' — checking'}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="rounded-lg border border-border bg-surface px-5 py-3 text-center">
          <p className="tabular text-4xl font-semibold tracking-tight text-success">
            <AnimatedNumber value={score} duration={420} />
          </p>
          <p className="eyebrow mt-0.5">Verification</p>
        </div>
      </div>
    </div>
  );
}

const EVIDENCE = [
  {
    label: 'Observed',
    tone: 'bg-success/15 text-success',
    text: 'No online booking link anywhere on the site.',
    source: 'Website, checked today',
  },
  {
    label: 'Observed',
    tone: 'bg-success/15 text-success',
    text: 'Contact page lists a phone number and opening hours only.',
    source: 'Website, checked today',
  },
  {
    label: 'Inferred',
    tone: 'bg-warning/15 text-warning',
    text: 'Patients probably have to phone during opening hours to book.',
    source: 'From the two observations above',
  },
  {
    label: 'Unknown',
    tone: 'bg-muted text-muted-foreground',
    text: 'Who makes purchasing decisions.',
    source: 'Not guessed',
  },
];

function UnderstandPanel({ animate }: { animate: boolean }) {
  // Starts at zero and counts up, so the score reads as a result of the rows below.
  const [score, setScore] = React.useState(animate ? 0 : 82);
  React.useEffect(() => {
    if (animate) setScore(82);
  }, [animate]);

  return (
    <div>
      <div className="mb-3.5 flex items-start justify-between gap-4">
        <div>
          <p className="text-md font-semibold tracking-tight">Why this lead is worth a message</p>
          <p className="mt-0.5 text-sm text-muted-foreground text-pretty">
            Each claim says how far to trust it, and links to where it came from.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="tabular text-3xl font-semibold tracking-tight text-hot">
            <AnimatedNumber value={score} duration={900} />
          </p>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-hot">Hot</p>
        </div>
      </div>
      <ul className="space-y-2.5">
        {EVIDENCE.map((item, index) => (
          <li key={item.text}>
            <Row index={index} animate={animate} className="flex items-start gap-2.5">
              <span
                className={cn(
                  'mt-0.5 w-[4.75rem] shrink-0 rounded-sm px-1.5 py-0.5 text-center text-xs font-semibold',
                  item.tone,
                )}
              >
                {item.label}
              </span>
              <span className="text-sm">
                {item.text}
                <span className="block text-xs text-muted-foreground">{item.source}</span>
              </span>
            </Row>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MESSAGE =
  'Hi — I was looking at your site and could not find a way to book online. I set up booking pages for independent practices. Open to a quick chat this week?';

function WritePanel({ animate }: { animate: boolean }) {
  const [typed, setTyped] = React.useState(animate ? 0 : MESSAGE.length);
  const [approved, setApproved] = React.useState(false);

  React.useEffect(() => {
    if (!animate || typed >= MESSAGE.length) return;
    const timer = setTimeout(() => setTyped((value) => Math.min(MESSAGE.length, value + 3)), 34);
    return () => clearTimeout(timer);
  }, [animate, typed]);

  const finished = typed >= MESSAGE.length;

  return (
    <div>
      <PanelHeading
        title="A draft written from those facts"
        body="Checked twice for invented claims, then left for you. Nothing is sent until you approve it."
      />
      <div className="rounded-md border border-primary/25 bg-primary/[0.06] p-3.5">
        {/* The full text is always present for assistive tech; only the visible copy types. */}
        <p className="sr-only">{MESSAGE}</p>
        <p className="min-h-[5.5rem] text-sm text-pretty" aria-hidden="true">
          {MESSAGE.slice(0, typed)}
          {!finished ? (
            <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-pulse bg-primary" />
          ) : null}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5 rounded-sm bg-success/15 px-2 py-1 font-medium text-success">
          <Check className="size-3" aria-hidden="true" />
          No guaranteed outcomes
        </span>
        <span className="flex items-center gap-1.5 rounded-sm bg-success/15 px-2 py-1 font-medium text-success">
          <Check className="size-3" aria-hidden="true" />
          Every fact traced to evidence
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3.5">
        <p className="text-sm text-muted-foreground" role="status">
          {approved
            ? 'Approved — ready to send from your own account.'
            : 'Waiting for your approval.'}
        </p>
        <button
          type="button"
          onClick={() => setApproved((value) => !value)}
          disabled={!finished}
          aria-pressed={approved}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-sm font-medium transition-[background-color,color,transform,opacity] duration-200 active:scale-[0.97] disabled:opacity-50',
            approved
              ? 'bg-success/15 text-success hover:bg-success/20'
              : 'bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          <Check className="size-4" aria-hidden="true" />
          {approved ? 'Approved' : 'Approve draft'}
        </button>
      </div>
    </div>
  );
}
