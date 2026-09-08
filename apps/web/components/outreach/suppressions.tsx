'use client';

import * as React from 'react';
import { Ban, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Label } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { useCreateSuppression, useSuppressions } from '@/lib/queries';
import { SUPPRESSION_SCOPES } from '@leadforge/shared';
import { formatDateTime, titleCase } from '@/lib/utils';

/**
 * Do-not-contact list. A suppression blocks outreach at queue time and again
 * immediately before send, so adding one here takes effect on in-flight work.
 */
export function SuppressionManager() {
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, error, refetch } = useSuppressions({
    page,
    search: debounced || undefined,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground text-pretty">
          Suppressed recipients are never contacted, including by follow-ups already scheduled.
        </p>
        <div className="ml-auto flex items-center gap-2">
          <div className="w-56">
            <Label htmlFor="suppression-search" className="sr-only">
              Search suppressions
            </Label>
            <Input
              id="suppression-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by phone, email or domain"
              leadingIcon={<Search />}
              className="h-8"
            />
          </div>
          <AddSuppressionDialog />
        </div>
      </div>

      <div className="panel overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={6} columns={4} />
        ) : isError ? (
          <ErrorState description={error.userMessage} onRetry={() => refetch()} />
        ) : data && data.items.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Suppressed contacts, with scope, value, reason and date added.
                </caption>
                <thead>
                  <tr className="border-b border-border bg-raised/60 text-left">
                    {['Scope', 'Value', 'Reason', 'Added'].map((header) => (
                      <th key={header} scope="col" className="px-3 py-2">
                        <span className="eyebrow">{header}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.items.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/40">
                      <td className="px-3 py-2">
                        <Badge variant="outline">{titleCase(item.scope)}</Badge>
                      </td>
                      <td className="break-anywhere px-3 py-2 font-mono text-xs">{item.value}</td>
                      <td className="px-3 py-2 text-muted-foreground">{item.reason ?? '—'}</td>
                      <td className="px-3 py-2 text-2xs text-muted-foreground">
                        {formatDateTime(item.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              totalPages={data.totalPages}
              onPageChange={setPage}
              label="suppressions"
            />
          </>
        ) : (
          <EmptyState
            icon={<Ban />}
            title="No suppressions"
            description="Add a phone number, email, domain or Instagram handle here and LeadForge will never contact it from this workspace."
            action={<AddSuppressionDialog />}
          />
        )}
      </div>
    </div>
  );
}

function AddSuppressionDialog() {
  const [open, setOpen] = React.useState(false);
  const [scope, setScope] = React.useState<string>('phone');
  const [value, setValue] = React.useState('');
  const [reason, setReason] = React.useState('');
  const create = useCreateSuppression();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus aria-hidden="true" />
          Add suppression
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add to do-not-contact</DialogTitle>
          <DialogDescription>
            This blocks outreach immediately, including messages already approved and queued.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Scope" htmlFor="suppression-scope">
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger id="suppression-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPRESSION_SCOPES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {titleCase(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Value"
            htmlFor="suppression-value"
            hint={
              scope === 'phone'
                ? 'Any format — it is normalised to E.164 before matching.'
                : scope === 'domain'
                  ? 'The registrable domain, e.g. example.co.uk.'
                  : undefined
            }
            required
          >
            <Input
              id="suppression-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                scope === 'phone'
                  ? '+44 7700 900123'
                  : scope === 'email'
                    ? 'name@example.com'
                    : 'example.co.uk'
              }
            />
          </Field>

          <Field label="Reason" htmlFor="suppression-reason" hint="Recorded in the audit log.">
            <Input
              id="suppression-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Asked not to be contacted"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!value.trim()}
            loading={create.isPending}
            onClick={async () => {
              await create.mutateAsync({
                scope,
                value: value.trim(),
                reason: reason.trim() || undefined,
              });
              setValue('');
              setReason('');
              setOpen(false);
            }}
          >
            Add suppression
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
