'use client';

import * as React from 'react';
import {
  Brain,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  Eye,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ConfidenceMeter } from '@/components/ui/score';
import { Tooltip } from '@/components/ui/primitives';
import { cn, formatDateTime, relativeTime } from '@/lib/utils';
import type { EvidenceItem } from '@/types/api';

/**
 * Epistemic status of a statement shown in the UI.
 *
 * The product's core promise is "evidence before claims", so every claim is
 * labelled with how it is known. Nothing inferred is ever presented with the
 * visual weight of something verified.
 */
export type Provenance = 'verified' | 'observed' | 'inferred' | 'unknown';

const PROVENANCE_META: Record<
  Provenance,
  { label: string; icon: React.ElementType; className: string; help: string }
> = {
  verified: {
    label: 'Verified',
    icon: ShieldCheck,
    className: 'border-success/25 bg-success/10 text-success',
    help: 'Confirmed by a deterministic check against the provider or the live website.',
  },
  observed: {
    label: 'Observed',
    icon: Eye,
    className: 'border-info/25 bg-info/10 text-info',
    help: 'Directly recorded from a source at a point in time. Not interpreted.',
  },
  inferred: {
    label: 'AI inference',
    icon: Brain,
    className: 'border-primary/25 bg-primary/10 text-primary',
    help: 'A conclusion the model drew from the listed evidence. Treat as a hypothesis.',
  },
  unknown: {
    label: 'Unknown',
    icon: CircleHelp,
    className: 'border-border bg-muted text-muted-foreground',
    help: 'No evidence either way. Shown so gaps are visible rather than silently omitted.',
  },
};

/** Small labelled chip stating how a claim is known. */
export function ProvenanceTag({
  provenance,
  className,
  showHelp = true,
}: {
  provenance: Provenance;
  className?: string;
  showHelp?: boolean;
}) {
  const meta = PROVENANCE_META[provenance];
  const Icon = meta.icon;
  const chip = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium leading-none',
        meta.className,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {meta.label}
    </span>
  );
  return showHelp ? <Tooltip content={meta.help}>{chip}</Tooltip> : chip;
}

/**
 * An expandable evidence record: what was observed, where it came from, when,
 * and how confident the system is. Collapsed it reads as a single fact; opened
 * it shows the full provenance so a rep can defend the claim on a call.
 */
