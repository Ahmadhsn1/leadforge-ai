'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Search, Target } from 'lucide-react';
import { PageHeader, PageShell } from '@/components/layout/page-header';
import { CampaignCard } from '@/components/campaigns/campaign-card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { Pagination } from '@/components/ui/pagination';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { Stagger } from '@/components/ui/motion';
import { useCampaignAction, useCampaigns } from '@/lib/queries';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'draft', label: 'Drafts' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
] as const;

export default function CampaignsPage() {
  const [status, setStatus] = React.useState<string>('all');
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, error, refetch, isFetching } = useCampaigns({
    page,
    pageSize: 12,
    status: status === 'all' ? undefined : status,
    search: debouncedSearch || undefined,
  });

  return (
    <PageShell wide className="space-y-4">
      <PageHeader
        title="Campaigns"
        description="Each campaign is a research pipeline: who to look for, what counts as good, and how to reach them."
        actions={
          <Button variant="primary" size="md" asChild className="group">
            <Link href="/dashboard/campaigns/new">
              <Plus aria-hidden="true" />
              Create campaign
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={status} onValueChange={setStatus}>
          <TabsList variant="underline">
            {FILTERS.map((filter) => (
              <TabsTrigger key={filter.value} value={filter.value}>
                {filter.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="ml-auto w-full sm:w-64">
          <Label htmlFor="campaign-search" className="sr-only">
            Search campaigns
          </Label>
          <Input
            id="campaign-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by campaign name"
            leadingIcon={<Search />}
            className="h-8"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} className="h-52" />
          ))}
        </div>
      ) : isError ? (
        <div className="panel">
          <ErrorState
            description={error.userMessage}
            onRetry={() => refetch()}
            retrying={isFetching}
          />
        </div>
      ) : data && data.items.length > 0 ? (
        <>
          <Stagger className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3" step={55}>
            {data.items.map((campaign) => (
              <CampaignCardWithActions key={campaign.id} campaign={campaign} />
            ))}
          </Stagger>
          {data.totalPages > 1 ? (
            <div className="panel">
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                totalPages={data.totalPages}
                onPageChange={setPage}
                label="campaigns"
                className="border-t-0"
              />
            </div>
          ) : null}
        </>
      ) : (
        <div className="panel surface-gradient">
          <EmptyState
            icon={<Target />}
            title={debouncedSearch || status !== 'all' ? 'No campaigns match' : 'No campaigns yet'}
            description={
              debouncedSearch || status !== 'all'
                ? 'Try a different filter or clear the search.'
                : 'A campaign defines an industry, an area and a quality bar. LeadForge then finds, verifies, enriches and ranks the businesses that fit — and shows you why each one made the list.'
            }
            action={
              <Button variant="primary" asChild>
                <Link href="/dashboard/campaigns/new">
                  <Plus aria-hidden="true" />
                  Create your first campaign
                </Link>
              </Button>
            }
          />
        </div>
      )}
    </PageShell>
  );
}

function CampaignCardWithActions({
  campaign,
}: {
  campaign: React.ComponentProps<typeof CampaignCard>['campaign'];
}) {
  const action = useCampaignAction(campaign.id);
  return (
    <CampaignCard
      campaign={campaign}
      busy={action.isPending}
      onAction={(next) => action.mutate({ action: next })}
    />
  );
}
