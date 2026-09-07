'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  Clock,
  Inbox,
  Search,
  Send,
  ShieldAlert,
  X,
} from 'lucide-react';
import { PageHeader, PageShell } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, Tooltip } from '@/components/ui/primitives';
import { Pagination } from '@/components/ui/pagination';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { ChannelPreview, LengthMeter } from '@/components/outreach/channel-preview';
import { ConfidenceMeter } from '@/components/ui/score';
import { AiProvenanceLine } from '@/components/intelligence/trust';
import { Stagger } from '@/components/ui/motion';
import { SuppressionManager } from '@/components/outreach/suppressions';
import { useApproveDraft, useCancelDraft, useOutreachQueue, useUpdateDraft } from '@/lib/queries';
import { cn, formatCount, relativeTime, titleCase } from '@/lib/utils';
import type { MessageDraftView } from '@/types/api';

const TABS = [
  { value: 'draft', label: 'Queue', status: 'draft' },
  { value: 'approved', label: 'Scheduled', status: 'approved' },
  { value: 'sent', label: 'Sent', status: 'sent' },
  { value: 'replied', label: 'Replies', status: 'replied' },
  { value: 'follow_up_due', label: 'Follow-ups', status: 'follow_up_due' },
  { value: 'suppressed', label: 'Suppressed', status: undefined },
] as const;

export default function OutreachPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tab = searchParams.get('tab') ?? 'draft';
  const campaignId = searchParams.get('campaignId') ?? undefined;
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const activeTab = TABS.find((t) => t.value === tab) ?? TABS[0];

  const { data, isLoading, isError, error, refetch, isFetching } = useOutreachQueue({
    page,
    pageSize: 20,
    status: activeTab.status,
    campaignId,
    search: debounced || undefined,
  });

  const approve = useApproveDraft();

  const setTab = (next: string) => {
    const merged = new URLSearchParams(searchParams.toString());
    merged.set('tab', next);
    router.replace(`/dashboard/outreach?${merged.toString()}`, { scroll: false });
    setPage(1);
    setSelected(new Set());
  };

  const drafts = data?.items ?? [];
  const approvable = drafts.filter(
    (d) => d.status === 'draft' && !d.suppressed && d.validationStatus !== 'failed',
  );

  return (
    <PageShell wide className="space-y-4">
      <PageHeader
        title="Outreach"
        description="Every message is reviewed by a person before it sends. Suppression is re-checked immediately before each send."
        actions={
          activeTab.value === 'draft' && selected.size > 0 ? (
            <Button
              variant="primary"
              size="md"
              loading={approve.isPending}
              onClick={async () => {
                for (const id of selected) {
                  await approve.mutateAsync({ id });
                }
                setSelected(new Set());
              }}
            >
              <Check aria-hidden="true" />
              Approve {selected.size} selected
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {TABS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {activeTab.value !== 'suppressed' ? (
          <div className="ml-auto w-full sm:w-64">
            <Label htmlFor="outreach-search" className="sr-only">
              Search messages
            </Label>
            <Input
              id="outreach-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by business"
              leadingIcon={<Search />}
              className="h-8"
            />
          </div>
        ) : null}
      </div>

      {activeTab.value === 'suppressed' ? (
        <SuppressionManager />
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} className="h-48" />
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
      ) : drafts.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Inbox />}
            title={emptyTitle(activeTab.value)}
            description={emptyDescription(activeTab.value)}
            action={
              activeTab.value === 'draft' ? (
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/dashboard/leads?temperature=hot">Find high-intent leads</Link>
                </Button>
              ) : null
            }
          />
        </div>
      ) : (
        <>
          {activeTab.value === 'draft' && approvable.length > 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-raised px-3 py-2 text-xs">
              <input
                type="checkbox"
                id="select-all-drafts"
                className="size-3.5 accent-[hsl(var(--primary))]"
                checked={selected.size === approvable.length && approvable.length > 0}
                onChange={(e) =>
                  setSelected(e.target.checked ? new Set(approvable.map((d) => d.id)) : new Set())
                }
              />
              <label htmlFor="select-all-drafts" className="cursor-pointer">
                Select all {approvable.length} ready to approve
              </label>
              <span className="ml-auto text-muted-foreground">
                {formatCount(data?.total ?? 0)} in this view
              </span>
            </div>
          ) : null}

          <Stagger className="space-y-3" step={45}>
            {drafts.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                selectable={activeTab.value === 'draft'}
                selected={selected.has(draft.id)}
                onToggleSelect={() => {
                  const next = new Set(selected);
                  if (next.has(draft.id)) next.delete(draft.id);
                  else next.add(draft.id);
                  setSelected(next);
                }}
              />
            ))}
          </Stagger>

          {data && data.totalPages > 1 ? (
            <div className="panel">
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                totalPages={data.totalPages}
                onPageChange={setPage}
                label="messages"
                className="border-t-0"
              />
            </div>
          ) : null}
        </>
      )}
    </PageShell>
  );
}

