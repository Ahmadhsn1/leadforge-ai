'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Check,
  ChevronsUpDown,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  User,
} from 'lucide-react';
import { NAV_SECTIONS, isActivePath, type NavItem } from '@/lib/navigation';
import { useUiStore } from '@/stores/ui';
import { Logo, Wordmark } from './logo';
import { Button } from '@/components/ui/button';
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Progress,
  Tooltip,
} from '@/components/ui/primitives';
import { cn, formatCount, initials } from '@/lib/utils';
import type { MeResponse, UsageView } from '@/types/api';

export interface SidebarCounts {
  needsHuman?: number;
  pendingApprovals?: number;
}

export function Sidebar({
  me,
  usage,
  counts,
  onSwitchOrganization,
  onSignOut,
}: {
  me: MeResponse | undefined;
  usage: UsageView | undefined;
  counts: SidebarCounts;
  onSwitchOrganization: (organizationId: string) => void;
  onSignOut: () => void;
}) {
  const pathname = usePathname();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const closeMobile = useUiStore((s) => s.closeMobileNav);

  const leadQuota = usage?.quotas.find((q) => q.metric === 'leads');

  return (
    <nav
      aria-label="Main"
      className={cn(
        'flex h-full flex-col border-r border-border bg-surface transition-[width] duration-200 ease-out',
        collapsed ? 'w-sidebar-collapsed' : 'w-sidebar',
      )}
      data-collapsed={collapsed}
    >
      {/* Brand */}
      <div
        className={cn(
          'flex h-topbar shrink-0 items-center border-b border-border',
          collapsed ? 'justify-center px-2' : 'px-3',
        )}
      >
        <Link
          href="/dashboard"
          onClick={closeMobile}
          className="flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="LeadForge AI home"
        >
          {collapsed ? <Logo size={22} /> : <Wordmark />}
        </Link>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-1 px-2">
            {collapsed ? (
              <div className="mx-2 my-2 h-px bg-border" aria-hidden="true" />
            ) : (
              <p className="eyebrow px-2 py-1.5">{section.label}</p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <SidebarLink
                    item={item}
                    active={isActivePath(pathname, item)}
                    collapsed={collapsed}
                    count={item.badge ? counts[item.badge] : undefined}
                    onNavigate={closeMobile}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Usage meter */}
      {!collapsed && leadQuota ? (
        <div className="mx-2 mb-2 rounded-md border border-border bg-raised p-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="eyebrow">Leads this month</span>
            <span className="tabular text-2xs font-medium">
              {formatCount(leadQuota.used, true)}
              <span className="text-muted-foreground"> / {formatCount(leadQuota.limit, true)}</span>
            </span>
          </div>
          <Progress
            value={leadQuota.pct * 100}
            tone={
              leadQuota.pct > 0.9 ? 'destructive' : leadQuota.pct > 0.75 ? 'warning' : 'primary'
            }
            className="mt-1.5 h-1"
            aria-label={`${Math.round(leadQuota.pct * 100)}% of the monthly lead quota used`}
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-2xs capitalize text-muted-foreground">{usage?.plan} plan</span>
            <Link
              href="/dashboard/settings/billing"
              className="text-2xs font-medium text-primary hover:underline"
            >
              Upgrade
            </Link>
          </div>
        </div>
      ) : null}

      {/* Workspace + user */}
      <div className="border-t border-border p-2">
        <WorkspaceSwitcher me={me} collapsed={collapsed} onSwitch={onSwitchOrganization} />
        <div className={cn('mt-1 flex items-center gap-1', collapsed && 'flex-col')}>
          <UserMenu me={me} collapsed={collapsed} onSignOut={onSignOut} />
          <Tooltip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggle}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              className="hidden shrink-0 lg:inline-flex"
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
          </Tooltip>
        </div>
      </div>
    </nav>
  );
}

function SidebarLink({
  item,
  active,
  collapsed,
  count,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  count?: number;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        collapsed && 'justify-center px-0 py-2',
        active
          ? 'bg-primary/12 text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {/* Active rail — a second, non-colour cue for the current page. */}
      <span
        className={cn(
          'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-primary transition-opacity',
          active ? 'opacity-100' : 'opacity-0',
        )}
        aria-hidden="true"
      />
      <Icon className={cn('size-4 shrink-0', active && 'text-primary')} aria-hidden="true" />
      {collapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && count && count > 0 ? (
        <span className="tabular rounded-sm bg-primary/15 px-1.5 py-px text-2xs font-semibold text-primary">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
      {collapsed && count && count > 0 ? (
        <span
          className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary"
          aria-label={`${count} items need attention`}
        />
      ) : null}
    </Link>
  );

  return collapsed ? (
    <Tooltip
      side="right"
      content={
        <span className="block">
          <span className="block font-medium">{item.label}</span>
          <span className="block text-muted-foreground">{item.description}</span>
        </span>
      }
    >
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function WorkspaceSwitcher({
  me,
  collapsed,
  onSwitch,
}: {
  me: MeResponse | undefined;
  collapsed: boolean;
  onSwitch: (id: string) => void;
}) {
  const current = me?.organization;
  const organizations = me?.organizations ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-muted',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            collapsed && 'justify-center px-0',
          )}
          aria-label={`Workspace: ${current?.name ?? 'none'}. Switch workspace`}
        >
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-2xs font-bold text-primary"
            aria-hidden="true"
          >
            {initials(current?.name ?? '?')}
          </span>
          {collapsed ? null : (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">
                  {current?.name ?? 'Loading…'}
                </span>
                <span className="block truncate text-2xs capitalize text-muted-foreground">
                  {current?.role ?? ''}
                </span>
              </span>
              <ChevronsUpDown
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={collapsed ? 'right' : 'top'} className="w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {organizations.map((org) => (
          <DropdownMenuItem key={org.id} onSelect={() => onSwitch(org.id)}>
            <span
              className="flex size-5 items-center justify-center rounded-sm bg-muted text-[9px] font-bold"
              aria-hidden="true"
            >
              {initials(org.name)}
            </span>
            <span className="min-w-0 flex-1 truncate">{org.name}</span>
            {org.id === current?.id ? (
              <Check className="size-3.5 text-primary" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings/workspace">
            <Plus />
            Workspace settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({
  me,
  collapsed,
  onSignOut,
}: {
  me: MeResponse | undefined;
  collapsed: boolean;
  onSignOut: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-left transition-colors hover:border-border hover:bg-muted',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            collapsed && 'flex-none justify-center px-0',
          )}
          aria-label="Account menu"
        >
          <Avatar size="xs">
            <AvatarFallback>{initials(me?.user.name)}</AvatarFallback>
          </Avatar>
          {collapsed ? null : (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{me?.user.name ?? '—'}</span>
              <span className="block truncate text-2xs text-muted-foreground">
                {me?.user.email ?? ''}
              </span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel>{me?.user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings/profile">
            <User />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Destructive action is separated from ordinary navigation. */}
        <DropdownMenuItem destructive onSelect={onSignOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
