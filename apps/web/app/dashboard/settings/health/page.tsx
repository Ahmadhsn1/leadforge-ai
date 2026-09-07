'use client';

import * as React from 'react';
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { Section } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge, StatusDot } from '@/components/ui/badge';
import { CardSkeleton, ErrorState } from '@/components/ui/states';
import { useHealth } from '@/lib/queries';
import { cn, formatCount, formatMs, titleCase } from '@/lib/utils';

/** Live service and queue status, so a stalled pipeline is visible not silent. */
export default function HealthSettingsPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useHealth();

  return (
    <div className="space-y-6">
      <Section
        title="Service health"
        description="Checked live against the API, database, Redis and each configured provider."
        actions={
          <Button variant="ghost" size="sm" onClick={() => refetch()} loading={isFetching}>
            {isFetching ? null : <RefreshCw aria-hidden="true" />}
            Refresh
          </Button>
        }
      >
        {isLoading ? (
          <CardSkeleton className="h-48" />
        ) : isError ? (
          <div className="panel">
            <ErrorState
              title="Cannot reach the API"
              description={error.userMessage}
              onRetry={() => refetch()}
              retrying={isFetching}
            />
          </div>
        ) : data ? (
          <>
            <div
              className={cn(
                'mb-3 flex items-center gap-2.5 rounded-lg border px-3.5 py-3',
                data.status === 'ok' && 'border-success/30 bg-success/10',
                data.status === 'degraded' && 'border-warning/30 bg-warning/10',
                data.status === 'down' && 'border-destructive/30 bg-destructive/10',
              )}
              role="status"
            >
              {data.status === 'ok' ? (
                <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
              ) : data.status === 'degraded' ? (
                <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden="true" />
              ) : (
                <XCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
              )}
              <p className="text-sm font-medium">
                {data.status === 'ok'
                  ? 'All services operating normally'
                  : data.status === 'degraded'
                    ? 'Running with degraded capability'
                    : 'One or more critical services are down'}
              </p>
              <span className="ml-auto font-mono text-2xs text-muted-foreground">
                v{data.version}
              </span>
            </div>

            <div className="panel divide-y divide-border">
              {data.checks.map((check) => (
                <div key={check.name} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <StatusDot
                    tone={
                      check.status === 'ok'
                        ? 'success'
                        : check.status === 'degraded'
                          ? 'warning'
                          : 'destructive'
                    }
                  />
                  <span className="min-w-0 flex-1 text-sm">{titleCase(check.name)}</span>
                  {check.detail ? (
                    <span className="min-w-0 flex-[2] truncate text-2xs text-muted-foreground">
                      {check.detail}
                    </span>
                  ) : null}
                  {check.latencyMs !== null ? (
                    <span className="tabular w-16 text-right text-2xs text-muted-foreground">
                      {formatMs(check.latencyMs)}
                    </span>
                  ) : null}
                  <Badge
                    variant={
                      check.status === 'ok'
                        ? 'success'
                        : check.status === 'degraded'
                          ? 'warning'
                          : 'destructive'
                    }
                  >
                    {titleCase(check.status)}
                  </Badge>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </Section>

      <Section
        title="Queues"
        description="Depth and failure counts per pipeline stage. A growing waiting count means workers are behind."
      >
        {isLoading ? (
          <CardSkeleton className="h-48" />
        ) : data && data.queues.length > 0 ? (
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Queue depth by pipeline stage: waiting, active, delayed, completed and failed job
                counts.
              </caption>
              <thead>
                <tr className="border-b border-border bg-raised/60 text-left">
                  {['Queue', 'Waiting', 'Active', 'Delayed', 'Completed', 'Failed'].map(
                    (header) => (
                      <th key={header} scope="col" className="px-3 py-2">
                        <span className="eyebrow">{header}</span>
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.queues.map((queue) => (
                  <tr key={queue.name} className="hover:bg-muted/40">
                    <td className="px-3 py-2 font-mono text-xs">
                      {queue.name.replace('leadforge.', '')}
                    </td>
                    <td
                      className={cn(
                        'tabular px-3 py-2',
                        queue.waiting > 100 && 'font-medium text-warning',
                      )}
                    >
                      {formatCount(queue.waiting)}
                    </td>
                    <td className="tabular px-3 py-2">{formatCount(queue.active)}</td>
                    <td className="tabular px-3 py-2 text-muted-foreground">
                      {formatCount(queue.delayed)}
                    </td>
                    <td className="tabular px-3 py-2 text-muted-foreground">
                      {formatCount(queue.completed)}
                    </td>
                    <td
                      className={cn(
                        'tabular px-3 py-2',
                        queue.failed > 0 && 'font-medium text-destructive',
                      )}
                    >
                      {formatCount(queue.failed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="panel px-4 py-6 text-center text-sm text-muted-foreground text-pretty">
            <Activity className="mx-auto mb-2 size-4" aria-hidden="true" />
            No queue statistics available. Check that Redis is reachable and the worker service is
            running.
          </div>
        )}
      </Section>
    </div>
  );
}
