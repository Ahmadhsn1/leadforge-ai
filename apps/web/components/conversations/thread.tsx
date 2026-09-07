'use client';

import * as React from 'react';
import Link from 'next/link';
import { Building2, CornerDownLeft, Hand, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/input';
import { Separator, Tooltip } from '@/components/ui/primitives';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScoreChip, ConfidenceMeter } from '@/components/ui/score';
import { AiProvenanceLine, ProvenanceTag } from '@/components/intelligence/trust';
import {
  CardSkeleton,
  EmptyState,
  ErrorState,
  Skeleton,
  StreamingDots,
} from '@/components/ui/states';
import {
  useConversation,
  useSendConversationMessage,
  useSuggestResponse,
  useUpdateConversation,
} from '@/lib/queries';
import { HUMAN_TAKEOVER_INTENTS } from '@leadforge/shared';
import { cn, formatDateTime, relativeTime, titleCase } from '@/lib/utils';
import type { ConversationDetail, ConversationMessageView } from '@/types/api';

/** Message history plus the AI copilot panel for one conversation. */
export function ConversationThread({ conversationId }: { conversationId: string }) {
  const { data, isLoading, isError, error, refetch } = useConversation(conversationId);
  const send = useSendConversationMessage(conversationId);
  const [draft, setDraft] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the thread updates.
  React.useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [data?.messages.length]);

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-6 w-1/3" />
        <CardSkeleton className="h-24" />
        <CardSkeleton className="h-24" />
      </div>
    );
  }

  if (isError) {
    return <ErrorState description={error.userMessage} onRetry={() => refetch()} />;
  }

  if (!data) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col">
        <ThreadHeader conversation={data} />

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 scroll-shadow">
          {data.messages.length === 0 ? (
            <EmptyState
              compact
              title="No messages yet"
              description="This conversation was opened but nothing has been exchanged."
            />
          ) : (
            data.messages.map((message) => <MessageBubble key={message.id} message={message} />)
          )}
        </div>

        <form
          className="border-t border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) return;
            send.mutate({ body: draft.trim() });
            setDraft('');
          }}
        >
          <label htmlFor="reply-body" className="sr-only">
            Write a reply
          </label>
          <Textarea
            id="reply-body"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(event) => {
              // Cmd/Ctrl + Enter sends, matching every other messaging tool.
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                if (draft.trim()) {
                  send.mutate({ body: draft.trim() });
                  setDraft('');
                }
              }
            }}
            placeholder="Write a reply, or insert the copilot's suggestion"
            rows={3}
            className="resize-none"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-2xs text-muted-foreground">
              <kbd className="rounded-sm border border-border bg-muted px-1 font-mono">⌘</kbd>
              <kbd className="ml-0.5 rounded-sm border border-border bg-muted px-1 font-mono">
                ↵
              </kbd>{' '}
              to send
            </p>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!draft.trim()}
              loading={send.isPending}
            >
              <CornerDownLeft aria-hidden="true" />
              Send reply
            </Button>
          </div>
        </form>
      </div>

      <CopilotPanel conversation={data} onInsert={(text) => setDraft(text)} />
    </div>
  );
}

