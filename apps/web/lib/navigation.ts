import {
  BarChart3,
  Blocks,
  Brain,
  Building2,
  Gauge,
  Inbox,
  LayoutDashboard,
  MessageSquareText,
  Send,
  Settings,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly description: string;
  /** Badge key resolved at render time from live counts. */
  readonly badge?: 'needsHuman' | 'pendingApprovals';
  /** Matches child routes for the active state. */
  readonly matchPrefix?: boolean;
}

export interface NavSection {
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: 'Main',
    items: [
      {
        label: 'Overview',
        href: '/dashboard',
        icon: LayoutDashboard,
        description: 'Pipeline health and what needs attention today',
      },
      {
        label: 'Campaigns',
        href: '/dashboard/campaigns',
        icon: Target,
        description: 'Define who to find and run the discovery pipeline',
        matchPrefix: true,
      },
      {
        label: 'Leads',
        href: '/dashboard/leads',
        icon: Building2,
        description: 'Every prospect, ranked and explainable',
        matchPrefix: true,
      },
      {
        label: 'Outreach',
        href: '/dashboard/outreach',
        icon: Send,
        description: 'Review and approve messages before they send',
        badge: 'pendingApprovals',
        matchPrefix: true,
      },
      {
        label: 'Conversations',
        href: '/dashboard/conversations',
        icon: Inbox,
        description: 'Unified inbox with reply intelligence',
        badge: 'needsHuman',
        matchPrefix: true,
      },
      {
        label: 'Analytics',
        href: '/dashboard/analytics',
        icon: BarChart3,
        description: 'Funnel, reply quality and what is working',
        matchPrefix: true,
      },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      {
        label: 'AI Insights',
        href: '/dashboard/insights',
        icon: Brain,
        description: 'Patterns across your prospect base',
      },
      {
        label: 'Message Studio',
        href: '/dashboard/studio',
        icon: MessageSquareText,
        description: 'Craft and test channel-native messages',
        matchPrefix: true,
      },
      {
        label: 'AI Usage',
        href: '/dashboard/usage',
        icon: Sparkles,
        description: 'Model mix, latency and spend',
      },
    ],
  },
  {
    label: 'Workspace',
    items: [
      {
        label: 'Team',
        href: '/dashboard/settings/team',
        icon: Users,
        description: 'Members and roles',
      },
      {
        label: 'Integrations',
        href: '/dashboard/settings/integrations',
        icon: Blocks,
        description: 'Discovery, AI and messaging providers',
      },
      {
        label: 'Health',
        href: '/dashboard/settings/health',
        icon: Gauge,
        description: 'Queues and service status',
      },
      {
        label: 'Settings',
        href: '/dashboard/settings',
        icon: Settings,
        description: 'Profile, workspace, outreach and security',
      },
    ],
  },
];

export const ALL_NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

/** Human-readable breadcrumb labels for path segments that are not IDs. */
export const SEGMENT_LABELS: Readonly<Record<string, string>> = {
  dashboard: 'Overview',
  campaigns: 'Campaigns',
  leads: 'Leads',
  outreach: 'Outreach',
  conversations: 'Conversations',
  analytics: 'Analytics',
  insights: 'AI Insights',
  studio: 'Message Studio',
  usage: 'AI Usage',
  settings: 'Settings',
  team: 'Team',
  integrations: 'Integrations',
  health: 'Health',
  profile: 'Profile',
  workspace: 'Workspace',
  security: 'Security',
  billing: 'Billing',
  notifications: 'Notifications',
  ai: 'AI',
  new: 'New',
  queue: 'Queue',
  scheduled: 'Scheduled',
  sent: 'Sent',
  replies: 'Replies',
  suppressed: 'Suppressed',
  sequences: 'Sequences',
};

export function isActivePath(pathname: string, item: NavItem): boolean {
  if (item.href === '/dashboard') return pathname === '/dashboard';
  if (item.matchPrefix) return pathname === item.href || pathname.startsWith(`${item.href}/`);
  return pathname === item.href;
}
