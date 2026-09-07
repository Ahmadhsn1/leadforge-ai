'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Instagram,
  Mail,
  MessageCircle,
  RefreshCw,
  Send,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { PageHeader, PageShell, Section } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, Tooltip } from '@/components/ui/primitives';
import { ChannelPreview, LengthMeter } from '@/components/outreach/channel-preview';
import { AiProvenanceLine, AiRecommendation, ProvenanceTag } from '@/components/intelligence/trust';
import { ScoreChip } from '@/components/ui/score';
import {
  CardSkeleton,
  EmptyState,
  ErrorState,
  ProcessTimeline,
  Skeleton,
} from '@/components/ui/states';
import { FollowUpTimeline } from '@/components/outreach/follow-up-timeline';
import {
  useApproveDraft,
  useGenerateMessage,
  useLead,
  useSequences,
  useUpdateDraft,
} from '@/lib/queries';
import { CHANNELS, CHANNEL_PROFILES, type Channel, type DraftKind } from '@leadforge/shared';
import { cn, relativeTime, titleCase } from '@/lib/utils';
import type { LeadDetail, MessageDraftView } from '@/types/api';

const CHANNEL_ICONS: Record<Channel, React.ElementType> = {
  whatsapp: MessageCircle,
  instagram: Instagram,
  email: Mail,
};

const REFINEMENTS = [
  {
    label: 'Make shorter',
    instruction: 'Cut the length by about a third without losing the specific detail.',
  },
  { label: 'Make warmer', instruction: 'Warmer and more human, still concise.' },
  {
    label: 'Make more direct',
    instruction: 'More direct. Lead with the observation, then the ask.',
  },
  {
    label: 'Change angle',
    instruction: 'Use a different opportunity from the evidence as the opening angle.',
  },
] as const;

