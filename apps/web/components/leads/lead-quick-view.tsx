'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink, Globe, Mail, MapPin, Phone, Sparkles, Star } from 'lucide-react';
import { Dialog, DialogTitle, SheetContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScoreRing } from '@/components/ui/score';
import { AiRecommendation, ClaimCard, ProvenanceTag } from '@/components/intelligence/trust';
import { CardSkeleton, EmptyState, ErrorState, Skeleton } from '@/components/ui/states';
import { LeadStatusBadge, VerificationBadge } from './lead-table';
import { useLead } from '@/lib/queries';
import { formatCount } from '@/lib/utils';

/**
 * Right-hand drawer showing why a lead matters without leaving the list.
 * The full intelligence page is one click away for the complete record.
 */
export function LeadQuickView({
  leadId,
  onOpenChange,
}: {
  leadId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: lead, isLoading, isError, error, refetch } = useLead(leadId ?? undefined);

  return (
    <Dialog open={Boolean(leadId)} onOpenChange={onOpenChange}>
      <SheetContent side="right" size="lg" className="gap-0 p-0">
        <DialogTitle className="sr-only">{lead?.canonicalName ?? 'Lead detail'}</DialogTitle>

        {isLoading ? (
          <div className="space-y-4 p-5">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : isError ? (
          <ErrorState description={error.userMessage} onRetry={() => refetch()} />
        ) : lead ? (
          <>
            <header className="border-b border-border p-5 pr-12">
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold leading-tight tracking-tight text-balance">
                    {lead.canonicalName}
                  </h2>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" aria-hidden="true" />
                      {[lead.city, lead.region, lead.country].filter(Boolean).join(', ') ||
                        'Location unknown'}
                    </span>
                    {lead.category ? <span className="capitalize">· {lead.category}</span> : null}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <LeadStatusBadge status={lead.status} />
                    <VerificationBadge
                      status={lead.verificationStatus}
                      score={lead.verificationScore}
                    />
                    {lead.rating !== null ? (
                      <Badge variant="outline" className="gap-1">
                        <Star className="size-2.5 fill-warning text-warning" aria-hidden="true" />
                        {lead.rating.toFixed(1)} · {formatCount(lead.reviewCount ?? 0, true)}{' '}
                        reviews
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <ScoreRing score={lead.leadScore} size="md" />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" size="sm" asChild>
                  <Link href={`/dashboard/leads/${lead.id}`}>
                    Open full intelligence
                    <ExternalLink aria-hidden="true" />
                  </Link>
                </Button>
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/dashboard/studio/${lead.id}`}>
                    <Sparkles aria-hidden="true" />
                    Message studio
                  </Link>
                </Button>
              </div>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {/* Contact */}
              <section>
                <h3 className="eyebrow mb-2">Contact</h3>
                <ul className="space-y-1.5 text-sm">
                  <ContactLine
                    icon={Phone}
                    value={lead.phone}
                    href={lead.phone ? `tel:${lead.phone}` : null}
                  />
                  <ContactLine
                    icon={Mail}
                    value={lead.email}
                    href={lead.email ? `mailto:${lead.email}` : null}
                  />
                  <ContactLine icon={Globe} value={lead.website} href={lead.website} external />
                </ul>
              </section>

              {/* Why this lead */}
              {lead.intelligence ? (
                <section className="space-y-3">
                  <h3 className="eyebrow">Why this lead</h3>
                  <p className="text-sm leading-relaxed text-pretty">{lead.intelligence.summary}</p>

                  <AiRecommendation body={lead.intelligence.recommendedAngle} />

                  {lead.intelligence.painPoints.length > 0 ? (
                    <div className="space-y-2">
                      {lead.intelligence.painPoints.slice(0, 3).map((claim, index) => (
                        <ClaimCard
                          key={`${claim.statement}-${index}`}
                          title="Pain point"
                          statement={claim.statement}
                          confidence={claim.confidence}
                          tone="pain"
                          evidence={lead.evidence.filter((e) => claim.evidenceIds.includes(e.id))}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : (
                <EmptyState
                  compact
                  icon={<Sparkles />}
                  title="Not analysed yet"
                  description="Run AI analysis to see the pain points, opportunities and recommended angle for this business."
                  action={
                    <Button size="sm" variant="secondary" asChild>
                      <Link href={`/dashboard/leads/${lead.id}`}>Open lead</Link>
                    </Button>
                  }
                />
              )}

              {/* Evidence */}
              {lead.evidence.length > 0 ? (
                <section>
                  <h3 className="eyebrow mb-2 flex items-center gap-2">
                    Evidence
                    <ProvenanceTag provenance="observed" />
                  </h3>
                  <ul className="space-y-1">
                    {lead.evidence.slice(0, 4).map((item) => (
                      <li
                        key={item.id}
                        className="rounded-md border border-border bg-surface px-3 py-2 text-xs"
                      >
                        <p className="text-pretty">{item.statement}</p>
                        <p className="mt-0.5 text-2xs capitalize text-muted-foreground">
                          {item.source.replace(/_/g, ' ')} · {Math.round(item.confidence * 100)}%
                          confidence
                        </p>
                      </li>
                    ))}
                  </ul>
                  {lead.evidence.length > 4 ? (
                    <Link
                      href={`/dashboard/leads/${lead.id}#evidence`}
                      className="mt-2 inline-block text-2xs font-medium text-primary hover:underline"
                    >
                      View all {lead.evidence.length} records
                    </Link>
                  ) : null}
                </section>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Dialog>
  );
}

function ContactLine({
  icon: Icon,
  value,
  href,
  external,
}: {
  icon: React.ElementType;
  value: string | null;
  href: string | null;
  external?: boolean;
}) {
  return (
    <li className="flex items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {value ? (
        href ? (
          <a
            href={href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
            className="break-anywhere text-primary hover:underline"
          >
            {value}
          </a>
        ) : (
          <span className="break-anywhere">{value}</span>
        )
      ) : (
        <span className="text-muted-foreground">Not on record</span>
      )}
    </li>
  );
}
