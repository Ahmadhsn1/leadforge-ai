'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Globe,
  Instagram,
  Mail,
  MessageSquare,
  Phone,
  Sparkles,
  Star,
} from 'lucide-react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox, Tooltip } from '@/components/ui/primitives';
import { ScoreChip } from '@/components/ui/score';
import { cn, formatCount, relativeTime } from '@/lib/utils';
import type { LeadColumn } from '@/stores/ui';
import type { LeadStatus, VerificationStatus } from '@leadforge/shared';
import type { LeadSummary } from '@/types/api';

export const LEAD_STATUS_META: Record<
  LeadStatus,
  { label: string; tone: 'default' | 'primary' | 'success' | 'warning' | 'destructive' | 'info' }
> = {
  new: { label: 'New', tone: 'default' },
  qualified: { label: 'Qualified', tone: 'info' },
  ready: { label: 'Ready', tone: 'primary' },
  contacted: { label: 'Contacted', tone: 'primary' },
  replied: { label: 'Replied', tone: 'success' },
  interested: { label: 'Interested', tone: 'success' },
  meeting: { label: 'Meeting', tone: 'success' },
  won: { label: 'Won', tone: 'success' },
  lost: { label: 'Lost', tone: 'default' },
  do_not_contact: { label: 'Do not contact', tone: 'destructive' },
};

export const VERIFICATION_META: Record<
  VerificationStatus,
  { label: string; tone: 'default' | 'success' | 'warning' | 'destructive' | 'info' }
> = {
  pending: { label: 'Pending', tone: 'default' },
  verified: { label: 'Verified', tone: 'success' },
  probable: { label: 'Probable', tone: 'info' },
  needs_review: { label: 'Needs review', tone: 'warning' },
  rejected: { label: 'Rejected', tone: 'destructive' },
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const meta = LEAD_STATUS_META[status];
  return (
    <Badge
      variant={meta.tone === 'default' ? 'default' : meta.tone}
      className="gap-1.5 whitespace-nowrap"
    >
      <StatusDot tone={meta.tone} />
      {meta.label}
    </Badge>
  );
}

export function VerificationBadge({
  status,
  score,
}: {
  status: VerificationStatus;
  score?: number | null;
}) {
  const meta = VERIFICATION_META[status];
  return (
    <Tooltip
      content={
        score === null || score === undefined
          ? 'Verification has not run for this lead yet.'
          : `Verification score ${score}/100 from deterministic identity, contact and website checks.`
      }
    >
      <Badge
        variant={meta.tone === 'default' ? 'default' : meta.tone}
        className="whitespace-nowrap"
      >
        {meta.label}
        {typeof score === 'number' ? <span className="tabular opacity-70">{score}</span> : null}
      </Badge>
    </Tooltip>
  );
}

