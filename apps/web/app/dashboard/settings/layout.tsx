'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  Blocks,
  Building2,
  CreditCard,
  Gauge,
  Send,
  Shield,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react';
import { PageHeader, PageShell } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';

const SETTINGS_NAV = [
  {
    href: '/dashboard/settings/profile',
    label: 'Profile',
    icon: UserRound,
    description: 'Your name and email',
  },
  {
    href: '/dashboard/settings/workspace',
    label: 'Workspace',
    icon: Building2,
    description: 'Name and defaults',
  },
  {
    href: '/dashboard/settings/team',
    label: 'Team',
    icon: Users,
    description: 'Members and roles',
  },
  {
    href: '/dashboard/settings/integrations',
    label: 'Integrations',
    icon: Blocks,
    description: 'Providers',
  },
  {
    href: '/dashboard/settings/ai',
    label: 'AI',
    icon: Sparkles,
    description: 'Routing and budget',
  },
  {
    href: '/dashboard/settings/outreach',
    label: 'Outreach',
    icon: Send,
    description: 'Sequences and limits',
  },
  {
    href: '/dashboard/settings/notifications',
    label: 'Notifications',
    icon: Bell,
    description: 'What we tell you',
  },
  {
    href: '/dashboard/settings/security',
    label: 'Security',
    icon: Shield,
    description: 'Sessions and audit',
  },
  {
    href: '/dashboard/settings/billing',
    label: 'Billing',
    icon: CreditCard,
    description: 'Plan and usage',
  },
  {
    href: '/dashboard/settings/health',
    label: 'Health',
    icon: Gauge,
    description: 'Services and queues',
  },
] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title="Settings"
        description="Workspace configuration, integrations and account security."
      />

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav
          aria-label="Settings"
          className="lg:sticky lg:top-[calc(theme(spacing.topbar)+1.25rem)] lg:self-start"
        >
          {/* Horizontal scroll on small screens rather than a cramped stack. */}
          <ul className="flex gap-1 overflow-x-auto no-scrollbar lg:flex-col lg:overflow-visible">
            {SETTINGS_NAV.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <li key={item.href} className="shrink-0 lg:shrink">
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'bg-primary/12 font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon
                      className={cn('size-3.5 shrink-0', active && 'text-primary')}
                      aria-hidden="true"
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </PageShell>
  );
}
