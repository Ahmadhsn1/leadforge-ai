'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { useTheme } from 'next-themes';
import {
  ArrowRight,
  Building2,
  Inbox,
  Loader2,
  Moon,
  Plus,
  Search,
  Sun,
  Target,
  Upload,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ALL_NAV_ITEMS } from '@/lib/navigation';
import { useGlobalSearch } from '@/lib/queries';
import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/utils';

/** ⌘K palette: navigation, creation and universal search in one surface. */
export function CommandPalette() {
  const router = useRouter();
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const toggle = useUiStore((s) => s.toggleCommandPalette);
  const [query, setQuery] = React.useState('');
  const { setTheme, resolvedTheme } = useTheme();

  const debounced = useDebouncedValue(query, 200);
  const { data: results, isFetching } = useGlobalSearch(debounced);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggle();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const go = React.useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router, setOpen],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="lg" hideClose className="gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search leads, campaigns and conversations, or jump to any page.
        </DialogDescription>
        <Command shouldFilter={false} loop className="flex max-h-[70dvh] flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search leads, campaigns, conversations — or type a command"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            />
            {isFetching ? (
              <Loader2
                className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
            ) : null}
            <kbd className="hidden shrink-0 rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground sm:block">
              ESC
            </kbd>
          </div>

          <Command.List className="flex-1 overflow-y-auto overscroll-contain p-1.5">
            <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
              {debounced.length >= 2 ? (
                <>
                  No matches for <span className="font-medium text-foreground">“{debounced}”</span>.
                </>
              ) : (
                'Type at least two characters to search.'
              )}
            </Command.Empty>

            {results?.map((group) =>
              group.items.length > 0 ? (
                <Group key={group.type} heading={groupHeading(group.type)}>
                  {group.items.map((item) => (
                    <Item
                      key={item.id}
                      onSelect={() => go(item.href)}
                      value={`${group.type}-${item.id}`}
                    >
                      <GroupIcon type={group.type} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.title}</span>
                        {item.subtitle ? (
                          <span className="block truncate text-2xs text-muted-foreground">
                            {item.subtitle}
                          </span>
                        ) : null}
                      </span>
                      {item.meta ? (
                        <span className="tabular shrink-0 text-2xs text-muted-foreground">
                          {item.meta}
                        </span>
                      ) : null}
                    </Item>
                  ))}
                </Group>
              ) : null,
            )}

            <Group heading="Create">
              <Item value="create-campaign" onSelect={() => go('/dashboard/campaigns/new')}>
                <Plus className="size-3.5 text-muted-foreground" aria-hidden="true" />
                New campaign
                <Shortcut>C</Shortcut>
              </Item>
              <Item value="import-leads" onSelect={() => go('/dashboard/leads/import')}>
                <Upload className="size-3.5 text-muted-foreground" aria-hidden="true" />
                Import leads from CSV
              </Item>
            </Group>

            <Group heading="Go to">
              {ALL_NAV_ITEMS.filter((item) =>
                debounced.length < 2
                  ? true
                  : item.label.toLowerCase().includes(debounced.toLowerCase()),
              ).map((item) => {
                const Icon = item.icon;
                return (
                  <Item key={item.href} value={`nav-${item.href}`} onSelect={() => go(item.href)}>
                    <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block">{item.label}</span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                    <ArrowRight
                      className="size-3 shrink-0 text-muted-foreground/60"
                      aria-hidden="true"
                    />
                  </Item>
                );
              })}
            </Group>

            <Group heading="Preferences">
              <Item
                value="toggle-theme"
                onSelect={() => {
                  setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
                  setOpen(false);
                }}
              >
                {resolvedTheme === 'dark' ? (
                  <Sun className="size-3.5 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <Moon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                )}
                Switch to {resolvedTheme === 'dark' ? 'light' : 'dark'} mode
              </Item>
            </Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  children,
  onSelect,
  value,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  value: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2 py-2 text-sm',
        'data-[selected=true]:bg-muted data-[selected=true]:text-foreground',
      )}
    >
      {children}
    </Command.Item>
  );
}

function Shortcut({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ml-auto rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
      {children}
    </kbd>
  );
}

function GroupIcon({ type }: { type: string }) {
  const Icon = type === 'lead' ? Building2 : type === 'campaign' ? Target : Inbox;
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

function groupHeading(type: string): string {
  return { lead: 'Leads', campaign: 'Campaigns', conversation: 'Conversations' }[type] ?? type;
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
