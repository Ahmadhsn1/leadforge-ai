'use client';

import * as React from 'react';
import Link from 'next/link';
import { BarChart3, Download } from 'lucide-react';
import { PageHeader, PageShell, Section } from '@/components/layout/page-header';
import { MetricRow, MetricTile } from '@/components/ui/metric';
import { PipelineFunnel } from '@/components/analytics/funnel';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CardSkeleton, EmptyState, ErrorState, MetricSkeleton } from '@/components/ui/states';
import { Reveal } from '@/components/ui/motion';
import { useAnalyticsOverview, useCampaigns } from '@/lib/queries';
import { formatCount } from '@/lib/utils';

const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
] as const;

export default function AnalyticsPage() {
  const [range, setRange] = React.useState<string>('30');
  const [campaignId, setCampaignId] = React.useState<string>('all');

  const campaigns = useCampaigns({ pageSize: 100 });

  const from = React.useMemo(() => {
    if (range === 'all') return undefined;
    const date = new Date();
    date.setDate(date.getDate() - Number(range));
    return date.toISOString();
  }, [range]);

  const { data, isLoading, isError, error, refetch, isFetching } = useAnalyticsOverview({
    from,
    campaignId: campaignId === 'all' ? undefined : campaignId,
  });

  return (
    <PageShell wide className="space-y-5">
      <PageHeader
        title="Analytics"
        description="What the pipeline is producing, and where prospects stop moving."
        actions={
          <>
            <Select value={campaignId} onValueChange={setCampaignId}>
              <SelectTrigger size="sm" className="w-[200px]">
                <SelectValue placeholder="All campaigns" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All campaigns</SelectItem>
                {campaigns.data?.items.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger size="sm" className="w-[150px]">
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
            <Button variant="secondary" size="sm" asChild>
              <a href="/api/analytics/export">
                <Download aria-hidden="true" />
                Export
              </a>
            </Button>
          </>
        }
      />

      {isLoading ? (
        <>
          <MetricSkeleton count={6} />
          <CardSkeleton className="h-72" />
        </>
      ) : isError ? (
        <div className="panel">
          <ErrorState
            description={error.userMessage}
            onRetry={() => refetch()}
            retrying={isFetching}
          />
        </div>
      ) : data ? (
        <>
          <MetricRow columns={6}>
            <MetricTile
              label="Verification rate"
              value={data.rates.verification}
              format="percent"
              hint="Of discovered businesses"
            />
            <MetricTile
              label="Qualification rate"
              value={data.rates.qualification}
              format="percent"
              hint="Of verified leads"
            />
            <MetricTile
              label="Message approval"
              value={data.rates.messageApproval}
              format="percent"
              hint="Drafts you approved"
            />
            <MetricTile
              label="Reply rate"
              value={data.rates.reply}
              format="percent"
              tone="primary"
              hint="Of contacted"
            />
            <MetricTile
              label="Positive replies"
              value={data.rates.positiveReply}
              format="percent"
              tone="success"
              hint="Of replies"
            />
            <MetricTile
              label="Win rate"
              value={data.rates.win}
              format="percent"
              tone="success"
              hint="Of meetings"
            />
          </MetricRow>

          <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
            <Reveal>
              <Section
                title="Funnel"
                description="Click any stage to see the leads behind the number."
              >
                <div className="panel p-2">
                  <PipelineFunnel points={data.funnel} />
                </div>
              </Section>
            </Reveal>

            <Reveal delay={70}>
              <Section title="Workspace totals">
                <div className="panel divide-y divide-border">
                  <TotalRow
                    label="Campaigns"
                    value={data.totals.campaigns}
                    detail={`${data.totals.activeCampaigns} active`}
                  />
                  <TotalRow label="Leads" value={data.totals.leads} href="/dashboard/leads" />
                  <TotalRow
                    label="Messages sent"
                    value={data.totals.messagesSent}
                    href="/dashboard/outreach?tab=sent"
                  />
                  <TotalRow
                    label="Conversations"
                    value={data.totals.conversations}
                    detail={`${data.totals.openConversations} open`}
                    href="/dashboard/conversations"
                  />
                  <TotalRow
                    label="Median time to reply"
                    value={data.medianTimeToReplyHours}
                    detail="hours"
                    raw
                  />
                </div>
              </Section>
            </Reveal>
          </div>

          <p className="text-2xs text-muted-foreground">
            Generated {new Date(data.generatedAt).toLocaleString('en-GB')}. Rates are computed from
            stored events, not estimates.
          </p>
        </>
      ) : (
        <div className="panel">
          <EmptyState
            icon={<BarChart3 />}
            title="No analytics yet"
            description="Run a campaign and analytics will populate as leads move through the pipeline."
            action={
              <Button variant="primary" size="sm" asChild>
                <Link href="/dashboard/campaigns/new">Create campaign</Link>
              </Button>
            }
          />
        </div>
      )}
    </PageShell>
  );
}

function TotalRow({
  label,
  value,
  detail,
  href,
  raw,
}: {
  label: string;
  value: number | null;
  detail?: string;
  href?: string;
  raw?: boolean;
}) {
  const content = (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <span className="text-sm">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="tabular text-md font-semibold">
          {value === null ? '—' : raw ? value.toFixed(1) : formatCount(value)}
        </span>
        {detail ? <span className="text-2xs text-muted-foreground">{detail}</span> : null}
      </span>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-colors hover:bg-muted/40">
      {content}
    </Link>
  ) : (
    content
  );
}
