'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Laptop, LogOut, Shield, Smartphone } from 'lucide-react';
import { Section } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { api, type ApiError } from '@/lib/api-client';
import { formatDateTime, relativeTime, titleCase } from '@/lib/utils';

interface SessionView {
  id: string;
  current: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  lastSeenAt: string;
  createdAt: string;
  expiresAt: string;
}

interface AuditEntry {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  userName: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export default function SecuritySettingsPage() {
  const queryClient = useQueryClient();

  const sessions = useQuery<SessionView[], ApiError>({
    queryKey: ['sessions'],
    queryFn: () => api.get<SessionView[]>('/auth/sessions'),
  });

  const audit = useQuery<{ items: AuditEntry[] }, ApiError>({
    queryKey: ['audit'],
    queryFn: () =>
      api.get<{ items: AuditEntry[] }>('/organizations/audit-log', { query: { pageSize: 25 } }),
  });

  return (
    <div className="space-y-6">
      <Section
        title="Active sessions"
        description="Every device signed in to your account. Revoking a session signs it out immediately."
      >
        {sessions.isLoading ? (
          <CardSkeleton className="h-40" />
        ) : sessions.isError ? (
          <div className="panel">
            <ErrorState
              description={sessions.error.userMessage}
              onRetry={() => sessions.refetch()}
            />
          </div>
        ) : (
          <div className="panel divide-y divide-border">
            {(sessions.data ?? []).map((session) => {
              const mobile = /mobile|android|iphone/i.test(session.userAgent ?? '');
              const Icon = mobile ? Smartphone : Laptop;
              return (
                <div key={session.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm">
                      {describeAgent(session.userAgent)}
                      {session.current ? (
                        <Badge variant="success" size="sm">
                          This device
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-2xs text-muted-foreground">
                      {session.ipAddress ?? 'Unknown IP'} · active{' '}
                      {relativeTime(session.lastSeenAt)} · expires{' '}
                      {formatDateTime(session.expiresAt)}
                    </p>
                  </div>
                  {!session.current ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={async () => {
                        await api.delete(`/auth/sessions/${session.id}`);
                        await queryClient.invalidateQueries({ queryKey: ['sessions'] });
                        toast.success('Session revoked');
                      }}
                    >
                      <LogOut aria-hidden="true" />
                      Revoke
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={async () => {
            await api.post('/auth/sessions/revoke-others');
            await queryClient.invalidateQueries({ queryKey: ['sessions'] });
            toast.success('All other sessions signed out');
          }}
        >
          <Shield aria-hidden="true" />
          Sign out everywhere else
        </Button>
      </Section>

      <Section
        title="Audit log"
        description="Security-sensitive and important business changes in this workspace."
      >
        {audit.isLoading ? (
          <CardSkeleton className="h-48" />
        ) : audit.data && audit.data.items.length > 0 ? (
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Audit log entries with action, resource, actor and timestamp.
              </caption>
              <thead>
                <tr className="border-b border-border bg-raised/60 text-left">
                  {['When', 'Action', 'Resource', 'By', 'IP'].map((header) => (
                    <th key={header} scope="col" className="px-3 py-2">
                      <span className="eyebrow">{header}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {audit.data.items.map((entry) => (
                  <tr key={entry.id} className="hover:bg-muted/40">
                    <td className="whitespace-nowrap px-3 py-2 text-2xs text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">{titleCase(entry.action)}</Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {titleCase(entry.resource)}
                      {entry.resourceId ? (
                        <span className="ml-1 font-mono text-2xs opacity-60">
                          {entry.resourceId.slice(0, 8)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{entry.userName ?? 'System'}</td>
                    <td className="px-3 py-2 font-mono text-2xs text-muted-foreground">
                      {entry.ipAddress ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="panel">
            <EmptyState
              compact
              icon={<Shield />}
              title="No audit entries yet"
              description="Sign-ins, member changes, integration updates and outreach approvals are recorded here."
            />
          </div>
        )}
      </Section>
    </div>
  );
}

function describeAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Firefox/i.test(userAgent)
    ? 'Firefox'
    : /Edg/i.test(userAgent)
      ? 'Edge'
      : /Chrome/i.test(userAgent)
        ? 'Chrome'
        : /Safari/i.test(userAgent)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/i.test(userAgent)
    ? 'Windows'
    : /Mac OS X|Macintosh/i.test(userAgent)
      ? 'macOS'
      : /Android/i.test(userAgent)
        ? 'Android'
        : /iPhone|iPad/i.test(userAgent)
          ? 'iOS'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : 'Unknown OS';
  return `${browser} on ${os}`;
}
