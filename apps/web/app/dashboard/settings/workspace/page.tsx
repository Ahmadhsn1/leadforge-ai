'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Download } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { OrganizationView } from '@/types/api';
import { Section } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CardSkeleton } from '@/components/ui/states';
import { api, ApiError } from '@/lib/api-client';
import { qk, useMe } from '@/lib/queries';
import { ROLE_RANK } from '@leadforge/shared';
import { titleCase } from '@/lib/utils';

const COUNTRIES = [
  'GB',
  'IE',
  'US',
  'CA',
  'AU',
  'NZ',
  'AE',
  'ZA',
  'IN',
  'DE',
  'FR',
  'ES',
  'NL',
] as const;

export default function WorkspaceSettingsPage() {
  const me = useMe();
  const queryClient = useQueryClient();

  const [name, setName] = React.useState('');
  const [defaultCountry, setDefaultCountry] = React.useState('GB');
  const [senderName, setSenderName] = React.useState('');
  const [senderCompany, setSenderCompany] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const [confirmName, setConfirmName] = React.useState('');
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  // The saved values, so the form shows what is stored rather than defaults
  // that would overwrite it on the next save.
  const organization = useQuery<OrganizationView, ApiError>({
    queryKey: ['organization', me.data?.organization.id],
    queryFn: () => api.get<OrganizationView>('/organizations/current'),
    enabled: me.isSuccess,
  });

  React.useEffect(() => {
    if (me.data) setName(me.data.organization.name);
  }, [me.data]);

  React.useEffect(() => {
    const settings = organization.data?.settings;
    if (!settings) return;
    if (typeof settings.defaultCountry === 'string') setDefaultCountry(settings.defaultCountry);
    if (typeof settings.senderName === 'string') setSenderName(settings.senderName);
    if (typeof settings.senderCompany === 'string') setSenderCompany(settings.senderCompany);
  }, [organization.data]);

  if (me.isLoading || organization.isLoading) return <CardSkeleton className="h-64" />;

  const role = me.data?.organization.role ?? 'viewer';
  const canEdit = ROLE_RANK[role] >= ROLE_RANK.admin;
  const isOwner = role === 'owner';
  const workspaceName = me.data?.organization.name ?? '';

  async function deleteWorkspace(event: React.FormEvent) {
    event.preventDefault();
    setDeleteError(null);
    setDeleting(true);
    try {
      await api.delete('/organizations/current', { body: { confirmName } });
      queryClient.clear();
      window.location.assign('/');
    } catch (error) {
      setDeleteError(
        error instanceof ApiError ? error.message : 'Could not delete the workspace. Try again.',
      );
      setDeleting(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.patch('/organizations/current', {
        name: name.trim(),
        settings: {
          defaultCountry,
          senderName: senderName.trim() || undefined,
          senderCompany: senderCompany.trim() || undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey: qk.me });
      toast.success('Workspace updated');
    } catch (error) {
      toast.error('Could not update workspace', {
        description: error instanceof ApiError ? error.userMessage : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section title="Workspace">
        <form onSubmit={save} className="panel space-y-4 p-4">
          <Field label="Workspace name" htmlFor="ws-name" required>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              readOnly={!canEdit}
              required
            />
          </Field>

          <Field
            label="Workspace URL"
            htmlFor="ws-slug"
            hint="Used in links and exports. Cannot be changed."
          >
            <Input id="ws-slug" value={me.data?.organization.slug ?? ''} readOnly />
          </Field>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Plan</span>
            <Badge variant="primary">{titleCase(me.data?.organization.plan ?? 'free')}</Badge>
            <span className="text-xs text-muted-foreground">Your role</span>
            <Badge variant="outline">{titleCase(me.data?.organization.role ?? 'viewer')}</Badge>
          </div>
        </form>
      </Section>

      <Section
        title="Defaults"
        description="Applied to new campaigns. Existing campaigns keep the values they were created with."
      >
        <form onSubmit={save} className="panel space-y-4 p-4">
          <Field
            label="Default country"
            htmlFor="ws-country"
            hint="Used to normalise phone numbers to E.164 when a number has no country code."
          >
            <Select value={defaultCountry} onValueChange={setDefaultCountry} disabled={!canEdit}>
              <SelectTrigger id="ws-country" className="max-w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Default sender name"
              htmlFor="ws-sender"
              hint="Used to sign generated messages."
            >
              <Input
                id="ws-sender"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="Your first name"
                readOnly={!canEdit}
              />
            </Field>
            <Field label="Default company name" htmlFor="ws-company">
              <Input
                id="ws-company"
                value={senderCompany}
                onChange={(e) => setSenderCompany(e.target.value)}
                placeholder="Your company name"
                readOnly={!canEdit}
              />
            </Field>
          </div>

          {canEdit ? (
            <div className="flex justify-end border-t border-border pt-3">
              <Button type="submit" variant="primary" loading={saving}>
                Save changes
              </Button>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
              Only admins and owners can change workspace settings.
            </p>
          )}
        </form>
      </Section>

      {isOwner ? (
        <Section
          title="Your data"
          description="Take a copy of everything in this workspace, or remove it for good."
        >
          <div className="panel divide-y divide-border">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">Export workspace data</p>
                <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
                  One JSON file with every campaign, lead, piece of evidence, message and
                  conversation.
                </p>
              </div>
              <Button variant="secondary" size="sm" asChild>
                <a href="/api/organizations/export" download>
                  <Download aria-hidden="true" />
                  Download export
                </a>
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-destructive">Delete this workspace</p>
                <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
                  Permanently removes the workspace, all its data, and any account that belongs only
                  to it. This cannot be undone.
                </p>
              </div>
              <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                Delete workspace
              </Button>
            </div>
          </div>
        </Section>
      ) : null}

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (deleting) return;
          setDeleteOpen(open);
          if (!open) {
            setConfirmName('');
            setDeleteError(null);
          }
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete {workspaceName}?</DialogTitle>
            <DialogDescription>
              Every lead, message and conversation in this workspace will be deleted immediately,
              for every member. There is no way to restore it. Export your data first if you might
              want it.
            </DialogDescription>
          </DialogHeader>

          <form id="delete-workspace" onSubmit={deleteWorkspace} className="space-y-3">
            {deleteError ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {deleteError}
              </div>
            ) : null}
            <Field label={`Type “${workspaceName}” to confirm`} htmlFor="delete-confirm" required>
              <Input
                id="delete-confirm"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </Field>
          </form>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Keep workspace
            </Button>
            <Button
              type="submit"
              form="delete-workspace"
              variant="destructive"
              loading={deleting}
              disabled={confirmName.trim() !== workspaceName}
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
