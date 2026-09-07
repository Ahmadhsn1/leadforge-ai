'use client';

import * as React from 'react';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { LeadTable, LeadCardList, type SortState } from '@/components/leads/lead-table';
import { LeadQuickView } from '@/components/leads/lead-quick-view';
import { Pagination } from '@/components/ui/pagination';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { useLeads } from '@/lib/queries';
import { useUiStore } from '@/stores/ui';
import type { LeadSummary } from '@/types/api';

/** Leads scoped to one campaign, embedded in the campaign detail tabs. */
export function CampaignLeadsTab({ campaignId }: { campaignId: string }) {
  const columns = useUiStore((s) => s.leadColumns);
  const [page, setPage] = React.useState(1);
  const [sort, setSort] = React.useState<SortState>({ sortBy: 'leadScore', sortOrder: 'desc' });
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [quickView, setQuickView] = React.useState<LeadSummary | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useLeads({
    campaignId,
    page,
    pageSize: 25,
    sortBy: sort.sortBy,
    sortOrder: sort.sortOrder,
  });

  return (
    <div className="panel overflow-hidden">
      {isLoading ? (
        <TableSkeleton rows={8} columns={columns.length} />
      ) : isError ? (
        <ErrorState
          description={error.userMessage}
          onRetry={() => refetch()}
          retrying={isFetching}
        />
      ) : data && data.items.length > 0 ? (
        <>
          <div className="hidden md:block">
            <LeadTable
              leads={data.items}
              columns={columns}
              sort={sort}
              onSortChange={(next) => {
                setSort(next);
                setPage(1);
              }}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onOpenLead={setQuickView}
            />
          </div>
          <div className="md:hidden">
            <LeadCardList
              leads={data.items}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
            />
          </div>
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            totalPages={data.totalPages}
            onPageChange={setPage}
            label="leads"
          />
        </>
      ) : (
        <EmptyState
          icon={<Building2 />}
          title="No leads from this campaign yet"
          description="Start a run and discovered businesses will appear here as they are normalised and verified."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href="/dashboard/leads">Browse all leads</Link>
            </Button>
          }
        />
      )}

      <LeadQuickView
        leadId={quickView?.id ?? null}
        onOpenChange={(open) => (open ? undefined : setQuickView(null))}
      />
    </div>
  );
}
