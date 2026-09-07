'use client';

import * as React from 'react';
import { MetricRow, MetricTile } from '@/components/ui/metric';
import { PipelineFunnel } from './funnel';
import { PipelineTimeseries } from './charts';
import { Section } from '@/components/layout/page-header';
import { Reveal } from '@/components/ui/motion';
import { EmptyState } from '@/components/ui/states';
import { formatPercent } from '@/lib/utils';
import type { CampaignAnalyticsView } from '@/types/api';

/** Analytics for a single campaign: rates, funnel, trend and angle performance. */
export function CampaignAnalytics({ data }: { data: CampaignAnalyticsView }) {
  const { rates } = data.overview;

  return (
    <div className="space-y-5">
      <MetricRow columns={6}>
        <MetricTile
          label="Verification rate"
          value={rates.verification}
          format="percent"
          hint="Of discovered leads"
        />
        <MetricTile
          label="Qualification rate"
          value={rates.qualification}
          format="percent"
          hint="Of verified leads"
        />
        <MetricTile
          label="Reply rate"
          value={rates.reply}
          format="percent"
          hint="Of contacted leads"
          tone="primary"
        />
        <MetricTile
          label="Positive replies"
          value={rates.positiveReply}
          format="percent"
          hint="Of replies"
          tone="success"
        />
        <MetricTile
          label="Meeting rate"
          value={rates.meeting}
          format="percent"
          hint="Of positive replies"
        />
        <MetricTile
          label="Win rate"
          value={rates.win}
          format="percent"
          hint="Of meetings"
          tone="success"
        />
      </MetricRow>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Reveal>
          <PipelineTimeseries data={data.timeseries} />
        </Reveal>
        <Reveal delay={80}>
          <Section title="Funnel">
            <div className="panel p-2">
              <PipelineFunnel points={data.overview.funnel} interactive={false} />
            </div>
          </Section>
        </Reveal>
      </div>

      <Section
        title="Best-performing angles"
        description="Measured from real replies. Use these to steer the next campaign's offer."
      >
        {data.angles.length > 0 ? (
          <div className="panel divide-y divide-border">
            {data.angles.map((angle) => (
              <div key={angle.angle} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 text-sm text-pretty">{angle.angle}</span>
                <dl className="flex items-center gap-4 text-2xs text-muted-foreground">
                  <div className="text-right">
                    <dt>Sent</dt>
                    <dd className="tabular font-medium text-foreground">{angle.sent}</dd>
                  </div>
                  <div className="text-right">
                    <dt>Replied</dt>
                    <dd className="tabular font-medium text-foreground">{angle.replied}</dd>
                  </div>
                  <div className="text-right">
                    <dt>Positive</dt>
                    <dd className="tabular font-medium text-foreground">{angle.positive}</dd>
                  </div>
                </dl>
                <span
                  className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-muted"
                  aria-hidden="true"
                >
                  <span
                    className="block h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
                    style={{ width: `${Math.min(100, angle.replyRate * 100)}%` }}
                  />
                </span>
                <span className="tabular w-14 shrink-0 text-right text-sm font-semibold">
                  {formatPercent(angle.replyRate, 0)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="panel">
            <EmptyState
              compact
              title="No angle data yet"
              description="Angle performance appears once messages have been sent and replies recorded."
            />
          </div>
        )}
      </Section>
    </div>
  );
}