/* -------------------------------------------------------------------------- */

function DraftCard({
  draft,
  selectable,
  selected,
  onToggleSelect,
}: {
  draft: MessageDraftView;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const approve = useApproveDraft();
  const cancel = useCancelDraft();
  const update = useUpdateDraft();

  const [editing, setEditing] = React.useState(false);
  const [body, setBody] = React.useState(draft.body);
  const [subject, setSubject] = React.useState(draft.subject ?? '');
  const [expanded, setExpanded] = React.useState(false);

  const errors = draft.validationErrors.filter((issue) => issue.severity === 'error');
  const warnings = draft.validationErrors.filter((issue) => issue.severity === 'warning');
  const blocked = draft.suppressed || !draft.recipient || errors.length > 0;

  const blockReason = draft.suppressed
    ? 'This recipient is on the do-not-contact list.'
    : !draft.recipient
      ? `No ${draft.channel === 'email' ? 'email address' : draft.channel === 'whatsapp' ? 'phone number' : 'Instagram handle'} on record for this lead.`
      : errors.length > 0
        ? 'Validation found factual problems that must be fixed before sending.'
        : null;

  return (
    <article
      className={cn(
        'rounded-lg border bg-surface transition-colors',
        selected ? 'border-primary/50 bg-primary/[0.04]' : 'border-border',
      )}
    >
      <header className="flex flex-wrap items-start gap-3 p-4 pb-3">
        {selectable ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            disabled={blocked}
            className="mt-1 size-3.5 shrink-0 accent-[hsl(var(--primary))] disabled:opacity-40"
            aria-label={`Select message to ${draft.leadName}`}
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={`/dashboard/leads/${draft.leadId}`}
              className="text-md font-semibold tracking-tight transition-colors hover:text-primary"
            >
              {draft.leadName}
            </Link>
            <Badge variant="primary" className="capitalize">
              {draft.channel}
            </Badge>
            <Badge variant="outline">{titleCase(draft.kind)}</Badge>
            {draft.campaignName ? (
              <Badge variant="outline" asChild>
                <Link href={`/dashboard/campaigns/${draft.campaignId}`}>{draft.campaignName}</Link>
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
            <span>{relativeTime(draft.createdAt)}</span>
            {draft.recipient ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="break-anywhere">To {draft.recipient}</span>
              </>
            ) : null}
            {draft.scheduledAt ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" aria-hidden="true" />
                  Scheduled {relativeTime(draft.scheduledAt)}
                </span>
              </>
            ) : null}
          </p>
        </div>

        <ValidationBadge draft={draft} />
      </header>

      {/* Blocking reason, stated plainly with a route to fix it. */}
      {blockReason ? (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
          {draft.suppressed ? (
            <Ban className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
          ) : (
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-destructive">Cannot send</p>
            <p className="mt-0.5 text-2xs text-muted-foreground text-pretty">{blockReason}</p>
          </div>
          <Button variant="ghost" size="xs" asChild>
            <Link href={`/dashboard/leads/${draft.leadId}`}>Open lead</Link>
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 px-4 pb-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {editing ? (
            <div className="space-y-2">
              {draft.channel === 'email' ? (
                <div>
                  <Label htmlFor={`subject-${draft.id}`}>Subject</Label>
                  <Input
                    id={`subject-${draft.id}`}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="mt-1"
                  />
                </div>
              ) : null}
              <div>
                <Label htmlFor={`body-${draft.id}`}>Message</Label>
                <Textarea
                  id={`body-${draft.id}`}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={7}
                  className="mt-1"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <LengthMeter channel={draft.channel} body={body} />
                <div className="ml-auto flex gap-1.5">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setBody(draft.body);
                      setSubject(draft.subject ?? '');
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="secondary"
                    size="xs"
                    loading={update.isPending}
                    onClick={async () => {
                      await update.mutateAsync({
                        id: draft.id,
                        body,
                        subject: subject || undefined,
                      });
                      setEditing(false);
                    }}
                  >
                    Save edit
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {draft.subject ? <p className="text-sm font-medium">{draft.subject}</p> : null}
              <p
                className={cn(
                  'mt-1 whitespace-pre-wrap text-sm leading-relaxed text-pretty',
                  !expanded && draft.body.length > 420 && 'line-clamp-6',
                )}
              >
                {draft.body}
              </p>
              {draft.body.length > 420 ? (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-1 inline-flex items-center gap-1 text-2xs font-medium text-primary hover:underline"
                >
                  {expanded ? 'Show less' : 'Show full message'}
                  <ChevronDown
                    className={cn('size-3 transition-transform', expanded && 'rotate-180')}
                    aria-hidden="true"
                  />
                </button>
              ) : null}

              {draft.angle ? (
                <p className="mt-2 text-2xs text-muted-foreground">
                  <span className="font-medium text-foreground">Angle:</span> {draft.angle}
                </p>
              ) : null}
            </>
          )}

          {/* Validation issues */}
          {draft.validationErrors.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {[...errors, ...warnings].map((issue, index) => (
                <li
                  key={`${issue.code}-${index}`}
                  className={cn(
                    'flex items-start gap-1.5 rounded-sm px-2 py-1 text-2xs',
                    issue.severity === 'error'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-warning/10 text-warning',
                  )}
                >
                  <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden="true" />
                  <span className="text-pretty">
                    <span className="font-medium">{titleCase(issue.code)}:</span> {issue.detail}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* Live channel preview */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <ChannelPreview
            channel={draft.channel}
            body={editing ? body : draft.body}
            subject={editing ? subject : draft.subject}
            businessName={draft.leadName}
          />
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
        <AiProvenanceLine
          provider={draft.provider}
          model={draft.model}
          promptVersion={draft.promptVersion}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {draft.status === 'draft' ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
                {editing ? 'Preview' : 'Edit'}
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/dashboard/studio/${draft.leadId}?draft=${draft.id}`}>
                  Open in studio
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={cancel.isPending}
                onClick={() => cancel.mutate({ id: draft.id, reason: 'Rejected in review' })}
              >
                <X aria-hidden="true" />
                Discard
              </Button>
              <Tooltip
                content={blocked ? blockReason : 'Approve and queue this message for sending'}
              >
                <span>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={blocked}
                    loading={approve.isPending}
                    onClick={() =>
                      approve.mutate({ id: draft.id, body: { body: editing ? body : undefined } })
                    }
                  >
                    <Send aria-hidden="true" />
                    Approve and queue
                  </Button>
                </span>
              </Tooltip>
            </>
          ) : (
            <StatusSummary draft={draft} />
          )}
        </div>
      </footer>
    </article>
  );
}

function ValidationBadge({ draft }: { draft: MessageDraftView }) {
  const map = {
    passed: { variant: 'success' as const, label: 'Grounded in evidence' },
    warned: { variant: 'warning' as const, label: 'Review before sending' },
    failed: { variant: 'destructive' as const, label: 'Failed validation' },
    pending: { variant: 'default' as const, label: 'Not validated' },
  };
  const meta = map[draft.validationStatus];
  const confidence =
    draft.validationStatus === 'passed' ? 0.94 : draft.validationStatus === 'warned' ? 0.68 : 0.3;

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Badge variant={meta.variant}>{meta.label}</Badge>
      {draft.validationStatus !== 'pending' ? <ConfidenceMeter value={confidence} /> : null}
    </div>
  );
}

function StatusSummary({ draft }: { draft: MessageDraftView }) {
  if (draft.status === 'failed') {
    return (
      <span className="flex items-center gap-1.5 text-2xs text-destructive">
        <AlertTriangle className="size-3" aria-hidden="true" />
        {draft.failureReason ?? 'Send failed'}
      </span>
    );
  }
  return (
    <span className="text-2xs text-muted-foreground">
      {draft.sentAt
        ? `Sent ${relativeTime(draft.sentAt)}`
        : draft.approvedAt
          ? `Approved ${relativeTime(draft.approvedAt)}`
          : titleCase(draft.status)}
    </span>
  );
}

function emptyTitle(tab: string): string {
  return (
    {
      draft: 'Nothing waiting for approval',
      approved: 'Nothing scheduled',
      sent: 'No messages sent yet',
      replied: 'No replies yet',
      follow_up_due: 'No follow-ups due',
    }[tab] ?? 'Nothing here'
  );
}

function emptyDescription(tab: string): string {
  return (
    {
      draft:
        'Drafts appear here once leads are scored and personalisation has run. Every one waits for your review.',
      approved: 'Approved messages waiting on a scheduled send time will appear here.',
      sent: 'Once you approve a message and the worker delivers it, it moves here with its provider status.',
      replied: 'Replies are picked up by webhook, classified, and surfaced in Conversations.',
      follow_up_due: 'Follow-ups become due according to the sequence attached to each campaign.',
    }[tab] ?? ''
  );
}
