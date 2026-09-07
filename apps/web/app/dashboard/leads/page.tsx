'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Building2, Download, Send, Sparkles, Tag, Upload, X } from 'lucide-react';
import { PageHeader, PageShell } from '@/components/layout/page-header';
import { LeadTable, LeadCardList, type SortState } from '@/components/leads/lead-table';
import { LeadFilters } from '@/components/leads/lead-filters';
import { LeadQuickView } from '@/components/leads/lead-quick-view';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { useLeads, type LeadListParams } from '@/lib/queries';
import { useUiStore } from '@/stores/ui';
import { formatCount, pluralize } from '@/lib/utils';
import type { LeadSummary } from '@/types/api';

export default function LeadsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const columns = useUiStore((s) => s.leadColumns);

  const params = React.useMemo<LeadListParams>(
    () => ({
      page: Number(searchParams.get('page') ?? 1),
      pageSize: Number(searchParams.get('pageSize') ?? 25),
      campaignId: searchParams.get('campaignId') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      verificationStatus: searchParams.get('verificationStatus') ?? undefined,
      temperature: searchParams.get('temperature') ?? undefined,
      minScore: searchParams.get('minScore') ? Number(searchParams.get('minScore')) : undefined,
      maxScore: searchParams.get('maxScore') ? Number(searchParams.get('maxScore')) : undefined,
      search: searchParams.get('search') ?? undefined,
      tag: searchParams.get('tag') ?? undefined,
      sortBy: searchParams.get('sortBy') ?? 'leadScore',
      sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') ?? 'desc',
    }),
    [searchParams],
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useLeads(params);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [quickViewLead, setQuickViewLead] = React.useState<LeadSummary | null>(null);

  // Filters live in the URL so a view is shareable and the back button works.
  const updateParams = React.useCallback(
    (next: Partial<LeadListParams>) => {
      const merged = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value === null || value === '') merged.delete(key);
        else merged.set(key, String(value));
      }
      router.replace(`/dashboard/leads?${merged.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const resetParams = React.useCallback(() => router.replace('/dashboard/leads'), [router]);

  const sort: SortState = {
    sortBy: params.sortBy ?? 'leadScore',
    sortOrder: params.sortOrder ?? 'desc',
  };
  const leads = data?.items ?? [];
  const hasFilters = Boolean(
    params.status ||
    params.temperature ||
    params.verificationStatus ||
    params.search ||
    params.campaignId,
  );

  return (
    <PageShell wide className="space-y-4">
      <PageHeader
        title="Leads"
        description="Every prospect the pipeline has found, ranked by how worth contacting they are."
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/dashboard/leads/import">
                <Upload aria-hidden="true" />
                Import
              </Link>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => exportCsv(params)}
              disabled={!data || data.total === 0}
            >
              <Download aria-hidden="true" />
              Export
            </Button>
          </>
        }
      />

      <div className="panel overflow-hidden">
        <div className="border-b border-border p-3">
          <LeadFilters
            params={params}
            onChange={updateParams}
            onReset={resetParams}
            total={data?.total}
          />
        </div>

        {/* Bulk action bar appears only when rows are selected. */}
        {selectedIds.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-primary/25 bg-primary/[0.07] px-3 py-2">
            <span className="tabular text-xs font-medium">
              {formatCount(selectedIds.size)} {pluralize(selectedIds.size, 'lead')} selected
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <Button variant="secondary" size="xs">
                <Sparkles aria-hidden="true" />
                Analyse
              </Button>
              <Button variant="secondary" size="xs">
                <Send aria-hidden="true" />
                Generate messages
              </Button>
              <Button variant="secondary" size="xs">
                <Tag aria-hidden="true" />
                Tag
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setSelectedIds(new Set())}>
                <X aria-hidden="true" />
                Clear
              </Button>
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <TableSkeleton rows={10} columns={columns.length} />
        ) : isError ? (
          <ErrorState
            description={error.userMessage}
            onRetry={() => refetch()}
            retrying={isFetching}
          />
        ) : leads.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={<Building2 />}
              title="No leads match these filters"
              description="Try widening the score range or clearing the status filter."
              action={
                <Button variant="secondary" size="sm" onClick={resetParams}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Building2 />}
              title="No leads yet"
              description="Run a campaign to discover businesses, or import a list you already have. Each lead arrives verified, enriched and scored with the evidence behind it."
              action={
                <Button variant="primary" size="sm" asChild>
                  <Link href="/dashboard/campaigns/new">Create a campaign</Link>
                </Button>
              }
              secondaryAction={
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/dashboard/leads/import">Import CSV</Link>
                </Button>
              }
            />
          )
        ) : (
          <>
            {/* Table on wide screens, cards on small ones. */}
            <div className="hidden md:block">
              <LeadTable
                leads={leads}
                columns={columns}
                sort={sort}
                onSortChange={(next) => updateParams({ ...next, page: 1 })}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                onOpenLead={setQuickViewLead}
              />
            </div>
            <div className="md:hidden">
              <LeadCardList
                leads={leads}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
              />
            </div>
            <Pagination
              page={data?.page ?? 1}
              pageSize={data?.pageSize ?? 25}
              total={data?.total ?? 0}
              totalPages={data?.totalPages ?? 1}
              onPageChange={(page) => updateParams({ page })}
              onPageSizeChange={(pageSize) => updateParams({ pageSize, page: 1 })}
              label="leads"
            />
          </>
        )}
      </div>

      <LeadQuickView
        leadId={quickViewLead?.id ?? null}
        onOpenChange={(open) => (open ? undefined : setQuickViewLead(null))}
      />
    </PageShell>
  );
}

/** Downloads the current filtered view as CSV via the API's export endpoint. */
function exportCsv(params: LeadListParams) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (
      value === undefined ||
      value === null ||
      value === '' ||
      key === 'page' ||
      key === 'pageSize'
    )
      continue;
    query.set(key, String(value));
  }
  window.location.href = `/api/leads/export?${query.toString()}`;
}
