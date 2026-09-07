'use client';

import * as React from 'react';
import { Activity as ActivityIcon } from 'lucide-react';
import { ACTIVITY_LABELS, type ActivityType } from '@leadforge/shared';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/states';
import { cn, formatDateTime, relativeTime } from '@/lib/utils';
import type { ActivityView } from '@/types/api';

const TONE_BY_TYPE: Partial<
  Record<ActivityType, 'primary' | 'success' | 'warning' | 'destructive'>
> = {
  discovered: 'primary',
  verified: 'success',
  analyzed: 'primary',
  scored: 'primary',
  message_approved: 'primary',
  sent: 'primary',
  delivered: 'success',
  replied: 'success',
  meeting: 'success',
  won: 'success',
  lost: 'warning',
  suppressed: 'warning',
  error: 'destructive',
};

/** Chronological record of every meaningful state change on a lead. */
export function LeadActivityTimeline({ activities }: { activities: ActivityView[] }) {
  if (activities.length === 0) {
    return (
      <div className="panel">
        <EmptyState
          icon={<ActivityIcon />}
          title="No activity recorded"
          description="Discovery, verification, analysis, message approvals and replies are all written here as they happen."
        />
      </div>
    );
  }

  return (
    <ol className="panel space-y-0 p-4">
      {activities.map((activity, index) => {
        const tone = TONE_BY_TYPE[activity.type];
        return (
          <li key={activity.id} className="relative flex gap-3 pb-4 last:pb-0">
            {index < activities.length - 1 ? (
              <span
                className="absolute left-[5px] top-4 h-[calc(100%-8px)] w-px bg-border"
                aria-hidden="true"
              />
            ) : null}
            <span
              className={cn(
                'relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-background',
                tone === 'primary' && 'bg-primary',
                tone === 'success' && 'bg-success',
                tone === 'warning' && 'bg-warning',
                tone === 'destructive' && 'bg-destructive',
                !tone && 'bg-border-strong',
              )}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <Badge variant="outline">{ACTIVITY_LABELS[activity.type] ?? activity.type}</Badge>
                <time
                  className="text-2xs text-muted-foreground"
                  dateTime={activity.createdAt}
                  title={formatDateTime(activity.createdAt)}
                >
                  {relativeTime(activity.createdAt)}
                </time>
                <span className="text-2xs text-muted-foreground">
                  · {activity.actor === 'system' ? 'System' : (activity.actorName ?? 'Provider')}
                </span>
              </div>
              <p className="mt-1 text-sm text-pretty">{activity.summary}</p>
              {Object.keys(activity.metadata ?? {}).length > 0 ? (
                <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted-foreground">
                  {Object.entries(activity.metadata)
                    .filter(([, value]) => typeof value !== 'object')
                    .slice(0, 5)
                    .map(([key, value]) => (
                      <div key={key} className="flex gap-1">
                        <dt className="capitalize">
                          {key.replace(/([A-Z])/g, ' $1').toLowerCase()}:
                        </dt>
                        <dd className="font-medium text-foreground">{String(value)}</dd>
                      </div>
                    ))}
                </dl>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
