'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Download, MapPin, Pause, Play, Settings2, Star } from 'lucide-react';
import { PageHeader, PageShell, Section } from '@/components/layout/page-header';
import { MetricRow, MetricTile } from '@/components/ui/metric';
import { PipelineFunnel } from '@/components/analytics/funnel';
import { CampaignStatusBadge, criteriaSummary } from '@/components/campaigns/campaign-card';
import { CampaignAnalytics } from '@/components/analytics/campaign-analytics';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import {
  CardSkeleton,
  ErrorState,
  MetricSkeleton,
  ProcessTimeline,
  Skeleton,
  type ProcessStep,
} from '@/components/ui/states';
import { Reveal } from '@/components/ui/motion';
import {
  useCampaign,
  useCampaignAction,
  useCampaignAnalytics,
  useCampaignRuns,
} from '@/lib/queries';
import { RUN_STAGES } from '@leadforge/shared';
import { formatCount, formatDateTime, relativeTime, titleCase } from '@/lib/utils';
import type { CampaignRun, CampaignSummary } from '@/types/api';
import { CampaignSettingsForm } from '@/components/campaigns/campaign-settings';
import { CampaignLeadsTab } from '@/components/campaigns/campaign-leads-tab';

const TABS = ['overview', 'leads', 'intelligence', 'outreach', 'analytics', 'settings'] as const;

