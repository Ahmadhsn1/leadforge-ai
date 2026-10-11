'use client';

import * as React from 'react';
import {
  AlertTriangle,
  Brain,
  Check,
  ExternalLink,
  Instagram,
  Mail,
  MapPin,
  MessageCircle,
  Settings2,
} from 'lucide-react';
import { Section } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/primitives';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CardSkeleton, ErrorState } from '@/components/ui/states';
import { HoverLift, Stagger } from '@/components/ui/motion';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, ApiError } from '@/lib/api-client';
import { qk, useIntegrations, useUpdateIntegration } from '@/lib/queries';
import { cn, relativeTime } from '@/lib/utils';
import type { IntegrationView } from '@/types/api';

interface ProviderMeta {
  readonly provider: string;
  readonly name: string;
  readonly purpose: string;
  readonly icon: React.ElementType;
  readonly description: string;
  /** Environment variables the operator must set for this to work. */
  readonly envVars: readonly string[];
  readonly docsUrl: string;
  /** Editable, non-secret configuration fields. */
  readonly configFields: readonly {
    key: string;
    label: string;
    hint?: string;
    placeholder?: string;
  }[];
}

const PROVIDERS: readonly ProviderMeta[] = [
  {
    provider: 'openrouter',
    name: 'OpenRouter',
    purpose: 'AI intelligence',
    icon: Brain,
    description:
      'The AI gateway routes every task through OpenRouter, choosing the cheapest model that reliably meets the task. Without it, analysis, scoring explanations and message generation are unavailable.',
    envVars: ['OPENROUTER_API_KEY'],
    docsUrl: 'https://openrouter.ai/keys',
    configFields: [],
  },
  {
    provider: 'google_places',
    name: 'Google Places',
    purpose: 'Lead discovery',
    icon: MapPin,
    description:
      'The V1 discovery source. Provides business identity, category, rating, review count, phone and website for a geographic and category search.',
    envVars: ['GOOGLE_MAPS_API_KEY'],
    docsUrl: 'https://console.cloud.google.com/google/maps-apis',
    configFields: [],
  },
  {
    provider: 'whatsapp',
    name: 'WhatsApp Business',
    purpose: 'Messaging',
    icon: MessageCircle,
    description:
      'Sends approved messages through the official WhatsApp Business Platform and receives delivery and reply webhooks. Consumer-client automation is not supported and is not built.',
    envVars: ['META_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'META_WEBHOOK_VERIFY_TOKEN'],
    docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
    configFields: [{ key: 'phoneNumberId', label: 'Phone number ID', placeholder: '1234567890' }],
  },
  {
    provider: 'instagram',
    name: 'Instagram',
    purpose: 'Messaging',
    icon: Instagram,
    description:
      'Sends and receives Instagram direct messages for a connected business account through the Meta Graph API, within the messaging windows Meta permits.',
    envVars: ['META_ACCESS_TOKEN', 'INSTAGRAM_BUSINESS_ACCOUNT_ID'],
    docsUrl: 'https://developers.facebook.com/docs/messenger-platform/instagram',
    configFields: [
      { key: 'businessAccountId', label: 'Business account ID', placeholder: '17841400000000000' },
    ],
  },
  {
    provider: 'email',
    name: 'Email (SMTP)',
    purpose: 'Email outreach',
    icon: Mail,
    description:
      'Sends approved email drafts over SMTP. Plain text only — no tracking pixels, so deliverability and trust stay intact.',
    envVars: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'],
    docsUrl: 'https://nodemailer.com/smtp/',
    configFields: [
      { key: 'fromAddress', label: 'From address', placeholder: 'alex@youragency.com' },
      { key: 'replyTo', label: 'Reply-to', hint: 'Optional. Defaults to the from address.' },
    ],
  },
];

export default function IntegrationsPage() {
  const { data, isLoading, isError, error, refetch } = useIntegrations();
  const [editing, setEditing] = React.useState<ProviderMeta | null>(null);
  const [connectingEmail, setConnectingEmail] = React.useState(false);

  const byProvider = React.useMemo(() => {
    const map = new Map<string, IntegrationView>();
    for (const item of data ?? []) map.set(item.provider, item);
    return map;
  }, [data]);

  return (
    <Section
      title="Integrations"
      description="Every provider sits behind an adapter. Nothing is simulated — an unconfigured provider reports that plainly instead of pretending to work."
    >
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} className="h-40" />
          ))}
        </div>
      ) : isError ? (
        <div className="panel">
          <ErrorState description={error.userMessage} onRetry={() => refetch()} />
        </div>
      ) : (
        <Stagger className="grid gap-3 sm:grid-cols-2" step={55}>
          {PROVIDERS.map((meta) => (
            <IntegrationCard
              key={meta.provider}
              meta={meta}
              integration={byProvider.get(meta.provider)}
              onConfigure={() => setEditing(meta)}
              onConnectEmail={() => setConnectingEmail(true)}
            />
          ))}
        </Stagger>
      )}

      <EmailAccountDialog
        open={connectingEmail}
        integration={byProvider.get('email')}
        onClose={() => setConnectingEmail(false)}
      />

      <ConfigureDialog
        meta={editing}
        integration={editing ? byProvider.get(editing.provider) : undefined}
        onClose={() => setEditing(null)}
      />
    </Section>
  );
}

