'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { PageHeader, PageShell, Section } from '@/components/layout/page-header';
import { MetricRow, MetricTile } from '@/components/ui/metric';
import { CostByTaskChart, LatencyChart, ModelMixChart } from '@/components/analytics/charts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/primitives';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CardSkeleton, EmptyState, ErrorState, MetricSkeleton } from '@/components/ui/states';
import { Reveal } from '@/components/ui/motion';
import { useAiUsage, useUsage } from '@/lib/queries';
import { cn, formatCount, formatMs, formatUsd, titleCase } from '@/lib/utils';

const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'This billing period' },
  { value: '90', label: 'Last 90 days' },
] as const;

export default function UsagePage() {
  const [range, setRange] = React.useState('30');

  const from = React.useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - Number(range));
    return date.toISOString();
  }, [range]);

  const ai = useAiUsage({ from });
  const usage = useUsage();

  return (
    <PageShell wide className="space-y-5">
      <PageHeader
        title="AI usage"
        description="Which models the router chose, what they cost, and how reliable they were."
        actions={
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger size="sm" className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {/* Plan quotas */}
      <Section title="Plan quotas" description="Usage resets at the start of each billing period.">
        {usage.isLoading ? (
          <CardSkeleton className="h-32" />
        ) : usage.data ? (
          <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
            {usage.data.quotas.map((quota) => {
              const critical = quota.pct >= 0.9;
              const warning = quota.pct >= 0.75 && !critical;
              return (
                <div key={quota.metric} className="bg-surface p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="eyebrow">{titleCase(quota.metric)}</span>
                    <span
                      className={cn('tabular text-2xs', critical && 'font-medium text-destructive')}
                    >
                      {Math.round(quota.pct * 100)}%
                    </span>
                  </div>
                  <p className="tabular mt-1.5 text-xl font-semibold">
                    {formatCount(quota.used, true)}
                    <span className="text-sm font-normal text-muted-foreground">
                      {' '}
                      / {formatCount(quota.limit, true)}
                    </span>
                  </p>
                  <Progress
                    value={quota.pct * 100}
                    tone={critical ? 'destructive' : warning ? 'warning' : 'primary'}
                    className="mt-2"
                    aria-label={`${titleCase(quota.metric)}: ${Math.round(quota.pct * 100)}% of quota used`}
                  />
                  {critical ? (
                    <p className="mt-1.5 flex items-start gap-1 text-2xs text-destructive">
                      <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden="true" />
                      <span className="text-pretty">
                        Nearly exhausted. New work will be rejected once the quota is reached.
                      </span>
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </Section>

      {/* AI metrics */}
      {ai.isLoading ? (
        <MetricSkeleton count={5} />
      ) : ai.isError ? (
        <div className="panel">
          <ErrorState description={ai.error.userMessage} onRetry={() => ai.refetch()} />
        </div>
      ) : ai.data && ai.data.requests > 0 ? (
        <>
          <MetricRow columns={6}>
            <MetricTile label="Requests" value={ai.data.requests} />
            <MetricTile
              label="Failures"
              value={ai.data.failures}
              tone={ai.data.failures > 0 ? 'warning' : 'default'}
              hint={`${((ai.data.failures / Math.max(1, ai.data.requests)) * 100).toFixed(1)}% failure rate`}
              invertChange
            />
            <MetricTile label="Input tokens" value={ai.data.inputTokens} />
            <MetricTile label="Output tokens" value={ai.data.outputTokens} />
            <MetricTile
              label="Avg latency"
              value={formatMs(ai.data.avgLatencyMs)}
              format="raw"
              hint={`p95 ${formatMs(ai.data.p95LatencyMs)}`}
            />
            <MetricTile
              label="Estimated cost"
              value={formatUsd(ai.data.estimatedCostUsd)}
              format="raw"
              tone="primary"
              hint="Based on published model pricing"
            />
          </MetricRow>

          <div className="grid gap-4 lg:grid-cols-2">
            <Reveal>
              <ModelMixChart data={ai.data.byModel} />
            </Reveal>
            <Reveal delay={70}>
              <LatencyChart data={ai.data.byModel} />
            </Reveal>
            <Reveal delay={140} className="lg:col-span-2">
              <CostByTaskChart data={ai.data.byTask} />
            </Reveal>
          </div>

          <Section
            title="By model"
            description="Every model the router selected, with its real cost and reliability."
          >
            <div className="panel overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  AI usage by model: requests, tokens, latency, failures and estimated cost.
                </caption>
                <thead>
                  <tr className="border-b border-border bg-raised/60 text-left">
                    {[
                      'Model',
                      'Provider',
                      'Requests',
                      'Input',
                      'Output',
                      'Avg latency',
                      'Failures',
                      'Cost',
                    ].map((header) => (
                      <th key={header} scope="col" className="whitespace-nowrap px-3 py-2">
                        <span className="eyebrow">{header}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ai.data.byModel.map((row) => (
                    <tr key={`${row.provider}-${row.model}`} className="hover:bg-muted/40">
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs">{row.model}</span>
                        {row.model.endsWith(':free') ? (
                          <Badge variant="success" className="ml-1.5">
                            Free tier
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 capitalize text-muted-foreground">{row.provider}</td>
                      <td className="tabular px-3 py-2">{formatCount(row.requests)}</td>
                      <td className="tabular px-3 py-2 text-muted-foreground">
                        {formatCount(row.inputTokens, true)}
                      </td>
                      <td className="tabular px-3 py-2 text-muted-foreground">
                        {formatCount(row.outputTokens, true)}
                      </td>
                      <td className="tabular px-3 py-2">{formatMs(row.avgLatencyMs)}</td>
                      <td className={cn('tabular px-3 py-2', row.failures > 0 && 'text-warning')}>
                        {row.failures}
                      </td>
                      <td className="tabular px-3 py-2 font-medium">
                        {formatUsd(row.estimatedCostUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="By task">
            <div className="panel divide-y divide-border">
              {ai.data.byTask.map((task) => (
                <div
                  key={task.task}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="text-sm capitalize">{task.task.replace(/_/g, ' ')}</span>
                  <span className="flex items-baseline gap-3">
                    <span className="tabular text-2xs text-muted-foreground">
                      {formatCount(task.requests)} requests
                    </span>
                    <span className="tabular text-sm font-medium">
                      {formatUsd(task.estimatedCostUsd)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Section>
        </>
      ) : (
        <div className="panel">
          <EmptyState
            icon={<Sparkles />}
            title="No AI usage recorded"
            description="Every gateway call records its provider, model, tokens, latency and cost. Run an analysis and the breakdown appears here."
            action={
              <Button variant="secondary" size="sm" asChild>
                <Link href="/dashboard/settings/integrations">Check the AI integration</Link>
              </Button>
            }
          />
        </div>
      )}
    </PageShell>
  );
}
