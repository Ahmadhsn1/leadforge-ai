'use client';

import * as React from 'react';
import Link from 'next/link';
import { MapPin, MoreHorizontal, Pause, Play, Settings2, Star } from 'lucide-react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Progress,
  Tooltip,
} from '@/components/ui/primitives';
import { HoverLift } from '@/components/ui/motion';
import { formatCount, relativeTime } from '@/lib/utils';
import type { CampaignStatus } from '@leadforge/shared';
import type { CampaignSummary } from '@/types/api';

export const CAMPAIGN_STATUS_META: Record<
  CampaignStatus,
  {
    label: string;
    tone: 'default' | 'primary' | 'success' | 'warning' | 'destructive' | 'info';
    pulse?: boolean;
  }
> = {
  draft: { label: 'Draft', tone: 'default' },
  queued: { label: 'Queued', tone: 'info', pulse: true },
  running: { label: 'Running', tone: 'primary', pulse: true },
  paused: { label: 'Paused', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'destructive' },
  archived: { label: 'Archived', tone: 'default' },
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const meta = CAMPAIGN_STATUS_META[status];
  const variant = (
    {
      default: 'default',
      primary: 'primary',
      success: 'success',
      warning: 'warning',
      destructive: 'destructive',
      info: 'info',
    } as const
  )[meta.tone];
  return (
    <Badge variant={variant} className="gap-1.5">
      <StatusDot tone={meta.tone} pulse={meta.pulse} />
      {meta.label}
    </Badge>
  );
}

/** Short human summary of the campaign's qualification criteria. */
export function criteriaSummary(campaign: CampaignSummary): string[] {
  const filters = campaign.filters as {
    minRating?: number;
    minReviews?: number;
    websiteCondition?: string;
    socialCondition?: string;
  };
  const parts: string[] = [];
  if (filters.minRating) parts.push(`${filters.minRating.toFixed(1)}★+`);
  if (filters.minReviews) parts.push(`${filters.minReviews}+ reviews`);
  if (filters.websiteCondition === 'without') parts.push('No website');
  if (filters.websiteCondition === 'broken') parts.push('Broken website');
  if (filters.websiteCondition === 'with') parts.push('Has website');
  if (filters.socialCondition === 'with_instagram') parts.push('On Instagram');
  return parts;
}

export function CampaignCard({
  campaign,
  onAction,
  busy,
}: {
  campaign: CampaignSummary;
  onAction?: (action: 'start' | 'pause' | 'resume') => void;
  busy?: boolean;
}) {
  const run = campaign.latestRun;
  const limit = run?.leadLimit ?? campaign.target.leadLimit;
  const processed = run ? run.leadsCreated : campaign.stats.leads;
  const pct = limit > 0 ? Math.min(100, (processed / limit) * 100) : 0;
  const isActive = campaign.status === 'running' || campaign.status === 'queued';
  const criteria = criteriaSummary(campaign);

  return (
    <HoverLift className="h-full rounded-lg">
      <article className="group flex h-full flex-col rounded-lg border border-border bg-surface transition-colors duration-200 hover:border-border-strong">
        <div className="flex items-start gap-3 p-4 pb-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/dashboard/campaigns/${campaign.id}`}
                className="truncate text-md font-semibold tracking-tight transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                {campaign.name}
              </Link>
              <CampaignStatusBadge status={campaign.status} />
            </div>
            <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {campaign.target.geo.location}
                {campaign.target.categories.length > 0
                  ? ` · ${campaign.target.categories.slice(0, 2).join(', ')}`
                  : ''}
              </span>
            </p>
            {criteria.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1">
                {criteria.map((item) => (
                  <li key={item}>
                    <Badge variant="outline" className="gap-1">
                      {item.includes('★') ? (
                        <Star className="size-2.5 fill-current" aria-hidden="true" />
                      ) : null}
                      {item.replace('★', '')}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {onAction ? (
              <Tooltip content={isActive ? 'Pause this campaign' : 'Start processing'}>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  loading={busy}
                  onClick={() =>
                    onAction(isActive ? 'pause' : campaign.status === 'paused' ? 'resume' : 'start')
                  }
                  aria-label={isActive ? 'Pause campaign' : 'Start campaign'}
                >
                  {isActive ? <Pause /> : <Play />}
                </Button>
              </Tooltip>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`More actions for ${campaign.name}`}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/campaigns/${campaign.id}`}>Open campaign</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/leads?campaignId=${campaign.id}`}>View leads</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/campaigns/${campaign.id}?tab=analytics`}>Analytics</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/campaigns/${campaign.id}?tab=settings`}>
                    <Settings2 />
                    Settings
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Progress */}
        <div className="px-4 pb-3">
          <div className="flex items-baseline justify-between gap-2 text-2xs">
            <span className="text-muted-foreground">
              {isActive ? (
                <span className="capitalize text-primary">
                  {run?.stage.replace(/_/g, ' ')} in progress
                </span>
              ) : (
                'Leads processed'
              )}
            </span>
            <span className="tabular font-medium">
              {formatCount(processed)}{' '}
              <span className="text-muted-foreground">/ {formatCount(limit)}</span>
            </span>
          </div>
          <Progress
            value={pct}
            className="mt-1.5"
            tone={campaign.status === 'failed' ? 'destructive' : isActive ? 'primary' : 'success'}
            aria-label={`${Math.round(pct)}% of the lead target processed`}
          />
        </div>

        {/* Outcome metrics */}
        <dl className="mt-auto grid grid-cols-4 divide-x divide-border border-t border-border text-center">
          <MiniStat
            label="Qualified"
            value={campaign.stats.qualified}
            href={`/dashboard/leads?campaignId=${campaign.id}&status=qualified`}
          />
          <MiniStat
            label="High intent"
            value={campaign.stats.highIntent}
            href={`/dashboard/leads?campaignId=${campaign.id}&temperature=hot`}
          />
          <MiniStat
            label="Replies"
            value={campaign.stats.replied}
            href="/dashboard/conversations"
          />
          <MiniStat
            label="Meetings"
            value={campaign.stats.meetings}
            href={`/dashboard/leads?campaignId=${campaign.id}&status=meeting`}
          />
        </dl>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-2xs text-muted-foreground">
          <span>Last activity {relativeTime(campaign.stats.lastActivityAt)}</span>
          <span className="capitalize">{campaign.channel}</span>
        </div>
      </article>
    </HoverLift>
  );
}

function MiniStat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link
      href={href}
      className="group/stat px-2 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <dd className="tabular text-md font-semibold leading-none">{formatCount(value, true)}</dd>
      <dt className="mt-1 text-2xs text-muted-foreground">{label}</dt>
    </Link>
  );
}
