'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  Ban,
  Building2,
  CheckCircle2,
  ExternalLink,
  Globe,
  Instagram,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
} from 'lucide-react';
import { PageShell, Section } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScoreRing, DimensionBar, ConfidenceMeter } from '@/components/ui/score';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives';
import {
  AiProvenanceLine,
  AiRecommendation,
  ClaimCard,
  EvidenceCard,
  ProvenanceTag,
} from '@/components/intelligence/trust';
import { CardSkeleton, EmptyState, ErrorState, Skeleton } from '@/components/ui/states';
import { LeadStatusBadge, VerificationBadge } from '@/components/leads/lead-table';
import { LeadActivityTimeline } from '@/components/leads/lead-activity';
import { LeadCrmPanel } from '@/components/leads/lead-crm';
import { useAnalyzeLead, useLead } from '@/lib/queries';
import { cn, formatCount, formatDateTime, relativeTime, titleCase } from '@/lib/utils';
import type { LeadDetail } from '@/types/api';

export default function LeadIntelligencePage() {
  const params = useParams<{ leadId: string }>();
  const leadId = params.leadId;
  const { data: lead, isLoading, isError, error, refetch, isFetching } = useLead(leadId);
  const analyze = useAnalyzeLead(leadId);

  if (isLoading) return <LeadSkeleton />;

  if (isError) {
    return (
      <PageShell>
        <ErrorState
          title={error.isNotFound ? 'Lead not found' : 'Could not load this lead'}
          description={
            error.isNotFound
              ? 'It may have been merged into another record or removed from this workspace.'
              : error.userMessage
          }
          onRetry={error.isNotFound ? undefined : () => refetch()}
          retrying={isFetching}
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

  return (
    <PageShell wide className="space-y-5">
      <LeadHeader
        lead={lead}
        onAnalyze={() => analyze.mutate({ force: true })}
        analyzing={analyze.isPending}
      />

      {lead.suppression ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-3"
        >
          <Ban className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-destructive">
              This lead is on the do-not-contact list
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
              Suppressed by {lead.suppression.scope} ·{' '}
              {lead.suppression.reason ?? 'no reason recorded'}. Outreach is blocked before queueing
              and before sending.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Main column */}
        <div className="min-w-0 space-y-5">
          <WhyThisLead lead={lead} />

          <Tabs defaultValue="intelligence">
            <TabsList>
              <TabsTrigger value="intelligence">Intelligence</TabsTrigger>
              <TabsTrigger value="evidence" count={lead.evidence.length}>
                Evidence
              </TabsTrigger>
              <TabsTrigger value="verification">Verification</TabsTrigger>
              <TabsTrigger value="messages" count={lead.drafts.length}>
                Messages
              </TabsTrigger>
              <TabsTrigger value="activity" count={lead.activities.length}>
                Activity
              </TabsTrigger>
            </TabsList>

            <TabsContent value="intelligence">
              <IntelligenceTab
                lead={lead}
                onAnalyze={() => analyze.mutate({ force: true })}
                analyzing={analyze.isPending}
              />
            </TabsContent>

            <TabsContent value="evidence" id="evidence">
              <EvidenceTab lead={lead} />
            </TabsContent>

            <TabsContent value="verification">
              <VerificationTab lead={lead} />
            </TabsContent>

            <TabsContent value="messages">
              <MessagesTab lead={lead} />
            </TabsContent>

            <TabsContent value="activity">
              <LeadActivityTimeline activities={lead.activities} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <ScorePanel lead={lead} />
          <SnapshotPanel lead={lead} />
          <LeadCrmPanel lead={lead} />
        </div>
      </div>
    </PageShell>
  );
}

/* -------------------------------------------------------------------------- */

function LeadHeader({
  lead,
  onAnalyze,
  analyzing,
}: {
  lead: LeadDetail;
  onAnalyze: () => void;
  analyzing: boolean;
}) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <ScoreRing score={lead.leadScore} size="lg" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-balance">
            {lead.canonicalName}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden="true" />
              {[lead.city, lead.region, lead.country].filter(Boolean).join(', ') ||
                'Location unknown'}
            </span>
            {lead.category ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="capitalize">{lead.category}</span>
              </>
            ) : null}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <LeadStatusBadge status={lead.status} />
            <VerificationBadge status={lead.verificationStatus} score={lead.verificationScore} />
            {lead.rating !== null ? (
              <Badge variant="outline" className="gap-1">
                <Star className="size-2.5 fill-warning text-warning" aria-hidden="true" />
                {lead.rating.toFixed(1)} · {formatCount(lead.reviewCount ?? 0, true)} reviews
              </Badge>
            ) : null}
            {lead.campaigns.map((campaign) => (
              <Badge key={campaign.id} variant="outline" asChild>
                <Link href={`/dashboard/campaigns/${campaign.id}`}>{campaign.name}</Link>
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button variant="secondary" size="md" onClick={onAnalyze} loading={analyzing}>
          {analyzing ? null : <RefreshCw aria-hidden="true" />}
          Re-analyse
        </Button>
        <Button variant="primary" size="md" asChild>
          <Link href={`/dashboard/studio/${lead.id}`}>
            <Sparkles aria-hidden="true" />
            Generate message
          </Link>
        </Button>
      </div>
    </header>
  );
}

/**
 * The "Why this lead?" block — the single most important component in the app.
 * It states the priority, the supporting facts, and the recommended angle,
 * each labelled with how it is known.
 */
function WhyThisLead({ lead }: { lead: LeadDetail }) {
  const report = lead.intelligence;
  const facts = buildFacts(lead);

  if (!report && facts.length === 0) {
    return (
      <div className="panel">
        <EmptyState
          icon={<Sparkles />}
          title="This lead has not been analysed yet"
          description="Verification and enrichment collect the facts; AI analysis turns them into pain points, opportunities and a recommended angle."
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border surface-gradient p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-md font-semibold tracking-tight">Why this lead?</h2>
        {lead.temperature !== 'unscored' ? (
          <Badge
            variant={
              lead.temperature === 'hot'
                ? 'destructive'
                : lead.temperature === 'warm'
                  ? 'warning'
                  : 'info'
            }
            size="md"
            className="uppercase"
          >
            {lead.temperature === 'hot' ? 'High priority' : titleCase(lead.temperature)}
          </Badge>
        ) : null}
      </div>

      {facts.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {facts.map((fact) => (
            <li key={fact.text} className="flex items-start gap-2 text-sm">
              <span
                className={cn(
                  'mt-1.5 size-1.5 shrink-0 rounded-full',
                  fact.tone === 'positive'
                    ? 'bg-success'
                    : fact.tone === 'gap'
                      ? 'bg-warning'
                      : 'bg-muted-foreground',
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 text-pretty">{fact.text}</span>
              <ProvenanceTag provenance="observed" showHelp={false} className="mt-px shrink-0" />
            </li>
          ))}
        </ul>
      ) : null}

      {report ? (
        <>
          <p className="mt-4 text-base leading-relaxed text-pretty">{report.summary}</p>
          <AiRecommendation
            className="mt-4"
            body={report.recommendedAngle}
            meta={
              <AiProvenanceLine
                provider={report.provider}
                model={report.model}
                promptVersion={report.promptVersion}
                createdAt={report.createdAt}
              />
            }
            action={
              <Button variant="ai" size="sm" asChild>
                <Link href={`/dashboard/studio/${lead.id}?angle=recommended`}>Use this angle</Link>
              </Button>
            }
          />
        </>
      ) : null}
    </div>
  );
}

interface Fact {
  text: string;
  tone: 'positive' | 'gap' | 'neutral';
}

/** Observable facts, derived from stored data only — never from the model. */
function buildFacts(lead: LeadDetail): Fact[] {
  const facts: Fact[] = [];

  if (lead.rating !== null && lead.reviewCount !== null && lead.reviewCount > 0) {
    const strong = lead.rating >= 4.2 && lead.reviewCount >= 50;
    facts.push({
      text: `${lead.rating.toFixed(1)}★ across ${formatCount(lead.reviewCount)} public reviews${
        strong ? ' — strong local reputation' : ''
      }`,
      tone: strong ? 'positive' : 'neutral',
    });
  }

  if (lead.websiteStatus === 'none') {
    facts.push({
      text: 'No dedicated website detected on the listing or by resolution',
      tone: 'gap',
    });
  } else if (lead.websiteStatus === 'broken') {
    facts.push({ text: 'Website is listed but did not resolve to a healthy page', tone: 'gap' });
  } else if (lead.websiteAnalysis) {
    const missing: string[] = [];
    if (!lead.websiteAnalysis.hasBookingCta) missing.push('no booking or enquiry CTA');
    if (!lead.websiteAnalysis.hasContactPage) missing.push('no contact page');
    if (!lead.websiteAnalysis.isHttps) missing.push('not served over HTTPS');
    if (!lead.websiteAnalysis.hasViewport) missing.push('no mobile viewport');
    if (missing.length > 0) {
      facts.push({ text: `Website is live but ${missing.join(', ')}`, tone: 'gap' });
    } else {
      facts.push({
        text: 'Website is live with contact and conversion paths in place',
        tone: 'positive',
      });
    }
  }

  const instagram = lead.socialProfiles.find((p) => p.platform === 'instagram');
  if (instagram) {
    facts.push({ text: 'Active public Instagram profile found', tone: 'positive' });
  }

  const contactable = [lead.phone, lead.email].filter(Boolean).length;
  if (contactable > 0) {
    facts.push({
      text: `Reachable by ${[lead.phone ? 'phone' : null, lead.email ? 'email' : null].filter(Boolean).join(' and ')}`,
      tone: 'positive',
    });
  } else {
    facts.push({ text: 'No direct phone or email on record yet', tone: 'gap' });
  }

  return facts;
}

/* -------------------------------------------------------------------------- */

function IntelligenceTab({
  lead,
  onAnalyze,
  analyzing,
}: {
  lead: LeadDetail;
  onAnalyze: () => void;
  analyzing: boolean;
}) {
  const report = lead.intelligence;

  if (!report) {
    return (
      <div className="panel">
        <EmptyState
          icon={<Sparkles />}
          title="No analysis yet"
          description="AI analysis reads the stored evidence and produces grounded pain points, opportunities and a recommended angle. It never invents observations."
          action={
            <Button variant="primary" size="sm" onClick={onAnalyze} loading={analyzing}>
              Run analysis
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {report.painPoints.length > 0 ? (
        <Section
          title="Pain points"
          description="Problems the model inferred from observed evidence."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {report.painPoints.map((claim, index) => (
              <ClaimCard
                key={`pain-${index}`}
                title={shortTitle(claim.statement)}
                statement={claim.statement}
                confidence={claim.confidence}
                tone="pain"
                evidence={lead.evidence.filter((e) => claim.evidenceIds.includes(e.id))}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {report.opportunities.length > 0 ? (
        <Section
          title="Opportunities"
          description="What you could offer, and the evidence that suggests it."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {report.opportunities.map((claim, index) => (
              <ClaimCard
                key={`opp-${index}`}
                title={shortTitle(claim.statement)}
                statement={claim.statement}
                confidence={claim.confidence}
                tone="opportunity"
                evidence={lead.evidence.filter((e) => claim.evidenceIds.includes(e.id))}
                action={
                  <Button variant="ghost" size="xs" asChild>
                    <Link href={`/dashboard/studio/${lead.id}`}>Draft</Link>
                  </Button>
                }
              />
            ))}
          </div>
        </Section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {report.strengths.length > 0 ? (
          <ListPanel
            title="Strengths"
            items={report.strengths}
            icon={<CheckCircle2 />}
            tone="success"
          />
        ) : null}
        {report.objections.length > 0 ? (
          <ListPanel
            title="Likely objections"
            items={report.objections}
            icon={<AlertTriangle />}
            tone="warning"
          />
        ) : null}
        {report.unknowns.length > 0 ? (
          <ListPanel
            title="Unknowns"
            items={report.unknowns}
            icon={<Building2 />}
            tone="muted"
            description="Gaps the system is explicit about rather than guessing."
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3.5 py-2.5">
        <AiProvenanceLine
          provider={report.provider}
          model={report.model}
          promptVersion={report.promptVersion}
          createdAt={report.createdAt}
        />
        <div className="flex items-center gap-2">
          <ConfidenceMeter value={report.confidence} size="md" />
          <Button variant="ghost" size="xs" onClick={onAnalyze} loading={analyzing}>
            Re-run
          </Button>
        </div>
      </div>
    </div>
  );
}

function ListPanel({
  title,
  items,
  icon,
  tone,
  description,
}: {
  title: string;
  items: string[];
  icon: React.ReactNode;
  tone: 'success' | 'warning' | 'muted';
  description?: string;
}) {
  return (
    <div className="panel p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <span
          className={cn(
            '[&_svg]:size-3.5',
            tone === 'success' && 'text-success',
            tone === 'warning' && 'text-warning',
            tone === 'muted' && 'text-muted-foreground',
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
        {title}
      </h3>
      {description ? (
        <p className="mt-1 text-2xs text-muted-foreground text-pretty">{description}</p>
      ) : null}
      <ul className="mt-2.5 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm text-pretty">
            <span
              className="mt-1.5 size-1 shrink-0 rounded-full bg-border-strong"
              aria-hidden="true"
            />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceTab({ lead }: { lead: LeadDetail }) {
  if (lead.evidence.length === 0) {
    return (
      <div className="panel">
        <EmptyState
          icon={<ShieldCheck />}
          title="No evidence recorded yet"
          description="Verification and enrichment write an evidence record for every meaningful observation, with its source, timestamp and confidence."
        />
      </div>
    );
  }

  const grouped = lead.evidence.reduce<Record<string, typeof lead.evidence>>((acc, item) => {
    (acc[item.type] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground text-pretty">
        Everything the system claims about this business traces back to one of these records. Each
        shows what was observed, where it came from, when, and how confident the check was.
      </p>
      {Object.entries(grouped).map(([type, items]) => (
        <Section key={type} title={titleCase(type)}>
          <div className="space-y-1.5">
            {items.map((item) => (
              <EvidenceCard key={item.id} evidence={item} />
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}

function VerificationTab({ lead }: { lead: LeadDetail }) {
  const verification = lead.verification;
  const website = lead.websiteAnalysis;

  if (!verification) {
    return (
      <div className="panel">
        <EmptyState
          icon={<ShieldCheck />}
          title="Verification has not run"
          description="Verification is deterministic: identity, phone format, website reachability, domain match and geography are each checked and recorded."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Verification checks</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Run {relativeTime(verification.createdAt)} · deterministic, not model-decided
            </p>
          </div>
          <div className="flex items-center gap-2">
            <VerificationBadge status={verification.status} />
            <span className="tabular text-2xl font-semibold">{verification.score}</span>
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
        </div>

        <ul className="mt-4 divide-y divide-border">
          {verification.checks.map((check) => (
            <li key={check.check} className="flex items-start gap-3 py-2.5">
              <span
                className={cn(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
                  check.passed ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
                )}
                aria-hidden="true"
              >
                {check.passed ? (
                  <CheckCircle2 className="size-3" />
                ) : (
                  <AlertTriangle className="size-3" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{titleCase(check.check)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{check.detail}</p>
              </div>
              <span className="tabular shrink-0 text-2xs text-muted-foreground">
                weight {(check.weight * 100).toFixed(0)}%
              </span>
              <span className="sr-only">{check.passed ? 'Passed' : 'Not passed'}</span>
            </li>
          ))}
        </ul>
      </div>

      {website ? (
        <div className="panel p-4">
          <h3 className="text-sm font-semibold">Website analysis</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Checked {relativeTime(website.checkedAt)}
            {website.finalUrl ? ` · resolved to ${website.finalUrl}` : ''}
          </p>

          {website.error ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
              <p className="text-xs text-pretty">
                <span className="font-medium">We could not verify this website.</span>{' '}
                {website.error}
              </p>
            </div>
          ) : null}

          <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            <Fact
              label="HTTP status"
              value={website.httpStatus ? String(website.httpStatus) : '—'}
            />
            <Fact label="HTTPS" value={website.isHttps ? 'Yes' : 'No'} good={website.isHttps} />
            <Fact label="Redirects" value={String(website.redirectCount)} />
            <Fact
              label="Response time"
              value={website.responseTimeMs ? `${website.responseTimeMs} ms` : '—'}
            />
            <Fact
              label="Contact page"
              value={website.hasContactPage ? 'Found' : 'Not found'}
              good={website.hasContactPage}
            />
            <Fact
              label="Booking CTA"
              value={website.hasBookingCta ? 'Found' : 'Not found'}
              good={website.hasBookingCta}
            />
            <Fact
              label="Menu or services"
              value={website.hasMenuOrServices ? 'Found' : 'Not found'}
              good={website.hasMenuOrServices}
            />
            <Fact
              label="Mobile viewport"
              value={website.hasViewport ? 'Present' : 'Missing'}
              good={website.hasViewport}
            />
            <Fact
              label="Name matches site"
              value={website.identityMatch ? 'Yes' : 'Unconfirmed'}
              good={website.identityMatch}
            />
          </dl>

          {website.opportunitySignals.length > 0 ? (
            <>
              <Separator className="my-3" />
              <p className="eyebrow mb-2">Observable gaps</p>
              <ul className="flex flex-wrap gap-1.5">
                {website.opportunitySignals.map((signal) => (
                  <li key={signal}>
                    <Badge variant="warning">{signal}</Badge>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-sm',
          good === true && 'text-success',
          good === false && 'text-muted-foreground',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function MessagesTab({ lead }: { lead: LeadDetail }) {
  if (lead.drafts.length === 0) {
    return (
      <div className="panel">
        <EmptyState
          icon={<MessageSquare />}
          title="No messages drafted yet"
          description="Message Studio uses this lead's evidence and recommended angle to write channel-native drafts, then validates them against the facts before you approve."
          action={
            <Button variant="primary" size="sm" asChild>
              <Link href={`/dashboard/studio/${lead.id}`}>
                <Sparkles aria-hidden="true" />
                Open Message Studio
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {lead.drafts.map((draft) => (
        <article key={draft.id} className="panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="primary" className="capitalize">
                {draft.channel}
              </Badge>
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
                Validation {draft.validationStatus}
              </Badge>
            </div>
            <span className="text-2xs text-muted-foreground">{relativeTime(draft.createdAt)}</span>
          </div>

          {draft.subject ? <p className="mt-2.5 text-sm font-medium">{draft.subject}</p> : null}
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-pretty">
            {draft.body}
          </p>

          {draft.validationErrors.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {draft.validationErrors.map((issue, index) => (
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

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
            <AiProvenanceLine
              provider={draft.provider}
              model={draft.model}
              promptVersion={draft.promptVersion}
            />
            <Button variant="secondary" size="xs" asChild>
              <Link href={`/dashboard/studio/${lead.id}?draft=${draft.id}`}>Open in studio</Link>
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ScorePanel({ lead }: { lead: LeadDetail }) {
  const score = lead.score;

  return (
    <div className="panel p-4">
      <h2 className="text-sm font-semibold">Lead score</h2>
      {!score ? (
        <EmptyState
          compact
          title="Not scored"
          description="Scoring runs once verification, enrichment and analysis have completed."
        />
      ) : (
        <>
          <div className="mt-3 flex justify-center">
            <ScoreRing score={score.total} size="xl" />
          </div>

          <div className="mt-4 space-y-2.5">
            <DimensionBar label="ICP fit" value={score.fit} />
            <DimensionBar label="Opportunity" value={score.opportunity} />
            <DimensionBar label="Contactability" value={score.contactability} />
            <DimensionBar label="Business maturity" value={score.maturity} />
            <DimensionBar label="Evidence confidence" value={score.confidence} />
            <DimensionBar label="Urgency" value={score.urgency} />
          </div>

          <Accordion type="single" collapsible className="mt-3 border-t border-border pt-1">
            <AccordionItem value="explanation">
              <AccordionTrigger className="text-xs">How this score was calculated</AccordionTrigger>
              <AccordionContent>
                <ul className="space-y-2">
                  {score.explanation.map((entry, index) => (
                    <li key={`${entry.dimension}-${index}`} className="text-xs">
                      <span className="font-medium capitalize">{titleCase(entry.dimension)}</span>
                      <span className="tabular ml-1 text-muted-foreground">
                        {Math.round(entry.value)}
                      </span>
                      <p className="mt-0.5 text-muted-foreground text-pretty">{entry.reason}</p>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-2xs text-muted-foreground text-pretty">
                  Weights:{' '}
                  {Object.entries(score.weights)
                    .map(([k, v]) => `${titleCase(k)} ${Math.round(v * 100)}%`)
                    .join(' · ')}
                  . Method:{' '}
                  {score.method === 'deterministic' ? 'deterministic rules' : 'AI-assisted'}.
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}
    </div>
  );
}

function SnapshotPanel({ lead }: { lead: LeadDetail }) {
  return (
    <div className="panel p-4">
      <h2 className="text-sm font-semibold">Business snapshot</h2>
      <dl className="mt-3 space-y-2.5 text-sm">
        <SnapshotRow
          icon={Phone}
          label="Phone"
          value={lead.phone}
          href={lead.phone ? `tel:${lead.phone}` : null}
        />
        <SnapshotRow
          icon={Mail}
          label="Email"
          value={lead.email}
          href={lead.email ? `mailto:${lead.email}` : null}
        />
        <SnapshotRow
          icon={Globe}
          label="Website"
          value={lead.website}
          href={lead.website}
          external
        />
        {lead.socialProfiles.map((profile) => (
          <SnapshotRow
            key={profile.id}
            icon={Instagram}
            label={titleCase(profile.platform)}
            value={profile.username ? `@${profile.username}` : profile.profileUrl}
            href={profile.profileUrl}
            external
          />
        ))}
        <SnapshotRow icon={MapPin} label="Address" value={lead.address} />
        <SnapshotRow
          icon={Building2}
          label="Source"
          value={titleCase(lead.source)}
          href={lead.sourceUrl}
          external
        />
      </dl>

      <Separator className="my-3" />

      <dl className="grid grid-cols-2 gap-2 text-2xs">
        <div>
          <dt className="eyebrow">Discovered</dt>
          <dd className="mt-0.5">{formatDateTime(lead.createdAt)}</dd>
        </div>
        <div>
          <dt className="eyebrow">Last verified</dt>
          <dd className="mt-0.5">{lead.verifiedAt ? relativeTime(lead.verifiedAt) : 'Never'}</dd>
        </div>
        <div>
          <dt className="eyebrow">Last analysed</dt>
          <dd className="mt-0.5">{lead.analyzedAt ? relativeTime(lead.analyzedAt) : 'Never'}</dd>
        </div>
        <div>
          <dt className="eyebrow">Last scored</dt>
          <dd className="mt-0.5">{lead.scoredAt ? relativeTime(lead.scoredAt) : 'Never'}</dd>
        </div>
      </dl>
    </div>
  );
}

function SnapshotRow({
  icon: Icon,
  label,
  value,
  href,
  external,
}: {
  icon: React.ElementType;
  label: string;
  value: string | null;
  href?: string | null;
  external?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <dt className="sr-only">{label}</dt>
      <dd className="min-w-0 flex-1">
        {value ? (
          href ? (
            <a
              href={href}
              {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
              className="inline-flex items-start gap-1 break-anywhere text-primary hover:underline"
            >
              <span className="min-w-0">{value}</span>
              {external ? (
                <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              ) : null}
            </a>
          ) : (
            <span className="break-anywhere">{value}</span>
          )
        ) : (
          <span className="text-muted-foreground">
            {label} <span className="italic">not on record</span>
          </span>
        )}
      </dd>
    </div>
  );
}

function shortTitle(statement: string): string {
  const firstClause = statement.split(/[.;:]/)[0] ?? statement;
  return firstClause.length > 60 ? `${firstClause.slice(0, 57)}…` : firstClause;
}

function LeadSkeleton() {
  return (
    <PageShell wide className="space-y-5">
      <div className="flex items-start gap-4">
        <Skeleton className="size-[88px] rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-40 rounded-lg" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <div className="space-y-3">
          <CardSkeleton className="h-72" />
          <CardSkeleton />
        </div>
      </div>
    </PageShell>
  );
}
