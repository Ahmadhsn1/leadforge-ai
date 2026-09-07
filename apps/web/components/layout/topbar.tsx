'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Bell, ChevronRight, CircleHelp, Menu, Moon, Search, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/states';
import { SEGMENT_LABELS } from '@/lib/navigation';
import { useUiStore } from '@/stores/ui';
import { cn, relativeTime } from '@/lib/utils';
import type { NotificationView } from '@/types/api';

export function Topbar({
  notifications,
  contextLabel,
}: {
  notifications: NotificationView[] | undefined;
  /** Overrides the last breadcrumb, e.g. a lead's business name. */
  contextLabel?: string;
}) {
  const openMobileNav = useUiStore((s) => s.openMobileNav);
  const openPalette = useUiStore((s) => s.setCommandPaletteOpen);
  const unread = notifications?.filter((n) => !n.read).length ?? 0;

  return (
    <header className="sticky top-0 z-sticky flex h-topbar shrink-0 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <Button
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        onClick={openMobileNav}
        aria-label="Open navigation menu"
      >
        <Menu />
      </Button>

      <Breadcrumbs contextLabel={contextLabel} />

      <div className="ml-auto flex items-center gap-1">
        {/* Search is a button, not an input: it opens the palette so there is
            one search surface rather than two competing ones. */}
        <button
          type="button"
          onClick={() => openPalette(true)}
          className="hidden items-center gap-2 rounded-md border border-border bg-surface py-1.5 pl-2.5 pr-2 text-left text-xs text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex sm:w-56 lg:w-72"
        >
          <Search className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1 truncate">Search leads, campaigns…</span>
          <kbd className="rounded-sm border border-border bg-muted px-1 py-px font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="sm:hidden"
          onClick={() => openPalette(true)}
          aria-label="Search"
        >
          <Search />
        </Button>

        <NotificationBell notifications={notifications} unread={unread} />
        <ThemeToggle />

        <Tooltip content="Documentation and help">
          <Button variant="ghost" size="icon-sm" asChild>
            <a href="/help" aria-label="Help and documentation">
              <CircleHelp />
            </a>
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}

function Breadcrumbs({ contextLabel }: { contextLabel?: string }) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  const crumbs = segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join('/')}`;
    const isLast = index === segments.length - 1;
    const looksLikeId = segment.length > 16 && !SEGMENT_LABELS[segment];
    const label =
      isLast && contextLabel
        ? contextLabel
        : (SEGMENT_LABELS[segment] ?? (looksLikeId ? 'Detail' : segment));
    return { href, label, isLast };
  });

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => (
          <li key={crumb.href} className="flex min-w-0 items-center gap-1">
            {index > 0 ? (
              <ChevronRight
                className="size-3 shrink-0 text-muted-foreground/50"
                aria-hidden="true"
              />
            ) : null}
            {crumb.isLast ? (
              <span className="truncate font-medium" aria-current="page">
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="truncate text-muted-foreground transition-colors hover:text-foreground"
              >
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function NotificationBell({
  notifications,
  unread,
}: {
  notifications: NotificationView[] | undefined;
  unread: number;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell />
          {unread > 0 ? (
            <span
              className="absolute right-1 top-1 flex size-1.5 rounded-full bg-primary ring-2 ring-background"
              aria-hidden="true"
            />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unread > 0 ? (
            <span className="tabular rounded-sm bg-primary/15 px-1.5 py-px text-2xs font-semibold text-primary">
              {unread} new
            </span>
          ) : null}
        </div>
        <DropdownMenuSeparator className="mx-0 my-0" />
        <div className="max-h-80 overflow-y-auto">
          {!notifications || notifications.length === 0 ? (
            <EmptyState
              compact
              title="Nothing new"
              description="Campaign completions, replies and integration issues appear here."
            />
          ) : (
            notifications.map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                asChild
                className="items-start gap-2 rounded-none px-3 py-2.5"
              >
                <Link href={notification.href ?? '#'}>
                  <span
                    className={cn(
                      'mt-1.5 size-1.5 shrink-0 rounded-full',
                      notification.read ? 'bg-transparent' : 'bg-primary',
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-snug">
                      {notification.title}
                    </span>
                    {notification.body ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground text-pretty">
                        {notification.body}
                      </span>
                    ) : null}
                    <span className="mt-1 block text-2xs text-muted-foreground/80">
                      {relativeTime(notification.createdAt)}
                    </span>
                  </span>
                </Link>
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <Tooltip content={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {/* Rendered only after mount so the icon matches the resolved theme. */}
        {mounted && resolvedTheme === 'dark' ? <Sun /> : <Moon />}
      </Button>
    </Tooltip>
  );
}
