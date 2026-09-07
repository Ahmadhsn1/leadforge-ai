'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
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

  React.useEffect(() => {
    if (me.data) setName(me.data.organization.name);
  }, [me.data]);

  if (me.isLoading) return <CardSkeleton className="h-64" />;

  const canEdit = ROLE_RANK[me.data?.organization.role ?? 'viewer'] >= ROLE_RANK.admin;

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
                placeholder="Alex"
                readOnly={!canEdit}
              />
            </Field>
            <Field label="Default company name" htmlFor="ws-company">
              <Input
                id="ws-company"
                value={senderCompany}
                onChange={(e) => setSenderCompany(e.target.value)}
                placeholder="TractionX Digital"
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
    </div>
  );
}