function ThreadHeader({ conversation }: { conversation: ConversationDetail }) {
  const update = useUpdateConversation(conversation.id);

  return (
    <header className="flex flex-wrap items-start gap-3 border-b border-border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/dashboard/leads/${conversation.leadId}`}
            className="text-md font-semibold tracking-tight transition-colors hover:text-primary"
          >
            {conversation.leadName}
          </Link>
          <ScoreChip score={conversation.lead.leadScore} />
          <Badge variant="outline" className="capitalize">
            {conversation.channel}
          </Badge>
          {conversation.needsHuman ? (
            <Badge variant="warning" className="gap-1">
              <StatusDot tone="warning" pulse />
              Needs a human
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-2xs text-muted-foreground">
          {[conversation.lead.city, conversation.lead.category].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Select value={conversation.status} onValueChange={(status) => update.mutate({ status })}>
          <SelectTrigger size="sm" className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['open', 'awaiting_reply', 'needs_human', 'snoozed', 'closed'].map((status) => (
              <SelectItem key={status} value={status}>
                {titleCase(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tooltip content="Open the full lead intelligence record">
          <Button variant="secondary" size="icon-sm" asChild aria-label="Open lead">
            <Link href={`/dashboard/leads/${conversation.leadId}`}>
              <Building2 />
            </Link>
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}

function MessageBubble({ message }: { message: ConversationMessageView }) {
  const outbound = message.direction === 'outbound';
  const timestamp = message.sentAt ?? message.receivedAt ?? message.createdAt;

  return (
    <div className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[min(560px,85%)]', outbound ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-lg px-3 py-2 text-sm leading-relaxed',
            outbound
              ? 'rounded-br-sm border border-primary/25 bg-primary/10'
              : 'rounded-bl-sm border border-border bg-surface',
          )}
        >
          {message.subject ? <p className="mb-1 text-xs font-semibold">{message.subject}</p> : null}
          <p className="whitespace-pre-wrap break-words text-pretty">{message.body}</p>
        </div>

        <div
          className={cn(
            'mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground',
            outbound ? 'justify-end' : 'justify-start',
          )}
        >
          <time dateTime={timestamp} title={formatDateTime(timestamp)}>
            {relativeTime(timestamp)}
          </time>
          {message.intent ? (
            <>
              <span aria-hidden="true">·</span>
              <Badge variant="outline">{titleCase(message.intent)}</Badge>
            </>
          ) : null}
          {message.sentiment ? (
            <Badge
              variant={
                message.sentiment === 'positive'
                  ? 'success'
                  : message.sentiment === 'negative'
                    ? 'destructive'
                    : 'default'
              }
            >
              {titleCase(message.sentiment)}
            </Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The copilot panel. It classifies the latest inbound message, recommends a
 * next action, and drafts a reply — but the reply is always inserted into the
 * composer for a human to review, never sent directly.
 */
function CopilotPanel({
  conversation,
  onInsert,
}: {
  conversation: ConversationDetail;
  onInsert: (text: string) => void;
}) {
  const suggest = useSuggestResponse(conversation.id);
  const [guidance, setGuidance] = React.useState('');
  const copilot = suggest.data ?? conversation.copilot;

  const takeover =
    copilot?.requiresHuman || (copilot?.intent && HUMAN_TAKEOVER_INTENTS.includes(copilot.intent));

  return (
    <aside
      className="flex w-full shrink-0 flex-col border-t border-border bg-surface lg:w-[320px] lg:border-l lg:border-t-0"
      aria-label="AI copilot"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span
          className="flex size-6 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Sparkles className="size-3.5" />
        </span>
        <h3 className="text-sm font-semibold">AI copilot</h3>
        <ProvenanceTag provenance="inferred" className="ml-auto" />
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {suggest.isPending ? (
          <div className="space-y-2 py-6 text-center">
            <StreamingDots label="Reading the conversation" />
            <p className="text-2xs text-muted-foreground">
              Classifying intent and drafting a response…
            </p>
          </div>
        ) : copilot ? (
          <>
            {takeover ? (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2">
                <Hand className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
                <p className="text-2xs text-pretty">
                  <span className="font-medium">Handle this one yourself.</span> The reply was
                  classified as {titleCase(copilot.intent)} — it needs judgement, not a template.
                </p>
              </div>
            ) : null}

            <dl className="space-y-2.5">
              <Insight label="Intent" value={titleCase(copilot.intent)} />
              <Insight
                label="Sentiment"
                value={titleCase(copilot.sentiment)}
                tone={
                  copilot.sentiment === 'positive'
                    ? 'success'
                    : copilot.sentiment === 'negative'
                      ? 'destructive'
                      : undefined
                }
              />
              <Insight label="Objection" value={copilot.objection ?? 'None detected'} />
              <div>
                <dt className="eyebrow">Summary</dt>
                <dd className="mt-0.5 text-xs leading-relaxed text-pretty">{copilot.summary}</dd>
              </div>
              <div>
                <dt className="eyebrow">Recommended next step</dt>
                <dd className="mt-0.5 text-xs leading-relaxed text-pretty">{copilot.nextAction}</dd>
              </div>
            </dl>

            <ConfidenceMeter value={copilot.confidence} size="md" />

            <Separator />

            <div>
              <p className="eyebrow mb-1.5">Suggested response</p>
              {copilot.suggestedResponse ? (
                <>
                  <div className="rounded-md border border-border bg-raised p-2.5">
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-pretty">
                      {copilot.suggestedResponse}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button
                      variant="primary"
                      size="xs"
                      onClick={() => onInsert(copilot.suggestedResponse ?? '')}
                    >
                      Insert into reply
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        suggest.mutate({
                          guidance: 'Make it shorter and more direct.',
                          force: true,
                        })
                      }
                    >
                      Shorter
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        suggest.mutate({ guidance: 'Warmer and more personal.', force: true })
                      }
                    >
                      Warmer
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground text-pretty">
                  No suggestion generated. This usually means the thread needs a judgement call
                  rather than a templated reply.
                </p>
              )}
            </div>

            <AiProvenanceLine
              model={copilot.model}
              promptVersion={copilot.promptVersion}
              createdAt={copilot.generatedAt}
            />
          </>
        ) : (
          <EmptyState
            compact
            icon={<Wand2 />}
            title="No analysis yet"
            description="Generate a classification and a suggested response for the latest message."
          />
        )}
      </div>

      <div className="space-y-2 border-t border-border p-3">
        <label htmlFor="copilot-guidance" className="sr-only">
          Guidance for the copilot
        </label>
        <Textarea
          id="copilot-guidance"
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
          placeholder="Optional steer, e.g. offer a call on Thursday"
          rows={2}
          className="resize-none text-xs"
        />
        <Button
          variant="ai"
          size="sm"
          className="w-full"
          loading={suggest.isPending}
          onClick={() => suggest.mutate({ guidance: guidance.trim() || undefined, force: true })}
        >
          {suggest.isPending ? null : <RefreshCw aria-hidden="true" />}
          {copilot ? 'Regenerate' : 'Analyse and suggest'}
        </Button>
      </div>
    </aside>
  );
}

function Insight({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'destructive';
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="eyebrow">{label}</dt>
      <dd
        className={cn(
          'text-xs font-medium',
          tone === 'success' && 'text-success',
          tone === 'destructive' && 'text-destructive',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