function IntegrationCard({
  meta,
  integration,
  onConfigure,
  onConnectEmail,
}: {
  meta: ProviderMeta;
  integration: IntegrationView | undefined;
  onConfigure: () => void;
  onConnectEmail: () => void;
}) {
  const update = useUpdateIntegration();
  const Icon = meta.icon;
  const configured = integration?.configured ?? false;
  const enabled = integration?.enabled ?? false;
  const status = !configured
    ? 'not_configured'
    : enabled
      ? (integration?.status ?? 'connected')
      : 'disabled';

  const statusMeta = {
    not_configured: { label: 'Not configured', tone: 'default' as const, dot: 'muted' as const },
    disabled: { label: 'Disabled', tone: 'default' as const, dot: 'muted' as const },
    connected: { label: 'Connected', tone: 'success' as const, dot: 'success' as const },
    error: { label: 'Needs attention', tone: 'destructive' as const, dot: 'destructive' as const },
  }[
    status === 'connected' || status === 'error'
      ? status
      : (status as 'not_configured' | 'disabled')
  ] ?? {
    label: 'Connected',
    tone: 'success' as const,
    dot: 'success' as const,
  };

  return (
    <HoverLift className="h-full rounded-lg">
      <article className="flex h-full flex-col rounded-lg border border-border bg-surface p-4">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-md border',
              configured
                ? 'border-primary/25 bg-primary/10 text-primary'
                : 'border-border bg-raised text-muted-foreground',
            )}
            aria-hidden="true"
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">{meta.name}</h3>
            <p className="text-2xs text-muted-foreground">{meta.purpose}</p>
          </div>
          <Badge
            variant={statusMeta.tone === 'default' ? 'default' : statusMeta.tone}
            className="gap-1.5"
          >
            <StatusDot tone={statusMeta.dot} />
            {statusMeta.label}
          </Badge>
        </div>

        <p className="mt-2.5 flex-1 text-xs text-muted-foreground text-pretty">
          {meta.description}
        </p>

        {integration?.lastError ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-sm bg-destructive/10 px-2 py-1.5 text-2xs text-destructive">
            <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden="true" />
            <span className="break-anywhere">{integration.lastError}</span>
          </p>
        ) : null}

        {meta.provider === 'email' ? (
          <p className="mt-2.5 rounded-md border border-dashed border-border bg-raised px-2.5 py-2 text-2xs text-pretty">
            {integration?.source === 'workspace' ? (
              <>
                Sending from{' '}
                <span className="font-medium break-anywhere">
                  {String(integration.config.fromAddress ?? 'your mail account')}
                </span>
                , through your own mail server.
              </>
            ) : integration?.source === 'deployment' ? (
              'Sending through the mail account this deployment was set up with. Connect your own so messages come from your address.'
            ) : (
              'Connect your mail account to send email outreach from your own address.'
            )}
          </p>
        ) : !configured ? (
          <div className="mt-2.5 rounded-md border border-dashed border-border bg-raised px-2.5 py-2">
            <p className="text-2xs font-medium">
              Set these environment variables on the API and worker services:
            </p>
            <ul className="mt-1 flex flex-wrap gap-1">
              {meta.envVars.map((name) => (
                <li key={name}>
                  <code className="rounded-sm bg-muted px-1 py-px font-mono text-2xs">{name}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
          <span className="flex items-center gap-2">
            <Switch
              checked={enabled}
              disabled={!configured || update.isPending}
              onCheckedChange={(checked) =>
                update.mutate({ provider: meta.provider, body: { enabled: checked } })
              }
              aria-label={`${enabled ? 'Disable' : 'Enable'} ${meta.name}`}
            />
            <span className="text-2xs text-muted-foreground">
              {integration?.lastCheckedAt
                ? `Checked ${relativeTime(integration.lastCheckedAt)}`
                : 'Never checked'}
            </span>
          </span>

          <span className="flex items-center gap-1">
            {meta.provider === 'email' ? (
              <Button variant="ghost" size="xs" onClick={onConnectEmail}>
                <Mail aria-hidden="true" />
                {integration?.source === 'workspace' ? 'Change account' : 'Connect account'}
              </Button>
            ) : meta.configFields.length > 0 ? (
              <Button variant="ghost" size="xs" onClick={onConfigure}>
                <Settings2 aria-hidden="true" />
                Configure
              </Button>
            ) : null}
            <Button variant="ghost" size="xs" asChild>
              <a href={meta.docsUrl} target="_blank" rel="noopener noreferrer">
                Get keys
                <ExternalLink aria-hidden="true" />
              </a>
            </Button>
          </span>
        </div>
      </article>
    </HoverLift>
  );
}

const SMTP_PORTS = [
  { value: '587', label: '587 — STARTTLS (most providers)' },
  { value: '465', label: '465 — TLS' },
  { value: '2525', label: '2525 — alternative' },
  { value: '25', label: '25 — unencrypted relay' },
];

/**
 * Connects the workspace's own mail account. The server tries the details
 * before saving them, so a wrong password is reported here rather than on the
 * first message to a prospect.
 */
function EmailAccountDialog({
  open,
  integration,
  onClose,
}: {
  open: boolean;
  integration: IntegrationView | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const connected = integration?.source === 'workspace';

  const [form, setForm] = React.useState({
    host: '',
    port: '587',
    username: '',
    password: '',
    fromAddress: '',
    fromName: '',
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const config = (integration?.config ?? {}) as Record<string, unknown>;
    setForm({
      host: String(config.host ?? ''),
      port: String(config.port ?? '587'),
      username: String(config.username ?? ''),
      // Never prefilled: the saved password is not sent back to the browser.
      password: '',
      fromAddress: String(config.fromAddress ?? ''),
      fromName: String(config.fromName ?? ''),
    });
    setErrors({});
    setFormError(null);
  }, [open, integration]);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.integrations }),
      queryClient.invalidateQueries({ queryKey: qk.me }),
    ]);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const next: Record<string, string> = {};
    if (!form.host.trim()) next.host = 'Enter your mail server, such as smtp.example.com.';
    if (!form.username.trim()) next.username = 'Enter the username you sign in to it with.';
    if (!form.password) next.password = 'Enter the password or app password.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.fromAddress.trim())) {
      next.fromAddress = 'Enter the address messages should come from.';
    }
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      document.getElementById(`smtp-${first}`)?.focus();
      return;
    }

    setSaving(true);
    try {
      await api.put('/integrations/email/credentials', {
        host: form.host.trim(),
        port: Number(form.port),
        username: form.username.trim(),
        password: form.password,
        fromAddress: form.fromAddress.trim().toLowerCase(),
        ...(form.fromName.trim() ? { fromName: form.fromName.trim() } : {}),
      });
      await refresh();
      toast.success('Mail account connected', {
        description: `Email outreach will be sent from ${form.fromAddress.trim()}.`,
      });
      onClose();
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.userMessage : 'Could not reach the server. Try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setRemoving(true);
    try {
      await api.delete('/integrations/email/credentials');
      await refresh();
      toast.success('Mail account disconnected');
      onClose();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.userMessage : 'Could not disconnect.');
    } finally {
      setRemoving(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>
            {connected ? 'Change mail account' : 'Connect your mail account'}
          </DialogTitle>
          <DialogDescription>
            Email outreach is sent through your own mail server, so it comes from your address. The
            password is encrypted before it is stored and is never shown again.
          </DialogDescription>
        </DialogHeader>

        <form id="smtp-form" onSubmit={save} className="space-y-3" noValidate>
          {formError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Mail server" htmlFor="smtp-host" error={errors.host} required>
              <Input
                id="smtp-host"
                value={form.host}
                onChange={set('host')}
                placeholder="smtp.example.com"
                autoComplete="off"
                spellCheck={false}
                invalid={Boolean(errors.host)}
                required
              />
            </Field>
            <Field label="Port" htmlFor="smtp-port">
              <Select
                value={form.port}
                onValueChange={(port) => setForm((prev) => ({ ...prev, port }))}
              >
                <SelectTrigger id="smtp-port" className="sm:w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SMTP_PORTS.map((port) => (
                    <SelectItem key={port.value} value={port.value}>
                      {port.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Username" htmlFor="smtp-username" error={errors.username} required>
            <Input
              id="smtp-username"
              value={form.username}
              onChange={set('username')}
              autoComplete="off"
              spellCheck={false}
              invalid={Boolean(errors.username)}
              required
            />
          </Field>

          <Field
            label="Password"
            htmlFor="smtp-password"
            error={errors.password}
            hint={
              connected
                ? 'Enter it again to save changes.'
                : 'For Gmail or Outlook, use an app password rather than your normal one.'
            }
            required
          >
            <Input
              id="smtp-password"
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete="new-password"
              invalid={Boolean(errors.password)}
              required
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="From address"
              htmlFor="smtp-fromAddress"
              error={errors.fromAddress}
              required
            >
              <Input
                id="smtp-fromAddress"
                type="email"
                inputMode="email"
                value={form.fromAddress}
                onChange={set('fromAddress')}
                placeholder="alex@youragency.com"
                invalid={Boolean(errors.fromAddress)}
                required
              />
            </Field>
            <Field label="From name" htmlFor="smtp-fromName" hint="Optional.">
              <Input
                id="smtp-fromName"
                value={form.fromName}
                onChange={set('fromName')}
                placeholder="Alex at Your Agency"
              />
            </Field>
          </div>
        </form>

        <DialogFooter>
          {connected ? (
            <Button
              variant="ghost"
              className="mr-auto text-destructive hover:text-destructive"
              loading={removing}
              disabled={saving}
              onClick={remove}
            >
              Disconnect
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={saving || removing}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="smtp-form"
            variant="primary"
            loading={saving}
            disabled={removing}
          >
            <Check aria-hidden="true" />
            Test and save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfigureDialog({
  meta,
  integration,
  onClose,
}: {
  meta: ProviderMeta | null;
  integration: IntegrationView | undefined;
  onClose: () => void;
}) {
  const update = useUpdateIntegration();
  const [values, setValues] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!meta) return;
    const initial: Record<string, string> = {};
    for (const field of meta.configFields) {
      initial[field.key] = String(
        (integration?.config as Record<string, unknown> | undefined)?.[field.key] ?? '',
      );
    }
    setValues(initial);
  }, [meta, integration]);

  if (!meta) return null;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Configure {meta.name}</DialogTitle>
          <DialogDescription>
            Non-secret settings only. API keys and tokens live in environment variables and are
            never returned by the API or shown here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {meta.configFields.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              htmlFor={`cfg-${field.key}`}
              hint={field.hint}
            >
              <Input
                id={`cfg-${field.key}`}
                value={values[field.key] ?? ''}
                placeholder={field.placeholder}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              />
            </Field>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={update.isPending}
            onClick={async () => {
              await update.mutateAsync({ provider: meta.provider, body: { config: values } });
              onClose();
            }}
          >
            <Check aria-hidden="true" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
