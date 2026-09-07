'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Brain, Lightbulb, Sparkles, Target } from 'lucide-react';
import { PageHeader, PageShell, Section } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { ProvenanceTag } from '@/components/intelligence/trust';
import { HoverLift, Stagger } from '@/components/ui/motion';
import { useDashboard } from '@/lib/queries';
import { formatCount } from '@/lib/utils';

/**
 * Cross-lead patterns. This page answers "what is true across my prospect
 * base", as opposed to the per-lead intelligence page.
 */
export default function InsightsPage() {
  const { data, isLoading, isError, error, refetch } = useDashboard();

  const grouped = React.useMemo(() => {
    const insights = data?.insights ?? [];
    return {
      opportunity: insights.filter((i) => i.kind === 'opportunity'),
      industry: insights.filter((i) => i.kind === 'industry'),
      angle: insights.filter((i) => i.kind === 'angle'),
      action: insights.filter((i) => i.kind === 'action'),
    };
  }, [data]);

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            AI insights
            <ProvenanceTag provenance="inferred" />
          </span>
        }
        description="Patterns aggregated from analysed leads. These are model inferences over recorded evidence — useful for steering campaigns, not for making claims to a prospect."
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} className="h-32" />
          ))}
        </div>
      ) : isError ? (
        <div className="panel">
          <ErrorState description={error.userMessage} onRetry={() => refetch()} />
        </div>
      ) : data && data.insights.length > 0 ? (
        <>
          {grouped.action.length > 0 ? (
            <Section
              title="Do this next"
              description="The highest-leverage action based on what is in the pipeline."
            >
              <Stagger className="grid gap-3 sm:grid-cols-2" step={60}>
                {grouped.action.map((insight) => (
                  <HoverLift key={insight.id} className="rounded-lg">
                    <Link
                      href={insight.href ?? '/dashboard/leads'}
                      className="group flex items-start gap-3 rounded-lg border border-primary/25 ai-surface p-4 transition-colors hover:border-primary/40"
                    >
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary"
                        aria-hidden="true"
                      >
                        <Sparkles className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="eyebrow block">{insight.label}</span>
                        <span className="mt-1 block text-md font-semibold leading-snug tracking-tight text-balance">
                          {insight.value}
                        </span>
                        {insight.detail ? (
                          <span className="mt-1 block text-xs text-muted-foreground text-pretty">
                            {insight.detail}
                          </span>
                        ) : null}
                      </span>
                      <ArrowRight
                        className="mt-1 size-4 shrink-0 text-primary transition-transform duration-200 group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </Link>
                  </HoverLift>
                ))}
              </Stagger>
            </Section>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-3">
            <InsightGroup
              title="Most common opportunities"
              description="The gaps that recur most across analysed businesses."
              icon={<Lightbulb />}
              insights={grouped.opportunity}
              emptyMessage="Opportunities appear once the intelligence stage has run across a set of leads."
            />
            <InsightGroup
              title="Best-fit industries"
              description="Where your offer lands most often."
              icon={<Target />}
              insights={grouped.industry}
              emptyMessage="Industry patterns need leads from more than one category."
            />
            <InsightGroup
              title="Highest-performing angles"
              description="Measured from replies, not predicted."
              icon={<Brain />}
              insights={grouped.angle}
              emptyMessage="Angle performance needs sent messages and recorded replies."
            />
          </div>

          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-raised px-3.5 py-3">
            <ProvenanceTag provenance="inferred" showHelp={false} className="mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground text-pretty">
              These are aggregate inferences. Before using any of them in a message, check the
              evidence on the individual lead — the message validator will reject claims that are
              not backed by that lead's own recorded observations.
            </p>
          </div>
        </>
      ) : (
        <div className="panel surface-gradient">
          <EmptyState
            icon={<Brain />}
            title="Not enough analysed leads yet"
            description="Insights need a body of analysed businesses to find patterns in. Run a campaign through the intelligence stage and this page fills in."
            action={
              <Button variant="primary" size="sm" asChild>
                <Link href="/dashboard/campaigns/new">Create a campaign</Link>
              </Button>
            }
            secondaryAction={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/leads">Browse leads</Link>
              </Button>
            }
          />
        </div>
      )}
    </PageShell>
  );
}

function InsightGroup({
  title,
  description,
  icon,
  insights,
  emptyMessage,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  insights: {
    id: string;
    value: string;
    detail: string | null;
    count: number | null;
    href: string | null;
  }[];
  emptyMessage: string;
}) {
  const max = Math.max(1, ...insights.map((i) => i.count ?? 0));

  return (
    <section className="panel p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-muted-foreground [&_svg]:size-3.5" aria-hidden="true">
          {icon}
        </span>
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{description}</p>

      {insights.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground text-pretty">{emptyMessage}</p>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {insights.map((insight) => (
            <li key={insight.id}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {insight.href ? (
                    <Link href={insight.href} className="hover:text-primary hover:underline">
                      {insight.value}
                    </Link>
                  ) : (
                    insight.value
                  )}
                </span>
                {insight.count !== null ? (
                  <span className="tabular shrink-0 text-xs font-semibold">
                    {formatCount(insight.count, true)}
                  </span>
                ) : null}
              </div>
              {insight.count !== null ? (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
                    style={{ width: `${((insight.count ?? 0) / max) * 100}%` }}
                  />
                </div>
              ) : null}
              {insight.detail ? (
                <p className="mt-1 text-2xs text-muted-foreground text-pretty">{insight.detail}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
