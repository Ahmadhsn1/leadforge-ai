'use client';

import * as React from 'react';
import Link from 'next/link';
import { Search, Sparkles } from 'lucide-react';
import { PageHeader, PageShell } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label } from '@/components/ui/input';
import { ScoreChip } from '@/components/ui/score';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { HoverLift, Stagger } from '@/components/ui/motion';
import { useLeads } from '@/lib/queries';
import { relativeTime } from '@/lib/utils';

/**
 * Studio entry point: pick a lead to write to. Leads that already have an
 * analysis are listed first, because message generation depends on it.
 */
export default function StudioIndexPage() {
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, error, refetch } = useLeads({
    pageSize: 24,
    sortBy: 'leadScore',
    sortOrder: 'desc',
    search: debounced || undefined,
  });

  return (
    <PageShell className="space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" aria-hidden="true" />
            Message Studio
          </span>
        }
        description="Pick a business to write to. Drafts are built from that lead's own evidence and validated against it."
      />

      <div className="max-w-sm">
        <Label htmlFor="studio-search" className="sr-only">
          Search leads
        </Label>
        <Input
          id="studio-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by business name"
          leadingIcon={<Search />}
          className="h-8"
        />
      </div>

      {isLoading ? (
        <div className="panel">
          <TableSkeleton rows={6} columns={3} />
        </div>
      ) : isError ? (
        <div className="panel">
          <ErrorState description={error.userMessage} onRetry={() => refetch()} />
        </div>
      ) : data && data.items.length > 0 ? (
        <Stagger className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" step={45}>
          {data.items.map((lead) => (
            <HoverLift key={lead.id} className="h-full rounded-lg">
              <Link
                href={`/dashboard/studio/${lead.id}`}
                className="flex h-full flex-col rounded-lg border border-border bg-surface p-3.5 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{lead.canonicalName}</p>
                    <p className="mt-0.5 truncate text-2xs text-muted-foreground">
                      {[lead.city, lead.category].filter(Boolean).join(' · ') || 'Location unknown'}
                    </p>
                  </div>
                  <ScoreChip score={lead.leadScore} showLabel={false} />
                </div>

                {lead.signals.length > 0 ? (
                  <ul className="mt-2.5 flex flex-wrap gap-1">
                    {lead.signals.slice(0, 3).map((signal) => (
                      <li key={signal}>
                        <Badge variant="outline">{signal}</Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2.5 text-2xs text-muted-foreground">Not analysed yet</p>
                )}

                <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-2xs text-muted-foreground">
                  <span>{lead.hasDraft ? 'Drafts ready' : 'No drafts yet'}</span>
                  <span>{relativeTime(lead.updatedAt)}</span>
                </div>
              </Link>
            </HoverLift>
          ))}
        </Stagger>
      ) : (
        <div className="panel">
          <EmptyState
            icon={<Sparkles />}
            title={debounced ? 'No leads match' : 'No leads to write to yet'}
            description={
              debounced
                ? 'Try a different search.'
                : 'Run a campaign or import a list first. Message generation needs a business with recorded evidence behind it.'
            }
            action={
              <Button variant="primary" size="sm" asChild>
                <Link href="/dashboard/campaigns/new">Create a campaign</Link>
              </Button>
            }
          />
        </div>
      )}
    </PageShell>
  );
}