export interface SortState {
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

const COLUMN_META: Record<
  LeadColumn,
  { label: string; sortKey?: string; align?: 'right'; width?: string }
> = {
  business: { label: 'Business', sortKey: 'canonicalName', width: 'min-w-[240px]' },
  location: { label: 'Location', width: 'min-w-[140px]' },
  score: { label: 'Score', sortKey: 'leadScore', width: 'w-[110px]' },
  opportunity: { label: 'Opportunity', width: 'min-w-[220px]' },
  verification: { label: 'Verification', width: 'w-[130px]' },
  contactability: { label: 'Contact', width: 'w-[110px]' },
  website: { label: 'Website', width: 'w-[110px]' },
  social: { label: 'Social', width: 'w-[80px]' },
  channel: { label: 'Channel', width: 'w-[100px]' },
  status: { label: 'Status', width: 'w-[130px]' },
  activity: { label: 'Last activity', sortKey: 'updatedAt', width: 'w-[120px]' },
};

/**
 * The leads table. Dense by design, but every row still reads as a business:
 * name and place first, then the evidence-backed reason it matters, then the
 * operational state. Selection enables bulk actions rather than repeating a
 * menu on every row.
 */
export function LeadTable({
  leads,
  columns,
  sort,
  onSortChange,
  selectedIds,
  onSelectionChange,
  onOpenLead,
}: {
  leads: LeadSummary[];
  columns: LeadColumn[];
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onOpenLead?: (lead: LeadSummary) => void;
}) {
  const allSelected = leads.length > 0 && leads.every((lead) => selectedIds.has(lead.id));
  const someSelected = leads.some((lead) => selectedIds.has(lead.id)) && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      const next = new Set(selectedIds);
      leads.forEach((lead) => next.delete(lead.id));
      onSelectionChange(next);
    } else {
      const next = new Set(selectedIds);
      leads.forEach((lead) => next.add(lead.id));
      onSelectionChange(next);
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const handleSort = (key: string) => {
    onSortChange(
      sort.sortBy === key
        ? { sortBy: key, sortOrder: sort.sortOrder === 'asc' ? 'desc' : 'asc' }
        : { sortBy: key, sortOrder: 'desc' },
    );
  };

  return (
    // Wide content scrolls inside its own container; the page never scrolls sideways.
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          Prospects with score, verification status, opportunity signals and pipeline status.
          Sortable by business name, score and last activity.
        </caption>
        <thead>
          <tr className="border-b border-border bg-raised/60">
            <th scope="col" className="w-10 px-3 py-2">
              <Checkbox
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={toggleAll}
                aria-label={allSelected ? 'Deselect all rows' : 'Select all rows on this page'}
              />
            </th>
            {columns.map((column) => {
              const meta = COLUMN_META[column];
              const sortable = Boolean(meta.sortKey);
              const active = meta.sortKey === sort.sortBy;
              return (
                <th
                  key={column}
                  scope="col"
                  className={cn('px-3 py-2 text-left', meta.width)}
                  aria-sort={
                    active ? (sort.sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => handleSort(meta.sortKey as string)}
                      className="group inline-flex items-center gap-1 eyebrow transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {meta.label}
                      {active ? (
                        sort.sortOrder === 'asc' ? (
                          <ArrowUp className="size-3 text-primary" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="size-3 text-primary" aria-hidden="true" />
                        )
                      ) : (
                        <ArrowUpDown
                          className="size-3 opacity-0 transition-opacity group-hover:opacity-60"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  ) : (
                    <span className="eyebrow">{meta.label}</span>
                  )}
                </th>
              );
            })}
            <th scope="col" className="w-24 px-3 py-2">
              <span className="sr-only">Row actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {leads.map((lead) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              columns={columns}
              selected={selectedIds.has(lead.id)}
              onToggle={() => toggleOne(lead.id)}
              onOpen={onOpenLead}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeadRow({
  lead,
  columns,
  selected,
  onToggle,
  onOpen,
}: {
  lead: LeadSummary;
  columns: LeadColumn[];
  selected: boolean;
  onToggle: () => void;
  onOpen?: (lead: LeadSummary) => void;
}) {
  return (
    <tr
      className={cn('group transition-colors hover:bg-muted/40', selected && 'bg-primary/[0.05]')}
    >
      <td className="px-3 py-2.5 align-top">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`Select ${lead.canonicalName}`}
        />
      </td>

      {columns.map((column) => (
        <td key={column} className="px-3 py-2.5 align-top">
          {renderCell(lead, column)}
        </td>
      ))}

      {/* Row actions appear on hover but stay reachable by keyboard. */}
      <td className="px-3 py-2.5 align-top">
        <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {onOpen ? (
            <Tooltip content="Quick view">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onOpen(lead)}
                aria-label={`Quick view ${lead.canonicalName}`}
              >
                <Sparkles />
              </Button>
            </Tooltip>
          ) : null}
          <Button variant="secondary" size="xs" asChild>
            <Link href={`/dashboard/leads/${lead.id}`}>Open</Link>
          </Button>
        </div>
      </td>
    </tr>
  );
}

function renderCell(lead: LeadSummary, column: LeadColumn): React.ReactNode {
  switch (column) {
    case 'business':
      return (
        <div className="min-w-0">
          <Link
            href={`/dashboard/leads/${lead.id}`}
            className="block truncate font-medium leading-tight transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {lead.canonicalName}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
            {lead.category ? <span className="truncate capitalize">{lead.category}</span> : null}
            {lead.rating !== null ? (
              <span className="tabular inline-flex items-center gap-0.5">
                <Star className="size-2.5 fill-warning text-warning" aria-hidden="true" />
                {lead.rating.toFixed(1)}
                {lead.reviewCount ? (
                  <span className="opacity-70">({formatCount(lead.reviewCount, true)})</span>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
      );

    case 'location':
      return (
        <span className="block truncate text-xs text-muted-foreground">
          {[lead.city, lead.region].filter(Boolean).join(', ') || '—'}
        </span>
      );

    case 'score':
      return <ScoreChip score={lead.leadScore} />;

    case 'opportunity':
      return lead.signals.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {lead.signals.slice(0, 3).map((signal) => (
            <li key={signal}>
              <Badge variant="outline" className="whitespace-nowrap">
                {signal}
              </Badge>
            </li>
          ))}
          {lead.signals.length > 3 ? (
            <li>
              <Tooltip content={lead.signals.slice(3).join(' · ')}>
                <Badge variant="default">+{lead.signals.length - 3}</Badge>
              </Tooltip>
            </li>
          ) : null}
        </ul>
      ) : (
        <span className="text-2xs text-muted-foreground">Not analysed</span>
      );

    case 'verification':
      return <VerificationBadge status={lead.verificationStatus} score={lead.verificationScore} />;

    case 'contactability':
      return (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <ContactIcon icon={Phone} present={Boolean(lead.phone)} label="Phone" />
          <ContactIcon icon={Mail} present={Boolean(lead.email)} label="Email" />
          <ContactIcon icon={Globe} present={Boolean(lead.website)} label="Website" />
          <ContactIcon icon={Instagram} present={lead.hasInstagram} label="Instagram" />
        </div>
      );

    case 'website':
      return <WebsiteCell lead={lead} />;

    case 'social':
      return lead.hasInstagram ? (
        <Badge variant="primary" className="gap-1">
          <Instagram className="size-2.5" aria-hidden="true" />
          IG
        </Badge>
      ) : (
        <span className="text-2xs text-muted-foreground">—</span>
      );

    case 'channel':
      return lead.channel ? (
        <Badge variant="outline" className="capitalize">
          {lead.channel}
        </Badge>
      ) : (
        <span className="text-2xs text-muted-foreground">—</span>
      );

    case 'status':
      return (
        <div className="flex flex-col items-start gap-1">
          <LeadStatusBadge status={lead.status} />
          {lead.hasDraft ? (
            <Badge variant="accent" className="gap-1">
              <MessageSquare className="size-2.5" aria-hidden="true" />
              Draft ready
            </Badge>
          ) : null}
        </div>
      );

    case 'activity':
      return (
        <time
          className="tabular block whitespace-nowrap text-2xs text-muted-foreground"
          dateTime={lead.updatedAt}
        >
          {relativeTime(lead.lastActivityAt ?? lead.updatedAt)}
        </time>
      );

    default:
      return null;
  }
}

function ContactIcon({
  icon: Icon,
  present,
  label,
}: {
  icon: React.ElementType;
  present: boolean;
  label: string;
}) {
  return (
    <Tooltip content={present ? `${label} available` : `No ${label.toLowerCase()} on record`}>
      <span
        className={cn('inline-flex', present ? 'text-foreground' : 'text-muted-foreground/30')}
        role="img"
        aria-label={present ? `${label} available` : `No ${label.toLowerCase()}`}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}

function WebsiteCell({ lead }: { lead: LeadSummary }) {
  const meta = {
    none: {
      label: 'None',
      variant: 'warning' as const,
      help: 'No website found on the listing or by resolution.',
    },
    active: {
      label: 'Active',
      variant: 'success' as const,
      help: 'Site resolved and returned a healthy response.',
    },
    broken: {
      label: 'Broken',
      variant: 'destructive' as const,
      help: 'Site did not resolve or returned an error.',
    },
    uncertain: {
      label: 'Unchecked',
      variant: 'default' as const,
      help: 'Website enrichment has not run yet.',
    },
  }[lead.websiteStatus];

  return (
    <Tooltip content={meta.help}>
      <Badge variant={meta.variant} className="whitespace-nowrap">
        {meta.label}
      </Badge>
    </Tooltip>
  );
}

/** Mobile presentation: a table would overflow, so rows become cards. */
export function LeadCardList({
  leads,
  selectedIds,
  onSelectionChange,
}: {
  leads: LeadSummary[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
}) {
  return (
    <ul className="divide-y divide-border">
      {leads.map((lead) => (
        <li key={lead.id} className="p-3">
          <div className="flex items-start gap-3">
            <Checkbox
              className="mt-1"
              checked={selectedIds.has(lead.id)}
              onCheckedChange={() => {
                const next = new Set(selectedIds);
                if (next.has(lead.id)) next.delete(lead.id);
                else next.add(lead.id);
                onSelectionChange(next);
              }}
              aria-label={`Select ${lead.canonicalName}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/dashboard/leads/${lead.id}`}
                  className="min-w-0 font-medium hover:text-primary"
                >
                  <span className="block truncate">{lead.canonicalName}</span>
                </Link>
                <ScoreChip score={lead.leadScore} showLabel={false} />
              </div>
              <p className="mt-0.5 truncate text-2xs text-muted-foreground">
                {[lead.city, lead.category].filter(Boolean).join(' · ') || 'Location unknown'}
              </p>
              {lead.signals.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1">
                  {lead.signals.slice(0, 3).map((signal) => (
                    <li key={signal}>
                      <Badge variant="outline">{signal}</Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <LeadStatusBadge status={lead.status} />
                <VerificationBadge
                  status={lead.verificationStatus}
                  score={lead.verificationScore}
                />
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