export function EvidenceCard({
  evidence,
  defaultOpen = false,
  className,
}: {
  evidence: EvidenceItem;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const contentId = `evidence-${evidence.id}`;
  const stale = evidence.expiresAt ? new Date(evidence.expiresAt).getTime() < Date.now() : false;

  return (
    <div
      className={cn(
        'rounded-md border border-border bg-surface transition-colors',
        open && 'border-border-strong',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <ProvenanceTag provenance="observed" showHelp={false} className="mt-px shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug text-pretty">{evidence.statement}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
            <span className="capitalize">{evidence.source.replace(/_/g, ' ')}</span>
            <span aria-hidden="true">·</span>
            <span>{relativeTime(evidence.observedAt)}</span>
            {stale ? (
              <>
                <span aria-hidden="true">·</span>
                <Badge variant="warning" className="py-0">
                  Stale
                </Badge>
              </>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <ConfidenceMeter value={evidence.confidence} />
          <ChevronDown
            className={cn(
              'size-3.5 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </span>
      </button>

      {open ? (
        <div id={contentId} className="space-y-2.5 border-t border-border px-3 py-2.5 text-xs">
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="eyebrow">Type</dt>
              <dd className="mt-0.5 capitalize">{evidence.type.replace(/_/g, ' ')}</dd>
            </div>
            <div>
              <dt className="eyebrow">Observed at</dt>
              <dd className="mt-0.5 tabular">{formatDateTime(evidence.observedAt)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="eyebrow">Source</dt>
              <dd className="mt-0.5">
                {evidence.sourceUrl ? (
                  <a
                    href={evidence.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center gap-1 break-anywhere text-primary hover:underline"
                  >
                    {evidence.sourceUrl}
                    <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="capitalize">{evidence.source.replace(/_/g, ' ')}</span>
                )}
              </dd>
            </div>
          </dl>
          {evidence.data && Object.keys(evidence.data).length > 0 ? (
            <div>
              <dt className="eyebrow mb-1">Recorded detail</dt>
              <pre className="max-h-40 overflow-auto rounded-sm border border-border bg-background p-2 font-mono text-2xs leading-relaxed">
                {JSON.stringify(evidence.data, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * An AI-derived claim (pain point or opportunity) shown with the evidence that
 * supports it. If the model returned no evidence IDs, that absence is stated
 * explicitly rather than hidden.
 */
export function ClaimCard({
  title,
  statement,
  confidence,
  evidence,
  tone = 'pain',
  action,
  className,
}: {
  title: string;
  statement: string;
  confidence: number;
  evidence: EvidenceItem[];
  tone?: 'pain' | 'opportunity' | 'strength';
  action?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const toneStyles = {
    pain: 'border-warning/25 bg-warning/[0.06]',
    opportunity: 'border-primary/25 bg-primary/[0.06]',
    strength: 'border-success/25 bg-success/[0.06]',
  }[tone];
  const toneLabel = { pain: 'Pain point', opportunity: 'Opportunity', strength: 'Strength' }[tone];
  const toneBadge = { pain: 'warning', opportunity: 'primary', strength: 'success' } as const;

  return (
    <div className={cn('rounded-lg border p-3', toneStyles, className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={toneBadge[tone]}>{toneLabel}</Badge>
            <ProvenanceTag provenance={evidence.length > 0 ? 'inferred' : 'unknown'} />
          </div>
          <h4 className="mt-1.5 text-sm font-semibold leading-tight">{title}</h4>
        </div>
        {action}
      </div>

      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground text-pretty">
        {statement}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
        <ConfidenceMeter value={confidence} size="md" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-2xs font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={open}
        >
          {evidence.length > 0
            ? `${evidence.length} supporting ${evidence.length === 1 ? 'record' : 'records'}`
            : 'No evidence linked'}
          <ChevronDown
            className={cn('size-3 transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
      </div>

      {open ? (
        <div className="mt-2 space-y-1.5">
          {evidence.length > 0 ? (
            evidence.map((item) => <EvidenceCard key={item.id} evidence={item} />)
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground text-pretty">
              The model did not link this claim to a stored observation. Treat it as an unverified
              hypothesis and check it before using it in outreach.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The AI recommendation block. Deliberately visually distinct from factual
 * panels so the reader can tell model output from recorded data at a glance.
 */
export function AiRecommendation({
  title = 'Recommended angle',
  body,
  meta,
  action,
  className,
}: {
  title?: string;
  body: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('ai-surface rounded-lg border border-primary/25 p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="flex size-6 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <Sparkles className="size-3.5" />
          </span>
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          <ProvenanceTag provenance="inferred" />
        </div>
        {action}
      </div>
      <p className="mt-2.5 text-base leading-relaxed text-pretty">{body}</p>
      {meta ? (
        <div className="mt-2.5 border-t border-primary/15 pt-2 text-2xs text-muted-foreground">
          {meta}
        </div>
      ) : null}
    </div>
  );
}

/** Footer line stating exactly which model and prompt produced a result. */
export function AiProvenanceLine({
  provider,
  model,
  promptVersion,
  createdAt,
  className,
}: {
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  createdAt?: string | null;
  className?: string;
}) {
  if (!model) return null;
  return (
    <p
      className={cn(
        'flex flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs text-muted-foreground',
        className,
      )}
    >
      <span>Generated by</span>
      <code className="rounded-sm bg-muted px-1 py-px font-mono text-2xs">{model}</code>
      {provider ? <span>via {provider}</span> : null}
      {promptVersion ? (
        <>
          <span aria-hidden="true">·</span>
          <span>prompt {promptVersion}</span>
        </>
      ) : null}
      {createdAt ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{relativeTime(createdAt)}</span>
        </>
      ) : null}
    </p>
  );
}
