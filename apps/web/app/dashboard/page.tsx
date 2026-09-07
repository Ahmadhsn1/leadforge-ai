'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  Inbox,
  Lightbulb,
  Plus,
  Sparkles,
  Target,
  Upload,
} from 'lucide-react';
import { PageHeader, PageShell, Section } from '@/components/layout/page-header';
import { MetricRow, MetricTile } from '@/components/ui/metric';
import { PipelineFunnel } from '@/components/analytics/funnel';
import { CampaignCard } from '@/components/campaigns/campaign-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  CardSkeleton,
  EmptyState,
  ErrorState,
  MetricSkeleton,
  Skeleton,
} from '@/components/ui/states';
import { ProvenanceTag } from '@/components/intelligence/trust';
import { ACTIVITY_LABELS } from '@leadforge/shared';
import { useDashboard } from '@/lib/queries';
import { Reveal, Stagger, HoverLift } from '@/components/ui/motion';
import { cn, formatCount, relativeTime } from '@/lib/utils';
import type { CampaignSummary, DashboardInsight } from '@/types/api';

export default function DashboardPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useDashboard();

  return (
    <PageShell wide className="space-y-6">
      <PageHeader
        size="lg"
        title={
          isLoading ? (
            <Skeleton className="h-7 w-72" />
          ) : (
            <>
              {greeting()}, {data?.greetingName ?? 'there'}
            </>
          )
        }
        description={
          isLoading
            ? undefined
            : describePipeline(data?.metrics.qualifiedLeads.value ?? 0, data?.attention)
        }
        actions={
          <>
            <Button variant="secondary" size="md" asChild>
              <Link href="/dashboard/leads/import">
                <Upload aria-hidden="true" />
                Import leads
              </Link>
            </Button>
            <Button variant="primary" size="md" asChild>
              <Link href="/dashboard/campaigns/new">
                <Plus aria-hidden="true" />
                Create campaign
              </Link>
            </Button>
          </>
        }
      />

      {isError ? (
        <div className="panel">
          <ErrorState
            description={error.userMessage}
            onRetry={() => refetch()}
            retrying={isFetching}
          />
        </div>
      ) : null}

      {/* Attention bar — what needs a human right now, before any metrics. */}
      {data?.attention ? <AttentionBar attention={data.attention} /> : null}

      {/* KPIs */}
      {isLoading ? (
        <MetricSkeleton />
      ) : data ? (
        <MetricRow columns={5}>
          <MetricTile
            label="Qualified leads"
            value={data.metrics.qualifiedLeads.value}
            changePct={data.metrics.qualifiedLeads.changePct}
            hint="Passed your campaign filters"
            href="/dashboard/leads?status=qualified"
          />
          <MetricTile
            label="Verified"
            value={data.metrics.verified.value}
            changePct={data.metrics.verified.changePct}
            hint="Identity and contact checks passed"
            href="/dashboard/leads?verificationStatus=verified"
          />
          <MetricTile
            label="High intent"
            value={data.metrics.highIntent.value}
            changePct={data.metrics.highIntent.changePct}
            hint="Score 90+"
            tone="primary"
            href="/dashboard/leads?temperature=hot"
          />
          <MetricTile
            label="Replies"
            value={data.metrics.replies.value}
            changePct={data.metrics.replies.changePct}
            hint="Inbound messages received"
            href="/dashboard/conversations"
          />
          <MetricTile
            label="Meetings"
            value={data.metrics.meetings.value}
            changePct={data.metrics.meetings.changePct}
            hint="Booked from outreach"
            tone="success"
            href="/dashboard/leads?status=meeting"
          />
        </MetricRow>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Funnel */}
        <Section
          title="Pipeline"
          description="Where prospects are, and where they stall."
          className="xl:col-span-1"
          actions={
            <Button variant="ghost" size="xs" asChild>
              <Link href="/dashboard/analytics">
                Analytics
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          }
        >
          <div className="panel p-2">
            {isLoading ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton key={i} className="h-6" />
                ))}
              </div>
            ) : data && data.funnel.some((p) => p.count > 0) ? (
              <Reveal>
                <PipelineFunnel points={data.funnel} />
              </Reveal>
            ) : (
              <EmptyState
                compact
                icon={<Target />}
                title="No pipeline yet"
                description="Launch a campaign and discovered businesses will start flowing through these stages."
                action={
                  <Button size="sm" variant="primary" asChild>
                    <Link href="/dashboard/campaigns/new">Create campaign</Link>
                  </Button>
                }
              />
            )}
          </div>
        </Section>

        {/* AI insights */}
        <Section
          title={
            <span className="flex items-center gap-2">
              AI intelligence
              <ProvenanceTag provenance="inferred" />
            </span>
          }
          description="Patterns the analysis pipeline found across your prospect base."
          className="xl:col-span-2"
        >
          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : data && data.insights.length > 0 ? (
            <Stagger className="grid gap-3 sm:grid-cols-2" step={50}>
              {data.insights.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}
            </Stagger>
          ) : (
            <div className="panel">
              <EmptyState
                icon={<Brain />}
                title="Not enough analysed leads yet"
                description="Once the intelligence stage has run over a few dozen businesses, recurring opportunities and the angles that work best will appear here."
                action={
                  <Button size="sm" variant="secondary" asChild>
                    <Link href="/dashboard/campaigns">Review campaigns</Link>
                  </Button>
                }
              />
            </div>
          )}
        </Section>
      </div>

      {/* Active campaigns */}
      <ActiveCampaigns campaigns={data?.activeCampaigns} isLoading={isLoading} />

      {/* Recent activity */}
      <Section
        title="Recent activity"
        description="Every state change in the pipeline, newest first."
      >
        <div className="panel divide-y divide-border">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-4 rounded-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))
          ) : data && data.recentActivity.length > 0 ? (
            data.recentActivity.map((activity) => (
              <div key={activity.id} className="flex items-start gap-3 px-4 py-2.5">
                <Badge variant="outline" className="mt-0.5 shrink-0">
                  {ACTIVITY_LABELS[activity.type] ?? activity.type}
                </Badge>
                <p className="min-w-0 flex-1 text-sm text-pretty">
                  {activity.leadId && activity.leadName ? (
                    <Link
                      href={`/dashboard/leads/${activity.leadId}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {activity.leadName}
                    </Link>
                  ) : null}{' '}
                  <span className="text-muted-foreground">{activity.summary}</span>
                </p>
                <time
                  className="shrink-0 text-2xs text-muted-foreground"
                  dateTime={activity.createdAt}
                >
                  {relativeTime(activity.createdAt)}
                </time>
              </div>
            ))
          ) : (
            <EmptyState
              compact
              title="Nothing has happened yet"
              description="Discovery, verification and AI analysis events will appear here as campaigns run."
            />
          )}
        </div>
      </Section>
    </PageShell>
  );
}

function ActiveCampaigns({
  campaigns,
  isLoading,
}: {
  campaigns: CampaignSummary[] | undefined;
  isLoading: boolean;
}) {
  return (
    <Section
      title="Active campaigns"
      description="Running and recently completed prospecting runs."
      actions={
        <Button variant="ghost" size="xs" asChild>
          <Link href="/dashboard/campaigns">
            All campaigns
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      }
    >
      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} className="h-52" />
          ))}
        </div>
      ) : campaigns && campaigns.length > 0 ? (
        <Stagger className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3" step={60}>
          {campaigns.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} />
          ))}
        </Stagger>
      ) : (
        <div className="panel surface-gradient">
          <EmptyState
            icon={<Target />}
            title="No campaigns yet"
            description="Build your first prospecting campaign — pick an industry and area, set your quality bar, and LeadForge will find, verify and rank the businesses worth contacting."
            action={
              <Button variant="primary" asChild>
                <Link href="/dashboard/campaigns/new">
                  <Plus aria-hidden="true" />
                  Create campaign
                </Link>
              </Button>
            }
            secondaryAction={
              <Button variant="ghost" asChild>
                <Link href="/dashboard/leads/import">Import a CSV instead</Link>
              </Button>
            }
          />
        </div>
      )}
    </Section>
  );
}

function InsightCard({ insight }: { insight: DashboardInsight }) {
  const icon = {
    opportunity: Lightbulb,
    industry: Target,
    angle: Sparkles,
    action: ArrowRight,
  }[insight.kind];
  const Icon = icon;

  const body = (
    <>
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md border',
            insight.kind === 'action'
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-border bg-raised text-muted-foreground',
          )}
          aria-hidden="true"
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{insight.label}</p>
          <p className="mt-1 text-md font-semibold leading-snug tracking-tight text-balance">
            {insight.value}
          </p>
          {insight.detail ? (
            <p className="mt-1 text-xs text-muted-foreground text-pretty">{insight.detail}</p>
          ) : null}
        </div>
        {insight.count !== null ? (
          <span className="tabular shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-2xs font-semibold">
            {formatCount(insight.count, true)}
          </span>
        ) : null}
      </div>
    </>
  );

  return insight.href ? (
    <HoverLift className="h-full rounded-lg">
      <Link
        href={insight.href}
        className="group block h-full rounded-lg border border-border bg-surface p-3.5 transition-colors hover:border-border-strong hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {body}
      </Link>
    </HoverLift>
  ) : (
    <div className="h-full rounded-lg border border-border bg-surface p-3.5">{body}</div>
  );
}

function AttentionBar({
  attention,
}: {
  attention: {
    needsHumanConversations: number;
    pendingApprovals: number;
    failedJobs: number;
    integrationsNeedingSetup: string[];
  };
}) {
  const items: {
    label: string;
    count: number;
    href: string;
    tone: 'primary' | 'warning' | 'destructive';
  }[] = [];
  if (attention.needsHumanConversations > 0) {
    items.push({
      label: 'conversations need a human',
      count: attention.needsHumanConversations,
      href: '/dashboard/conversations?status=needs_human',
      tone: 'warning',
    });
  }
  if (attention.pendingApprovals > 0) {
    items.push({
      label: 'messages waiting for approval',
      count: attention.pendingApprovals,
      href: '/dashboard/outreach',
      tone: 'primary',
    });
  }
  if (attention.failedJobs > 0) {
    items.push({
      label: 'jobs failed permanently',
      count: attention.failedJobs,
      href: '/dashboard/settings/health',
      tone: 'destructive',
    });
  }

  if (items.length === 0 && attention.integrationsNeedingSetup.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-raised px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-xs font-medium">
        <Inbox className="size-3.5 text-muted-foreground" aria-hidden="true" />
        Needs attention
      </span>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-2xs font-medium transition-colors',
            item.tone === 'primary' &&
              'border-primary/25 bg-primary/10 text-primary hover:bg-primary/15',
            item.tone === 'warning' &&
              'border-warning/25 bg-warning/10 text-warning hover:bg-warning/15',
            item.tone === 'destructive' &&
              'border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15',
          )}
        >
          <span className="tabular font-semibold">{item.count}</span>
          {item.label}
        </Link>
      ))}
      {attention.integrationsNeedingSetup.length > 0 ? (
        <Link
          href="/dashboard/settings/integrations"
          className="inline-flex items-center gap-1.5 rounded-sm border border-warning/25 bg-warning/10 px-2 py-1 text-2xs font-medium text-warning transition-colors hover:bg-warning/15"
        >
          <AlertTriangle className="size-3" aria-hidden="true" />
          {attention.integrationsNeedingSetup.join(', ')} not configured
        </Link>
      ) : null}
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function describePipeline(
  qualified: number,
  attention?: { needsHumanConversations: number; pendingApprovals: number },
): string {
  if (qualified === 0)
    return 'No qualified prospects yet. Launch a campaign to start building your pipeline.';
  if (attention && attention.needsHumanConversations > 0) {
    return `${formatCount(qualified)} qualified prospects, and ${attention.needsHumanConversations} conversations are waiting on you.`;
  }
  if (attention && attention.pendingApprovals > 0) {
    return `${formatCount(qualified)} qualified prospects. ${attention.pendingApprovals} messages are ready for your review.`;
  }
  return `${formatCount(qualified)} qualified prospects in your pipeline.`;
}
