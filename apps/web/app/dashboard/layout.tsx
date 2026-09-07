'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { CommandPalette } from '@/components/layout/command-palette';
import { Dialog, SheetContent } from '@/components/ui/dialog';
import { DialogTitle } from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/states';
import {
  useConversations,
  useMe,
  useNotifications,
  useOutreachQueue,
  useUsage,
} from '@/lib/queries';
import { api } from '@/lib/api-client';
import { useUiStore } from '@/stores/ui';
import DashboardLoading from './loading';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const closeMobileNav = useUiStore((s) => s.closeMobileNav);

  const me = useMe();
  const usage = useUsage({ enabled: me.isSuccess });
  const notifications = useNotifications({ enabled: me.isSuccess });

  // Counts that drive the sidebar attention badges.
  const pendingApprovals = useOutreachQueue({ status: 'draft', pageSize: 1 });
  const needsHuman = useConversations({ status: 'needs_human' });

  React.useEffect(() => {
    if (me.isError && me.error.isAuthError) router.replace('/login');
  }, [me.isError, me.error, router]);

  const handleSignOut = React.useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      queryClient.clear();
      router.replace('/login');
    }
  }, [queryClient, router]);

  const handleSwitchOrganization = React.useCallback(
    async (organizationId: string) => {
      try {
        await api.post('/auth/switch-organization', { organizationId });
        await queryClient.invalidateQueries();
        toast.success('Workspace switched');
      } catch {
        toast.error('Could not switch workspace');
      }
    },
    [queryClient],
  );

  if (me.isError && !me.error.isAuthError) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <ErrorState
          title="Cannot reach LeadForge"
          description={me.error.userMessage}
          onRetry={() => me.refetch()}
          retrying={me.isFetching}
        />
      </main>
    );
  }

  const counts = {
    pendingApprovals: pendingApprovals.data?.total ?? 0,
    needsHuman: needsHuman.data?.total ?? 0,
  };

  const sidebar = (
    <Sidebar
      me={me.data}
      usage={usage.data}
      counts={counts}
      onSwitchOrganization={handleSwitchOrganization}
      onSignOut={handleSignOut}
    />
  );

  return (
    <div className="flex min-h-dvh bg-background">
      {/* Desktop sidebar */}
      <div className="sticky top-0 hidden h-dvh shrink-0 lg:block">{sidebar}</div>

      {/* Mobile navigation drawer */}
      <Dialog open={mobileNavOpen} onOpenChange={(open) => (open ? undefined : closeMobileNav())}>
        <SheetContent side="left" size="sm" className="w-[15rem] p-0 lg:hidden">
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          {sidebar}
        </SheetContent>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar notifications={notifications.data} />
        <main id="main" className="flex-1 focus-visible:outline-none" tabIndex={-1}>
          {/* Pages read filters from the URL, so they render on demand behind a
              boundary and show their skeleton while the segment loads. */}
          <React.Suspense fallback={<DashboardLoading />}>{children}</React.Suspense>
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}
