'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Inbox, Search, UserRound } from 'lucide-react';
import { PageHeader, PageShell } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Input, Label } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/states';
import { ConversationThread } from '@/components/conversations/thread';
import { CHANNEL_ICON } from '@/components/conversations/channel-icon';
import { useConversations } from '@/lib/queries';
import { cn, relativeTime, titleCase, truncateText } from '@/lib/utils';
import type { ConversationSummary } from '@/types/api';

const FILTERS = [
  { value: 'all', label: 'All', status: undefined },
  { value: 'needs_human', label: 'Needs you', status: 'needs_human' },
  { value: 'open', label: 'Open', status: 'open' },
  { value: 'awaiting_reply', label: 'Awaiting reply', status: 'awaiting_reply' },
  { value: 'closed', label: 'Closed', status: 'closed' },
] as const;

export default function ConversationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const filter = searchParams.get('status') ?? 'all';
  const selectedId = searchParams.get('id');
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const activeFilter = FILTERS.find((f) => f.value === filter) ?? FILTERS[0];
  const { data, isLoading, isError, error, refetch } = useConversations({
    status: activeFilter.status,
    search: debounced || undefined,
  });

  const conversations = data?.items ?? [];

  const select = (id: string | null) => {
    const merged = new URLSearchParams(searchParams.toString());
    if (id) merged.set('id', id);
    else merged.delete('id');
    router.replace(`/dashboard/conversations?${merged.toString()}`, { scroll: false });
  };

  const setFilter = (next: string) => {
    const merged = new URLSearchParams(searchParams.toString());
    if (next === 'all') merged.delete('status');
    else merged.set('status', next);
    merged.delete('id');
    router.replace(`/dashboard/conversations?${merged.toString()}`, { scroll: false });
  };

  return (
    <PageShell wide className="space-y-4">
      <PageHeader
        title="Conversations"
        description="Every reply in one place, classified and summarised so you can pick up the thread quickly."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            {FILTERS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Two-pane inbox on desktop; on mobile, the list and thread swap. */}
      <div className="grid gap-0 overflow-hidden rounded-lg border border-border lg:h-[calc(100dvh-13rem)] lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside
          className={cn(
            'flex min-h-0 flex-col border-border bg-surface lg:border-r',
            selectedId ? 'hidden lg:flex' : 'flex',
          )}
          aria-label="Conversation list"
        >
          <div className="border-b border-border p-2">
            <Label htmlFor="conversation-search" className="sr-only">
              Search conversations
            </Label>
            <Input
              id="conversation-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by business or message"
              leadingIcon={<Search />}
              className="h-8"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="space-y-px">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="space-y-2 p-3">
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                ))}
              </div>
            ) : isError ? (
              <ErrorState compact description={error.userMessage} onRetry={() => refetch()} />
            ) : conversations.length === 0 ? (
              <EmptyState
                compact
                icon={<Inbox />}
                title={filter === 'all' ? 'No conversations yet' : 'Nothing in this view'}
                description={
                  filter === 'all'
                    ? 'When a prospect replies, the message arrives here with its intent, sentiment and a suggested response.'
                    : 'Try another filter.'
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <ConversationListItem
                      conversation={conversation}
                      active={conversation.id === selectedId}
                      onSelect={() => select(conversation.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section
          className={cn(
            'min-h-0 bg-background',
            selectedId ? 'flex flex-col' : 'hidden lg:flex lg:flex-col',
          )}
          aria-label="Conversation"
        >
          {selectedId ? (
            <>
              <div className="border-b border-border p-2 lg:hidden">
                <Button variant="ghost" size="sm" onClick={() => select(null)}>
                  <ArrowLeft aria-hidden="true" />
                  All conversations
                </Button>
              </div>
              <ConversationThread conversationId={selectedId} />
            </>
          ) : (
            <EmptyState
              icon={<Inbox />}
              title="Select a conversation"
              description="Pick a thread on the left to read the history, see how the reply was classified, and draft a response with the copilot."
              action={
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/dashboard/outreach">Go to the approval queue</Link>
                </Button>
              }
            />
          )}
        </section>
      </div>
    </PageShell>
  );
}

function ConversationListItem({
  conversation,
  active,
  onSelect,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = CHANNEL_ICON[conversation.channel];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'relative flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        active ? 'bg-primary/[0.08]' : 'hover:bg-muted/50',
      )}
    >
      <span
        className={cn(
          'absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-primary transition-opacity',
          active ? 'opacity-100' : 'opacity-0',
        )}
        aria-hidden="true"
      />
      <span
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-raised text-muted-foreground"
        aria-hidden="true"
      >
        <Icon className="size-3" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{conversation.leadName}</span>
          <span className="shrink-0 text-2xs text-muted-foreground">
            {relativeTime(conversation.lastMessageAt)}
          </span>
        </span>
        {conversation.lastMessagePreview ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {truncateText(conversation.lastMessagePreview, 70)}
          </span>
        ) : null}
        <span className="mt-1.5 flex flex-wrap items-center gap-1">
          {conversation.needsHuman ? (
            <Badge variant="warning" className="gap-1">
              <StatusDot tone="warning" pulse />
              Needs you
            </Badge>
          ) : null}
          {conversation.lastIntent ? (
            <Badge variant="outline">{titleCase(conversation.lastIntent)}</Badge>
          ) : null}
          {conversation.lastSentiment ? (
            <Badge
              variant={
                conversation.lastSentiment === 'positive'
                  ? 'success'
                  : conversation.lastSentiment === 'negative'
                    ? 'destructive'
                    : 'default'
              }
            >
              {titleCase(conversation.lastSentiment)}
            </Badge>
          ) : null}
          {conversation.unreadInbound > 0 ? (
            <Badge variant="primary" className="tabular">
              {conversation.unreadInbound} new
            </Badge>
          ) : null}
          {conversation.assigneeName ? (
            <Badge variant="outline" className="gap-1">
              <UserRound className="size-2.5" aria-hidden="true" />
              {conversation.assigneeName}
            </Badge>
          ) : null}
        </span>
      </span>
    </button>
  );
}