export default function CampaignDetailPage() {
  const params = useParams<{ campaignId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const campaignId = params.campaignId;

  const {
    data: campaign,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useCampaign(campaignId);
  const runs = useCampaignRuns(campaignId);
  const action = useCampaignAction(campaignId);

  const tabParam = searchParams.get('tab');
  const tab = TABS.includes(tabParam as (typeof TABS)[number]) ? (tabParam as string) : 'overview';

  const setTab = (next: string) => {
    const merged = new URLSearchParams(searchParams.toString());
    merged.set('tab', next);
    router.replace(`/dashboard/campaigns/${campaignId}?${merged.toString()}`, { scroll: false });
  };

  if (isLoading) {
    return (
      <PageShell wide className="space-y-5">
        <Skeleton className="h-8 w-1/3" />
        <MetricSkeleton />
        <CardSkeleton className="h-64" />
      </PageShell>
    );
  }

  if (isError) {
    return (
      <PageShell>
        <ErrorState
          title={error.isNotFound ? 'Campaign not found' : 'Could not load this campaign'}
          description={error.isNotFound ? 'It may have been deleted.' : error.userMessage}
          onRetry={error.isNotFound ? undefined : () => refetch()}
          retrying={isFetching}
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href="/dashboard/campaigns">All campaigns</Link>
            </Button>
          }
        />
      </PageShell>
    );
  }

  if (!campaign) return null;

  const run = campaign.latestRun;
  const isActive = campaign.status === 'running' || campaign.status === 'queued';
  const criteria = criteriaSummary(campaign);

  return (
    <PageShell wide className="space-y-5">
      <PageHeader
        title={campaign.name}
        description={campaign.description ?? undefined}
        meta={
          <>
            <CampaignStatusBadge status={campaign.status} />
            <Badge variant="outline" className="gap-1">
              <MapPin className="size-2.5" aria-hidden="true" />
              {campaign.target.geo.location}
            </Badge>
            {campaign.target.categories.slice(0, 3).map((category) => (
              <Badge key={category} variant="outline" className="capitalize">
                {category}
              </Badge>
            ))}
            {criteria.map((item) => (
              <Badge key={item} variant="outline" className="gap-1">
                {item.includes('★') ? (
                  <Star className="size-2.5 fill-current" aria-hidden="true" />
                ) : null}
                {item.replace('★', '')}
              </Badge>
            ))}
            <Badge variant="primary" className="capitalize">
              {campaign.channel}
            </Badge>
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              loading={action.isPending}
              onClick={() =>
                action.mutate({
                  action: isActive ? 'pause' : campaign.status === 'paused' ? 'resume' : 'start',
                })
              }
            >
              {action.isPending ? null : isActive ? (
                <Pause aria-hidden="true" />
              ) : (
                <Play aria-hidden="true" />
              )}
              {isActive ? 'Pause' : campaign.status === 'paused' ? 'Resume' : 'Start run'}
            </Button>
            <Button variant="secondary" size="md" onClick={() => setTab('settings')}>
              <Settings2 aria-hidden="true" />
              Edit
            </Button>
            <Button variant="ghost" size="md" asChild>
              <a href={`/api/leads/export?campaignId=${campaign.id}`}>
                <Download aria-hidden="true" />
                Export
              </a>
            </Button>
          </>
        }
      />

      {run?.lastError ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium">The last run reported a problem</p>
            <p className="mt-0.5 break-anywhere text-xs text-muted-foreground">{run.lastError}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto shrink-0"
            onClick={() => action.mutate({ action: 'start' })}
          >
            Retry
          </Button>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="leads" count={campaign.stats.leads}>
            Leads
          </TabsTrigger>
          <TabsTrigger value="intelligence">Intelligence</TabsTrigger>
          <TabsTrigger value="outreach" count={campaign.stats.draftsGenerated}>
            Outreach
          </TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <CampaignOverview campaign={campaign} run={run} runs={runs.data ?? []} />
        </TabsContent>

        <TabsContent value="leads">
          <CampaignLeadsTab campaignId={campaign.id} />
        </TabsContent>

        <TabsContent value="intelligence">
          <CampaignIntelligence campaignId={campaign.id} />
        </TabsContent>

        <TabsContent value="outreach">
          <CampaignOutreach campaign={campaign} />
        </TabsContent>

        <TabsContent value="analytics">
          <CampaignAnalyticsTab campaignId={campaign.id} />
        </TabsContent>

        <TabsContent value="settings">
          <CampaignSettingsForm campaign={campaign} />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

/* -------------------------------------------------------------------------- */

function CampaignOverview({
  campaign,
  run,
  runs,
}: {
  campaign: CampaignSummary;
  run: CampaignRun | null;
  runs: CampaignRun[];
}) {
  const stats = campaign.stats;
  const limit = run?.leadLimit ?? campaign.target.leadLimit;
  const pct = limit > 0 ? Math.min(100, ((run?.leadsCreated ?? stats.leads) / limit) * 100) : 0;

  const funnel = [
    { stage: 'discovered', count: run?.candidatesDiscovered ?? stats.leads, conversion: 1 },
    { stage: 'verified', count: stats.verified, conversion: ratio(stats.verified, stats.leads) },
    {
      stage: 'qualified',
      count: stats.qualified,
      conversion: ratio(stats.qualified, stats.verified),
    },
    { stage: 'ready', count: stats.ready, conversion: ratio(stats.ready, stats.qualified) },
    { stage: 'contacted', count: stats.contacted, conversion: ratio(stats.contacted, stats.ready) },
    { stage: 'replied', count: stats.replied, conversion: ratio(stats.replied, stats.contacted) },
    { stage: 'positive', count: stats.positive, conversion: ratio(stats.positive, stats.replied) },
    { stage: 'meeting', count: stats.meetings, conversion: ratio(stats.meetings, stats.positive) },
    { stage: 'won', count: stats.won, conversion: ratio(stats.won, stats.meetings) },
  ];

  return (
    <div className="space-y-5">
      <MetricRow columns={6}>
        <MetricTile
          label="Discovered"
          value={run?.candidatesDiscovered ?? stats.leads}
          hint="Raw candidates seen"
        />
        <MetricTile
          label="Leads created"
          value={stats.leads}
          hint={`${run?.duplicatesFound ?? 0} duplicates merged`}
        />
        <MetricTile label="Verified" value={stats.verified} />
        <MetricTile label="Qualified" value={stats.qualified} tone="primary" />
        <MetricTile label="High intent" value={stats.highIntent} tone="primary" hint="Score 90+" />
        <MetricTile label="Replies" value={stats.replied} tone="success" />
      </MetricRow>

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Live pipeline */}
        <div className="panel p-4">
          <h2 className="text-sm font-semibold">Processing pipeline</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {run
              ? run.status === 'running'
                ? `Stage: ${titleCase(run.stage)}`
                : `Last run ${relativeTime(run.finishedAt ?? run.createdAt)}`
              : 'This campaign has not run yet.'}
          </p>

          {run ? (
            <>
              <Progress
                value={pct}
                className="mt-3"
                tone={
                  run.status === 'failed'
                    ? 'destructive'
                    : run.status === 'running'
                      ? 'primary'
                      : 'success'
                }
                indeterminate={run.status === 'queued'}
              />
              <p className="tabular mt-1.5 text-2xs text-muted-foreground">
                {formatCount(run.leadsCreated)} of {formatCount(run.leadLimit)} leads ·{' '}
                {formatCount(run.pagesFetched)} pages fetched
                {run.rateLimitEvents > 0 ? ` · ${run.rateLimitEvents} rate-limit pauses` : ''}
              </p>

              <div className="mt-4">
                <ProcessTimeline steps={buildStages(run)} />
              </div>
            </>
          ) : null}
        </div>

        {/* Funnel */}
        <Section
          title="Funnel"
          description="How this campaign's prospects move through the pipeline."
        >
          <Reveal>
            <div className="panel p-2">
              <PipelineFunnel points={funnel} />
            </div>
          </Reveal>
        </Section>
      </div>

      {runs.length > 0 ? (
        <Section title="Run history">
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-raised/60 text-left">
                  {[
                    'Started',
                    'Status',
                    'Discovered',
                    'Created',
                    'Duplicates',
                    'Errors',
                    'Duration',
                  ].map((header) => (
                    <th key={header} scope="col" className="px-3 py-2">
                      <span className="eyebrow">{header}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/40">
                    <td className="px-3 py-2">
                      {formatDateTime(item.startedAt ?? item.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          item.status === 'completed'
                            ? 'success'
                            : item.status === 'failed'
                              ? 'destructive'
                              : item.status === 'running'
                                ? 'primary'
                                : 'default'
                        }
                      >
                        {titleCase(item.status)}
                      </Badge>
                    </td>
                    <td className="tabular px-3 py-2">{formatCount(item.candidatesDiscovered)}</td>
                    <td className="tabular px-3 py-2">{formatCount(item.leadsCreated)}</td>
                    <td className="tabular px-3 py-2">{formatCount(item.duplicatesFound)}</td>
                    <td className="tabular px-3 py-2">{formatCount(item.errorCount)}</td>
                    <td className="tabular px-3 py-2 text-muted-foreground">{duration(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function CampaignIntelligence({ campaignId }: { campaignId: string }) {
  const { data, isLoading } = useCampaignAnalytics(campaignId);
  if (isLoading) return <CardSkeleton className="h-64" />;
  return (
    <div className="space-y-4">
      <Section
        title="Angles that get replies"
        description="Measured from sent messages, not predicted. Ranked by reply rate."
      >
        {data && data.angles.length > 0 ? (
          <div className="panel divide-y divide-border">
            {data.angles.map((angle) => (
              <div key={angle.angle} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm">{angle.angle}</span>
                <span className="tabular w-16 text-right text-2xs text-muted-foreground">
                  {angle.sent} sent
                </span>
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary transition-[width] duration-700"
                    style={{ width: `${Math.min(100, angle.replyRate * 100)}%` }}
                  />
                </span>
                <span className="tabular w-12 text-right text-sm font-semibold">
                  {(angle.replyRate * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="panel p-6 text-center text-sm text-muted-foreground text-pretty">
            No angle performance yet. Once messages from this campaign have been sent and replied
            to, the angles that work will be ranked here.
          </div>
        )}
      </Section>
    </div>
  );
}

function CampaignOutreach({ campaign }: { campaign: CampaignSummary }) {
  return (
    <div className="space-y-4">
      <MetricRow columns={4}>
        <MetricTile label="Drafts generated" value={campaign.stats.draftsGenerated} />
        <MetricTile label="Approved" value={campaign.stats.draftsApproved} />
        <MetricTile label="Contacted" value={campaign.stats.contacted} />
        <MetricTile label="Replied" value={campaign.stats.replied} tone="success" />
      </MetricRow>
      <div className="panel p-4">
        <p className="text-sm text-muted-foreground text-pretty">
          Messages generated by this campaign wait in the shared approval queue. Nothing sends until
          you approve it, and suppression is re-checked immediately before each send.
        </p>
        <Button variant="primary" size="sm" className="mt-3" asChild>
          <Link href={`/dashboard/outreach?campaignId=${campaign.id}`}>Open approval queue</Link>
        </Button>
      </div>
    </div>
  );
}

function CampaignAnalyticsTab({ campaignId }: { campaignId: string }) {
  const { data, isLoading, isError, error, refetch } = useCampaignAnalytics(campaignId);
  if (isLoading) return <CardSkeleton className="h-80" />;
  if (isError) return <ErrorState description={error.userMessage} onRetry={() => refetch()} />;
  if (!data) return null;
  return <CampaignAnalytics data={data} />;
}

/* -------------------------------------------------------------------------- */

function buildStages(run: CampaignRun): ProcessStep[] {
  const order = RUN_STAGES.filter((stage) => stage !== 'done');
  const currentIndex = order.indexOf(run.stage as (typeof order)[number]);

  const detail: Record<string, string> = {
    discovery: `${formatCount(run.candidatesDiscovered)} candidates from ${formatCount(run.pagesFetched)} pages`,
    normalization: `${formatCount(run.leadsCreated)} created, ${formatCount(run.duplicatesFound)} merged`,
    verification: `${formatCount(run.leadsVerified)} verified`,
    enrichment: `${formatCount(run.leadsEnriched)} enriched`,
    intelligence: `${formatCount(run.leadsAnalyzed)} analysed`,
    scoring: `${formatCount(run.leadsScored)} scored`,
    personalization: `${formatCount(run.draftsGenerated)} drafts written`,
  };

  return order.map((stage, index) => {
    let state: ProcessStep['state'] = 'pending';
    if (run.status === 'completed' || run.stage === 'done') state = 'complete';
    else if (index < currentIndex) state = 'complete';
    else if (index === currentIndex)
      state = run.status === 'failed' ? 'failed' : run.status === 'paused' ? 'pending' : 'active';

    return {
      key: stage,
      label: titleCase(stage === 'intelligence' ? 'AI analysis' : stage),
      state,
      detail: state === 'pending' ? undefined : detail[stage],
    };
  });
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function duration(run: CampaignRun): string {
  if (!run.startedAt) return '—';
  const end = run.finishedAt ? new Date(run.finishedAt) : new Date();
  const ms = end.getTime() - new Date(run.startedAt).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
