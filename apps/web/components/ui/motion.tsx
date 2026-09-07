'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Motion system.
 *
 * Every animation here communicates state or spatial relationship: content
 * arriving, a value changing, a surface responding to a pointer. Nothing
 * animates purely for decoration, and everything collapses to its final state
 * under `prefers-reduced-motion`.
 */

/** True when the viewer has asked for reduced motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/** Fires once when the element first enters the viewport. */
export function useInView<T extends HTMLElement>(options?: {
  rootMargin?: string;
  threshold?: number;
  once?: boolean;
}): [React.RefObject<T | null>, boolean] {
  const ref = React.useRef<T>(null);
  const [inView, setInView] = React.useState(false);
  const { rootMargin = '0px 0px -8% 0px', threshold = 0.08, once = true } = options ?? {};

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // No IntersectionObserver (or no motion wanted): show immediately.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin, threshold },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin, threshold, once]);

  return [ref, inView];
}

type RevealDirection = 'up' | 'down' | 'left' | 'right' | 'none';

/**
 * Reveals content as it scrolls into view. Direction encodes hierarchy:
 * content entering from below reads as "deeper in the page".
 */
export function Reveal({
  children,
  as: Component = 'div',
  direction = 'up',
  delay = 0,
  distance = 12,
  duration = 420,
  className,
  ...rest
}: {
  children: React.ReactNode;
  as?: React.ElementType;
  direction?: RevealDirection;
  /** Milliseconds. Use with index for a stagger. */
  delay?: number;
  distance?: number;
  duration?: number;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>();

  const offset = reduced
    ? 'none'
    : {
        up: `translate3d(0, ${distance}px, 0)`,
        down: `translate3d(0, -${distance}px, 0)`,
        left: `translate3d(${distance}px, 0, 0)`,
        right: `translate3d(-${distance}px, 0, 0)`,
        none: 'none',
      }[direction];

  return (
    <Component
      ref={ref}
      className={cn('will-change-[opacity,transform]', className)}
      style={{
        opacity: inView || reduced ? 1 : 0,
        transform: inView || reduced ? 'none' : offset,
        transition: reduced
          ? 'none'
          : `opacity ${duration}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
      }}
      {...rest}
    >
      {children}
    </Component>
  );
}

/**
 * Staggers the entrance of a list or grid. Children arrive in sequence so the
 * eye follows the reading order instead of everything appearing at once.
 */
export function Stagger({
  children,
  className,
  step = 45,
  initialDelay = 0,
  direction = 'up',
  as: Component = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  /** Milliseconds between each child. */
  step?: number;
  initialDelay?: number;
  direction?: RevealDirection;
  as?: React.ElementType;
}) {
  const items = React.Children.toArray(children);
  return (
    <Component className={className}>
      {items.map((child, index) => (
        <Reveal
          key={(React.isValidElement(child) && child.key) || index}
          direction={direction}
          // Cap the delay so a long list does not take seconds to appear.
          delay={initialDelay + Math.min(index, 12) * step}
        >
          {child}
        </Reveal>
      ))}
    </Component>
  );
}

/**
 * Animates a number to its new value. Score and metric changes are meaningful
 * events, so the transition draws the eye to what moved.
 */
export function AnimatedNumber({
  value,
  duration = 700,
  format = (v: number) => Math.round(v).toLocaleString('en-GB'),
  className,
}: {
  value: number;
  duration?: number;
  format?: (value: number) => string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = React.useState(value);
  const fromRef = React.useRef(value);
  const frameRef = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    if (reduced) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }

    const from = fromRef.current;
    const delta = value - from;
    if (delta === 0) return;

    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      // Ease-out cubic: fast start, gentle arrival.
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(from + delta * eased);
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      fromRef.current = value;
    };
  }, [value, duration, reduced]);

  return <span className={cn('tabular', className)}>{format(display)}</span>;
}

/**
 * Card that lifts and tilts very slightly toward the pointer. The effect is
 * deliberately small — it should read as responsiveness, not as a gimmick —
 * and it uses transform only, so it never causes layout shift.
 */
export function HoverLift({
  children,
  className,
  intensity = 'subtle',
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  intensity?: 'subtle' | 'none';
} & React.HTMLAttributes<HTMLDivElement>) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);

  const handleMove = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (reduced || intensity === 'none') return;
      const element = ref.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      // Normalised pointer position, used by the CSS spotlight.
      element.style.setProperty(
        '--pointer-x',
        `${((event.clientX - rect.left) / rect.width) * 100}%`,
      );
      element.style.setProperty(
        '--pointer-y',
        `${((event.clientY - rect.top) / rect.height) * 100}%`,
      );
    },
    [reduced, intensity],
  );

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      className={cn(
        'group/lift relative transition-[transform,box-shadow,border-color] duration-200 ease-out',
        !reduced && intensity !== 'none' && 'hover:-translate-y-0.5 hover:shadow-raised',
        className,
      )}
      {...rest}
    >
      {/* Pointer-following highlight; purely presentational. */}
      {!reduced && intensity !== 'none' ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover/lift:opacity-100"
          style={{
            background:
              'radial-gradient(220px circle at var(--pointer-x, 50%) var(--pointer-y, 50%), hsl(var(--primary) / 0.07), transparent 65%)',
          }}
        />
      ) : null}
      {children}
    </div>
  );
}

/**
 * Cross-fades content when a key changes, e.g. switching tabs or filters.
 * Keeps the container height so the page does not jump.
 */
export function CrossFade({
  contentKey,
  children,
  className,
  duration = 180,
}: {
  contentKey: string | number;
  children: React.ReactNode;
  className?: string;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const [visible, setVisible] = React.useState(true);
  const [rendered, setRendered] = React.useState(children);
  const keyRef = React.useRef(contentKey);

  React.useEffect(() => {
    if (keyRef.current === contentKey) {
      setRendered(children);
      return;
    }
    keyRef.current = contentKey;
    if (reduced) {
      setRendered(children);
      return;
    }
    setVisible(false);
    const timer = setTimeout(() => {
      setRendered(children);
      setVisible(true);
    }, duration);
    return () => clearTimeout(timer);
  }, [contentKey, children, reduced, duration]);

  return (
    <div
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transition: reduced ? 'none' : `opacity ${duration}ms ease-out`,
      }}
    >
      {rendered}
    </div>
  );
}

/**
 * Thin progress bar pinned to the top of the viewport while a background
 * fetch is running. Communicates "working" without blocking the UI.
 */
export function RouteProgress({ active }: { active: boolean }) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (active) {
      // Only show for work that actually takes a moment, so quick requests
      // do not produce a distracting flash.
      const timer = setTimeout(() => setVisible(true), 220);
      return () => clearTimeout(timer);
    }
    setVisible(false);
  }, [active]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-toast h-0.5 overflow-hidden"
      role="status"
      aria-label="Loading"
    >
      <div className="h-full w-1/3 animate-progress-indeterminate rounded-full bg-gradient-to-r from-primary to-accent" />
    </div>
  );
}

/** Wraps page content in a short entrance so navigation feels intentional. */
export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('animate-fade-up', className)}>{children}</div>;
}
