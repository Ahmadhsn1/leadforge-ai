'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Section } from '@/components/layout/page-header';
import { Switch } from '@/components/ui/primitives';
import { CardSkeleton } from '@/components/ui/states';
import { api, type ApiError } from '@/lib/api-client';

interface NotificationPreferences {
  campaignCompleted: boolean;
  highPriorityLeads: boolean;
  newReply: boolean;
  needsHuman: boolean;
  jobFailures: boolean;
  integrationIssues: boolean;
  aiBudgetWarnings: boolean;
  weeklySummary: boolean;
}

const OPTIONS: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  {
    key: 'campaignCompleted',
    label: 'Campaign finished processing',
    description: 'When a run completes, with a summary of what it found.',
  },
  {
    key: 'highPriorityLeads',
    label: 'High-priority leads found',
    description: 'When new leads score 90 or above.',
  },
  {
    key: 'newReply',
    label: 'New reply received',
    description: 'When a prospect replies on any channel.',
  },
  {
    key: 'needsHuman',
    label: 'Conversation needs a human',
    description:
      'When a reply is classified as an objection, an opt-out, or otherwise not safe to auto-handle.',
  },
  {
    key: 'jobFailures',
    label: 'Jobs failed permanently',
    description: 'When a pipeline job exhausts its retries and lands in the dead-letter queue.',
  },
  {
    key: 'integrationIssues',
    label: 'Integration needs attention',
    description: 'When a provider starts rejecting requests or a token expires.',
  },
  {
    key: 'aiBudgetWarnings',
    label: 'AI budget warnings',
    description: 'At 75% and 90% of the monthly AI budget.',
  },
  {
    key: 'weeklySummary',
    label: 'Weekly summary',
    description: 'Pipeline movement, reply quality and what changed, once a week.',
  },
];

export default function NotificationSettingsPage() {
  const queryClient = useQueryClient();
  const prefs = useQuery<NotificationPreferences, ApiError>({
    queryKey: ['notification-preferences'],
    queryFn: () => api.get<NotificationPreferences>('/notifications/preferences'),
  });

  const [saving, setSaving] = React.useState<string | null>(null);

  async function toggle(key: keyof NotificationPreferences, value: boolean) {
    setSaving(key);
    try {
      await api.patch('/notifications/preferences', { [key]: value });
      await queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    } catch {
      toast.error('Could not save that preference');
    } finally {
      setSaving(null);
    }
  }

  if (prefs.isLoading) return <CardSkeleton className="h-72" />;

  return (
    <Section
      title="Notifications"
      description="What LeadForge tells you about. In-app notifications always appear in the bell menu; these control which ones."
    >
      <div className="panel divide-y divide-border">
        {OPTIONS.map((option) => (
          <label
            key={option.key}
            className="flex cursor-pointer items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/30"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground text-pretty">
                {option.description}
              </span>
            </span>
            <Switch
              checked={prefs.data?.[option.key] ?? false}
              disabled={saving === option.key}
              onCheckedChange={(value) => toggle(option.key, value)}
              aria-label={option.label}
            />
          </label>
        ))}
      </div>
    </Section>
  );
}