export default function MessageStudioPage() {
  const params = useParams<{ leadId: string }>();
  const searchParams = useSearchParams();
  const leadId = params.leadId;

  const { data: lead, isLoading, isError, error, refetch } = useLead(leadId);
  const generate = useGenerateMessage(leadId);
  const sequences = useSequences();

  const [channel, setChannel] = React.useState<Channel>('whatsapp');
  const [activeDraftId, setActiveDraftId] = React.useState<string | null>(
    searchParams.get('draft'),
  );

  // Default the channel to whatever the lead is actually reachable on.
  React.useEffect(() => {
    if (!lead) return;
    const preferred = lead.drafts[0]?.channel ?? preferredChannel(lead);
    setChannel(preferred);
  }, [lead]);

  if (isLoading) {
    return (
      <PageShell wide className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <CardSkeleton className="h-96" />
          <CardSkeleton className="h-96" />
        </div>
      </PageShell>
    );
  }

  if (isError) {
    return (
      <PageShell>
        <ErrorState
          title={error.isNotFound ? 'Lead not found' : 'Could not load this lead'}
          description={error.userMessage}
          onRetry={error.isNotFound ? undefined : () => refetch()}
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href="/dashboard/leads">Back to leads</Link>
            </Button>
          }
        />
      </PageShell>
    );
  }

  if (!lead) return null;

  const channelDrafts = lead.drafts.filter((d) => d.channel === channel);
  const activeDraft = channelDrafts.find((d) => d.id === activeDraftId) ?? channelDrafts[0] ?? null;
  const recipient = recipientFor(lead, channel);

  return (
    <PageShell wide className="space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" aria-hidden="true" />
            Message Studio
          </span>
        }
        description={
          <>
            Writing to{' '}
            <Link
              href={`/dashboard/leads/${lead.id}`}
              className="font-medium text-foreground hover:text-primary hover:underline"
            >
              {lead.canonicalName}
            </Link>{' '}
            — grounded in this business's evidence, validated against it, and reviewed by you before
            sending.
          </>
        }
        meta={
          <>
            <ScoreChip score={lead.leadScore} />
            {lead.category ? (
              <Badge variant="outline" className="capitalize">
                {lead.category}
              </Badge>
            ) : null}
            {lead.city ? <Badge variant="outline">{lead.city}</Badge> : null}
          </>
        }
        actions={
          <Button
            variant="primary"
            size="md"
            loading={generate.isPending}
            onClick={() =>
              generate.mutate({
                channel,
                kinds: ['primary', 'short', 'alternative'],
                force: true,
              })
            }
          >
            {generate.isPending ? null : <Wand2 aria-hidden="true" />}
            {channelDrafts.length > 0 ? 'Regenerate' : 'Generate drafts'}
          </Button>
        }
      />

      {/* Channel tabs */}
      <Tabs value={channel} onValueChange={(value) => setChannel(value as Channel)}>
        <TabsList>
          {CHANNELS.map((item) => {
            const Icon = CHANNEL_ICONS[item];
            const count = lead.drafts.filter((d) => d.channel === item).length;
            return (
              <TabsTrigger key={item} value={item} count={count || undefined}>
                <Icon className="size-3.5" aria-hidden="true" />
                {titleCase(item)}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {!recipient ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              No {CHANNEL_PROFILES[channel].recipientField} on record
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
              You can still draft and refine here, but this message cannot be queued until the lead
              has a usable {CHANNEL_PROFILES[channel].recipientField}.
            </p>
          </div>
          <Button variant="secondary" size="sm" className="ml-auto shrink-0" asChild>
            <Link href={`/dashboard/leads/${lead.id}`}>Add contact details</Link>
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {generate.isPending ? (
            <div className="panel p-4">
              <ProcessTimeline
                steps={[
                  { key: 'facts', label: 'Reading verified facts', state: 'complete' },
                  { key: 'evidence', label: 'Selecting supporting evidence', state: 'complete' },
                  { key: 'write', label: 'Writing channel-native drafts', state: 'active' },
                  { key: 'validate', label: 'Validating against the facts', state: 'pending' },
                ]}
              />
            </div>
          ) : channelDrafts.length === 0 ? (
            <div className="panel">
              <EmptyState
                icon={<Wand2 />}
                title={`No ${titleCase(channel)} drafts yet`}
                description={
                  lead.intelligence
                    ? `Generate drafts using this business's recommended angle and the evidence behind it. ${CHANNEL_PROFILES[channel].styleGuidance}`
                    : 'This lead has not been analysed yet. Analysis produces the angle and evidence that message generation depends on.'
                }
                action={
                  lead.intelligence ? (
                    <Button
                      variant="primary"
                      size="sm"
                      loading={generate.isPending}
                      onClick={() =>
                        generate.mutate({ channel, kinds: ['primary', 'short', 'alternative'] })
                      }
                    >
                      Generate drafts
                    </Button>
                  ) : (
                    <Button variant="primary" size="sm" asChild>
                      <Link href={`/dashboard/leads/${lead.id}`}>Run analysis first</Link>
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            <>
              {/* Draft variant selector */}
              <div className="flex flex-wrap gap-1.5">
                {channelDrafts.map((draft) => (
                  <button
                    key={draft.id}
                    type="button"
                    onClick={() => setActiveDraftId(draft.id)}
                    className={cn(
                      'rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      draft.id === activeDraft?.id
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-border-strong hover:text-foreground',
                    )}
                  >
                    {titleCase(draft.kind)}
                  </button>
                ))}
              </div>

              {activeDraft ? (
                <DraftEditor
                  key={activeDraft.id}
                  draft={activeDraft}
                  lead={lead}
                  canSend={Boolean(recipient) && !lead.suppression}
                  onRefine={(instruction) =>
                    generate.mutate({
                      channel,
                      kinds: [activeDraft.kind as DraftKind],
                      force: true,
                      cta: undefined,
                      offer: instruction,
                    })
                  }
                  refining={generate.isPending}
                />
              ) : null}
            </>
          )}

          <Section title="Follow-up sequence" description="What happens if they do not reply.">
            <FollowUpTimeline
              sequence={sequences.data?.find((s) => s.channel === channel) ?? null}
              loading={sequences.isLoading}
            />
          </Section>
        </div>

        {/* Context sidebar */}
        <aside className="space-y-4 lg:sticky lg:top-[calc(theme(spacing.topbar)+1rem)] lg:self-start">
          {lead.intelligence ? (
            <AiRecommendation
              title="Recommended angle"
              body={lead.intelligence.recommendedAngle}
              meta={
                <AiProvenanceLine
                  provider={lead.intelligence.provider}
                  model={lead.intelligence.model}
                  promptVersion={lead.intelligence.promptVersion}
                  createdAt={lead.intelligence.createdAt}
                />
              }
            />
          ) : null}

          <div className="panel p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              Facts available to the model
              <ProvenanceTag provenance="observed" />
            </h3>
            <p className="mt-1 text-2xs text-muted-foreground text-pretty">
              The generator sees only these. It cannot cite anything that is not listed.
            </p>
            {lead.evidence.length > 0 ? (
              <ul className="mt-2.5 space-y-1.5">
                {lead.evidence.slice(0, 8).map((item) => (
                  <li key={item.id} className="flex gap-2 text-xs">
                    <span
                      className="mt-1.5 size-1 shrink-0 rounded-full bg-border-strong"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 text-pretty">{item.statement}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                No evidence recorded. Run verification and enrichment first.
              </p>
            )}
          </div>

          <div className="panel p-4">
            <h3 className="text-sm font-semibold">Channel rules</h3>
            <p className="mt-1 text-xs text-muted-foreground text-pretty">
              {CHANNEL_PROFILES[channel].styleGuidance}
            </p>
            <dl className="mt-2.5 space-y-1 text-2xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Target length</dt>
                <dd className="tabular font-medium">
                  {CHANNEL_PROFILES[channel].targetLength} chars
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Hard limit</dt>
                <dd className="tabular font-medium">{CHANNEL_PROFILES[channel].maxLength} chars</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Recipient</dt>
                <dd className="break-anywhere font-medium">{recipient ?? 'Not available'}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}

/* -------------------------------------------------------------------------- */

function DraftEditor({
  draft,
  lead,
  canSend,
  onRefine,
  refining,
}: {
  draft: MessageDraftView;
  lead: LeadDetail;
  canSend: boolean;
  onRefine: (instruction: string) => void;
  refining: boolean;
}) {
  const update = useUpdateDraft();
  const approve = useApproveDraft();
  const [body, setBody] = React.useState(draft.body);
  const [subject, setSubject] = React.useState(draft.subject ?? '');

  const dirty = body !== draft.body || subject !== (draft.subject ?? '');
  const errors = draft.validationErrors.filter((issue) => issue.severity === 'error');
  const overLimit = body.length > CHANNEL_PROFILES[draft.channel].maxLength;

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{titleCase(draft.kind)}</Badge>
          <Badge
            variant={
              draft.validationStatus === 'passed'
                ? 'success'
                : draft.validationStatus === 'failed'
                  ? 'destructive'
                  : draft.validationStatus === 'warned'
                    ? 'warning'
                    : 'default'
            }
          >
            {draft.validationStatus === 'passed'
              ? 'Grounded in evidence'
              : draft.validationStatus === 'failed'
                ? 'Failed validation'
                : draft.validationStatus === 'warned'
                  ? 'Review before sending'
                  : 'Not validated'}
          </Badge>
        </div>
        <span className="text-2xs text-muted-foreground">
          Written {relativeTime(draft.createdAt)}
        </span>
      </div>

      {draft.channel === 'email' ? (
        <div className="mt-3">
          <label htmlFor="studio-subject" className="eyebrow">
            Subject
          </label>
          <input
            id="studio-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
          />
        </div>
      ) : null}

      <div className="mt-3">
        <label htmlFor="studio-body" className="eyebrow">
          Message
        </label>
        <Textarea
          id="studio-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={9}
          className="mt-1 leading-relaxed"
          invalid={overLimit}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <LengthMeter channel={draft.channel} body={body} />
        {dirty ? (
          <div className="flex gap-1.5">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setBody(draft.body);
                setSubject(draft.subject ?? '');
              }}
            >
              Revert
            </Button>
            <Button
              variant="secondary"
              size="xs"
              loading={update.isPending}
              onClick={() => update.mutate({ id: draft.id, body, subject: subject || undefined })}
            >
              Save edit
            </Button>
          </div>
        ) : null}
      </div>

      {/* Validation detail */}
      {draft.validationErrors.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {draft.validationErrors.map((issue, index) => (
            <li
              key={`${issue.code}-${index}`}
              className={cn(
                'flex items-start gap-1.5 rounded-sm px-2 py-1.5 text-2xs',
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

      {/* Refinements */}
      <div className="mt-4 border-t border-border pt-3">
        <p className="eyebrow mb-2">Refine</p>
        <div className="flex flex-wrap gap-1.5">
          {REFINEMENTS.map((refinement) => (
            <Button
              key={refinement.label}
              variant="secondary"
              size="xs"
              disabled={refining}
              onClick={() => onRefine(refinement.instruction)}
            >
              {refinement.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="xs"
            disabled={refining}
            onClick={() => onRefine('Regenerate from scratch.')}
          >
            <RefreshCw aria-hidden="true" />
            Regenerate
          </Button>
        </div>
      </div>

      {/* Preview */}
      <div className="mt-4">
        <p className="eyebrow mb-2">Preview</p>
        <ChannelPreview
          channel={draft.channel}
          body={body}
          subject={subject}
          businessName={lead.canonicalName}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <AiProvenanceLine
          provider={draft.provider}
          model={draft.model}
          promptVersion={draft.promptVersion}
        />
        <div className="flex items-center gap-2">
          <Tooltip
            content={
              lead.suppression
                ? 'This lead is on the do-not-contact list.'
                : !canSend
                  ? 'No usable recipient on this channel.'
                  : errors.length > 0
                    ? 'Fix the validation errors before approving.'
                    : 'Approve and add to the send queue'
            }
          >
            <span>
              <Button
                variant="primary"
                size="sm"
                disabled={!canSend || errors.length > 0 || overLimit}
                loading={approve.isPending}
                onClick={async () => {
                  if (dirty)
                    await update.mutateAsync({ id: draft.id, body, subject: subject || undefined });
                  approve.mutate({ id: draft.id, body: { startSequence: true } });
                }}
              >
                <Send aria-hidden="true" />
                Approve and queue
              </Button>
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function preferredChannel(lead: LeadDetail): Channel {
  if (lead.phone) return 'whatsapp';
  if (lead.socialProfiles.some((p) => p.platform === 'instagram')) return 'instagram';
  if (lead.email) return 'email';
  return 'whatsapp';
}

function recipientFor(lead: LeadDetail, channel: Channel): string | null {
  if (channel === 'whatsapp') return lead.phone;
  if (channel === 'email') return lead.email;
  const instagram = lead.socialProfiles.find((p) => p.platform === 'instagram');
  return instagram ? (instagram.username ? `@${instagram.username}` : instagram.profileUrl) : null;
}
