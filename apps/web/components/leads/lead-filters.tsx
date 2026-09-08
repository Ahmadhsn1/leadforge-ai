'use client';

import * as React from 'react';
import { Bookmark, Columns3, Filter, Search, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from '@/components/ui/primitives';
import {
  Select as SelectRoot,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LEAD_STATUSES, TEMPERATURES, VERIFICATION_STATUSES } from '@leadforge/shared';
import { LEAD_COLUMNS, useUiStore, type LeadColumn } from '@/stores/ui';
import { cn, titleCase } from '@/lib/utils';
import type { LeadListParams } from '@/lib/queries';

const COLUMN_LABELS: Record<LeadColumn, string> = {
  business: 'Business',
  location: 'Location',
  score: 'Score',
  opportunity: 'Opportunity',
  verification: 'Verification',
  contactability: 'Contact',
  website: 'Website',
  social: 'Social',
  channel: 'Channel',
  status: 'Status',
  activity: 'Last activity',
};

export function LeadFilters({
  params,
  onChange,
  onReset,
  total,
}: {
  params: LeadListParams;
  onChange: (next: Partial<LeadListParams>) => void;
  onReset: () => void;
  total: number | undefined;
}) {
  const [searchDraft, setSearchDraft] = React.useState(params.search ?? '');
  const columns = useUiStore((s) => s.leadColumns);
  const toggleColumn = useUiStore((s) => s.toggleLeadColumn);
  const savedFilters = useUiStore((s) => s.savedFilters);
  const saveFilter = useUiStore((s) => s.saveFilter);
  const removeFilter = useUiStore((s) => s.removeFilter);

  React.useEffect(() => setSearchDraft(params.search ?? ''), [params.search]);

  // Debounce the search so typing does not fire a request per keystroke.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if ((params.search ?? '') !== searchDraft)
        onChange({ search: searchDraft || undefined, page: 1 });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchDraft, params.search, onChange]);

  const activeFilters = countActiveFilters(params);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[200px] flex-1 sm:max-w-xs">
          <Label htmlFor="lead-search" className="sr-only">
            Search leads
          </Label>
          <Input
            id="lead-search"
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search by business, phone or domain"
            leadingIcon={<Search />}
            className="h-8"
          />
        </div>

        <QuickSelect
          label="Status"
          value={params.status}
          options={LEAD_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))}
          onChange={(value) => onChange({ status: value, page: 1 })}
        />
        <QuickSelect
          label="Priority"
          value={params.temperature}
          options={TEMPERATURES.filter((t) => t !== 'unscored').map((t) => ({
            value: t,
            label: titleCase(t),
          }))}
          onChange={(value) => onChange({ temperature: value, page: 1 })}
        />
        <QuickSelect
          label="Verification"
          value={params.verificationStatus}
          options={VERIFICATION_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))}
          onChange={(value) => onChange({ verificationStatus: value, page: 1 })}
        />

        <ScoreRangeFilter params={params} onChange={onChange} />

        <div className="ml-auto flex items-center gap-1.5">
          {savedFilters.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Bookmark aria-hidden="true" />
                  Saved
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>Saved views</DropdownMenuLabel>
                {savedFilters.map((filter) => (
                  <DropdownMenuItem
                    key={filter.id}
                    onSelect={() => onChange({ ...(filter.params as LeadListParams), page: 1 })}
                  >
                    <span className="min-w-0 flex-1 truncate">{filter.name}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFilter(filter.id);
                      }}
                      className="rounded-sm p-0.5 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete saved view ${filter.name}`}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {activeFilters > 0 ? (
            <SaveViewButton
              onSave={(name) =>
                saveFilter({
                  id: `${Date.now()}`,
                  name,
                  params: params as Record<string, string | number | undefined>,
                })
              }
            />
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Tooltip content="Choose visible columns">
                <Button variant="ghost" size="icon-sm" aria-label="Customise columns">
                  <Columns3 />
                </Button>
              </Tooltip>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Columns</DropdownMenuLabel>
              {LEAD_COLUMNS.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column}
                  checked={columns.includes(column)}
                  disabled={column === 'business'}
                  onCheckedChange={() => toggleColumn(column)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {COLUMN_LABELS[column]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Active filter chips — each removable, so the current query is visible. */}
      {activeFilters > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-2xs text-muted-foreground">
            <Filter className="size-3" aria-hidden="true" />
            {typeof total === 'number' ? `${total.toLocaleString('en-GB')} matching` : 'Filtered'}
          </span>
          {chipEntries(params).map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() =>
                onChange({ [chip.key]: undefined, page: 1 } as Partial<LeadListParams>)
              }
              className="inline-flex items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-0.5 text-2xs transition-colors hover:border-destructive/40 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-muted-foreground">{chip.label}:</span>
              <span className="font-medium">{chip.value}</span>
              <X className="size-2.5" aria-hidden="true" />
              <span className="sr-only">Remove filter</span>
            </button>
          ))}
          <Button variant="ghost" size="xs" onClick={onReset}>
            Clear all
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function QuickSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
}) {
  return (
    <SelectRoot
      value={value ?? '__all'}
      onValueChange={(next) => onChange(next === '__all' ? undefined : next)}
    >
      <SelectTrigger
        size="sm"
        className={cn('w-auto min-w-[110px]', value && 'border-primary/40 text-primary')}
      >
        <SelectValue placeholder={label} aria-label={`${label} filter`}>
          {value ? options.find((o) => o.value === value)?.label : label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">All {label.toLowerCase()}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}

function ScoreRangeFilter({
  params,
  onChange,
}: {
  params: LeadListParams;
  onChange: (next: Partial<LeadListParams>) => void;
}) {
  const active = params.minScore !== undefined || params.maxScore !== undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={active ? 'ai' : 'secondary'} size="sm">
          Score
          {active ? (
            <Badge variant="primary" className="ml-0.5">
              {params.minScore ?? 0}–{params.maxScore ?? 100}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3">
        <p className="text-xs font-medium">Lead score range</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="min-score">Minimum</Label>
            <Input
              id="min-score"
              type="number"
              min={0}
              max={100}
              value={params.minScore ?? ''}
              onChange={(e) =>
                onChange({
                  minScore: e.target.value === '' ? undefined : Number(e.target.value),
                  page: 1,
                })
              }
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="max-score">Maximum</Label>
            <Input
              id="max-score"
              type="number"
              min={0}
              max={100}
              value={params.maxScore ?? ''}
              onChange={(e) =>
                onChange({
                  maxScore: e.target.value === '' ? undefined : Number(e.target.value),
                  page: 1,
                })
              }
              className="h-8"
            />
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="secondary"
            size="xs"
            onClick={() => onChange({ minScore: 90, maxScore: undefined, page: 1 })}
          >
            Hot 90+
          </Button>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => onChange({ minScore: 75, maxScore: 89, page: 1 })}
          >
            Warm
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onChange({ minScore: undefined, maxScore: undefined, page: 1 })}
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SaveViewButton({ onSave }: { onSave: (name: string) => void }) {
  const [name, setName] = React.useState('');
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <Bookmark aria-hidden="true" />
          Save view
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2">
        <Label htmlFor="view-name">Name this view</Label>
        <Input
          id="view-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Hot leads with no website"
          className="h-8"
        />
        <Button
          size="sm"
          variant="primary"
          className="w-full"
          disabled={!name.trim()}
          onClick={() => {
            onSave(name.trim());
            setName('');
            setOpen(false);
          }}
        >
          Save
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function countActiveFilters(params: LeadListParams): number {
  return chipEntries(params).length;
}

function chipEntries(
  params: LeadListParams,
): { key: keyof LeadListParams; label: string; value: string }[] {
  const entries: { key: keyof LeadListParams; label: string; value: string }[] = [];
  if (params.status)
    entries.push({ key: 'status', label: 'Status', value: titleCase(params.status) });
  if (params.temperature)
    entries.push({ key: 'temperature', label: 'Priority', value: titleCase(params.temperature) });
  if (params.verificationStatus)
    entries.push({
      key: 'verificationStatus',
      label: 'Verification',
      value: titleCase(params.verificationStatus),
    });
  if (params.search) entries.push({ key: 'search', label: 'Search', value: params.search });
  if (params.tag) entries.push({ key: 'tag', label: 'Tag', value: params.tag });
  if (params.campaignId) entries.push({ key: 'campaignId', label: 'Campaign', value: 'selected' });
  if (params.minScore !== undefined)
    entries.push({ key: 'minScore', label: 'Min score', value: String(params.minScore) });
  if (params.maxScore !== undefined)
    entries.push({ key: 'maxScore', label: 'Max score', value: String(params.maxScore) });
  return entries;
}
