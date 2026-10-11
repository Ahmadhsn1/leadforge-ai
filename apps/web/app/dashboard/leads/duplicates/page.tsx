'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Check, GitMerge, Split } from 'lucide-react';
import { PageHeader, PageShell } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { api, ApiError } from '@/lib/api-client';
import { relativeTime, titleCase } from '@/lib/utils';

interface DuplicateLead {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  source: string;
  status: string;
  leadScore: number | null;
  createdAt: string;
}

interface MergeCandidateView {
  id: string;
  score: number;
  reasons: string[];
  createdAt: string;
  existing: DuplicateLead;
  incoming: DuplicateLead;
}

const FIELDS: { key: keyof DuplicateLead; label: string }[] = [
  { key: 'category', label: 'Category' },
  { key: 'address', label: 'Address' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'website', label: 'Website' },
];

/**
 * Pairs the pipeline thought might be the same business but was not sure
 * enough to merge by itself. A person decides; the screen's job is to make
 * the comparison quick and the consequence of each button plain.
 */
export default function DuplicatesPage() {
  const queryClient = useQueryClient();
  const candidates = useQuery<MergeCandidateView[], ApiError>({
    queryKey: ['merge-candidates'],
    queryFn: () => api.get<MergeCandidateView[]>('/leads/merge-candidates'),
  });

  const [busy, setBusy] = React.useState<{ id: string; action: 'merge' | 'distinct' } | null>(null);

  async function resolve(candidate: MergeCandidateView, action: 'merge' | 'distinct') {
    setBusy({ id: candidate.id, action });
    try {
      await api.post(`/leads/merge-candidates/${candidate.id}/resolve`, { action });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['merge-candidates'] }),
        queryClient.invalidateQueries({ queryKey: ['leads'] }),
      ]);
      toast.success(
        action === 'merge'
          ? `Merged into ${candidate.existing.name}`
          : 'Kept as two separate leads',
      );
    } catch (error) {
      toast.error('Could not save that decision', {
        description: error instanceof ApiError ? error.userMessage : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell className="space-y-4">
      <PageHeader
        title="Possible duplicates"
        description="Leads that look like the same business but were not similar enough to merge automatically. Merging moves notes, messages and conversations onto the older lead."
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/leads">
              <ArrowLeft aria-hidden="true" />
              Back to leads
            </Link>
          </Button>
        }
      />

      {candidates.isLoading ? (
        <div className="space-y-3">
          <CardSkeleton className="h-48" />
          <CardSkeleton className="h-48" />
        </div>
      ) : candidates.isError ? (
        <div className="panel">
          <ErrorState
            description={candidates.error.userMessage}
            onRetry={() => candidates.refetch()}
          />
        </div>
      ) : (candidates.data ?? []).length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Check />}
            title="Nothing to review"
            description="When a new lead resembles one you already have, the pair appears here for you to decide."
            action={
              <Button variant="secondary" size="sm" asChild>
                <Link href="/dashboard/leads">View leads</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {(candidates.data ?? []).map((candidate) => {
            const working = busy?.id === candidate.id;
            return (
              <li key={candidate.id} className="panel overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                  <Badge variant="warning">{Math.round(candidate.score * 100)}% similar</Badge>
                  {candidate.reasons.map((reason) => (
                    <Badge key={reason} variant="outline">
                      {reason}
                    </Badge>
                  ))}
                  <span className="ml-auto text-2xs text-muted-foreground">
                    Flagged {relativeTime(candidate.createdAt)}
                  </span>
                </div>

                <div className="grid gap-px bg-border md:grid-cols-2">
                  <LeadColumn heading="Already in your leads" lead={candidate.existing} />
                  <LeadColumn
                    heading="Newer lead"
                    lead={candidate.incoming}
                    compareWith={candidate.existing}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={working && busy?.action === 'distinct'}
                    disabled={working}
                    onClick={() => resolve(candidate, 'distinct')}
                  >
                    <Split aria-hidden="true" />
                    Different businesses
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={working && busy?.action === 'merge'}
                    disabled={working}
                    onClick={() => resolve(candidate, 'merge')}
                  >
                    <GitMerge aria-hidden="true" />
                    Same business — merge
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}

function LeadColumn({
  heading,
  lead,
  compareWith,
}: {
  heading: string;
  lead: DuplicateLead;
  compareWith?: DuplicateLead;
}) {
  return (
    <div className="bg-surface p-4">
      <p className="eyebrow">{heading}</p>
      <Link
        href={`/dashboard/leads/${lead.id}`}
        className="mt-1 inline-block text-md font-semibold tracking-tight hover:text-primary hover:underline"
      >
        {lead.name}
      </Link>
      <p className="text-2xs text-muted-foreground">
        {titleCase(lead.source)} · {titleCase(lead.status)}
        {lead.leadScore !== null ? ` · score ${lead.leadScore}` : ''}
      </p>

      <dl className="mt-3 space-y-1.5 text-sm">
        {FIELDS.map((field) => {
          const value = lead[field.key];
          const other = compareWith?.[field.key];
          // Worth pointing out: something this lead knows that the other does not.
          const adds = compareWith !== undefined && Boolean(value) && !other;
          return (
            <div key={field.key} className="flex gap-3">
              <dt className="w-20 shrink-0 text-muted-foreground">{field.label}</dt>
              <dd className="min-w-0 break-anywhere">
                {value ? (
                  <>
                    {String(value)}
                    {adds ? (
                      <span className="ml-2 text-2xs font-medium text-success">would be added</span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-muted-foreground">Unknown</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
