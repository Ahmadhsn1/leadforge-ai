'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/primitives';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Section } from '@/components/layout/page-header';
import { useUpdateCampaign } from '@/lib/queries';
import { CHANNELS } from '@leadforge/shared';
import { titleCase } from '@/lib/utils';
import type { CampaignSummary } from '@/types/api';

/** Editable campaign configuration. Target geography is fixed after creation. */
export function CampaignSettingsForm({ campaign }: { campaign: CampaignSummary }) {
  const update = useUpdateCampaign(campaign.id);

  const [form, setForm] = React.useState({
    name: campaign.name,
    description: campaign.description ?? '',
    channel: campaign.channel,
    leadLimit: campaign.target.leadLimit,
    offer: campaign.ai.offer,
    objective: campaign.ai.objective,
    tone: campaign.ai.tone,
    cta: campaign.ai.cta,
    tier: campaign.ai.tier,
    senderName: campaign.ai.senderName ?? '',
    senderCompany: campaign.ai.senderCompany ?? '',
    autoPersonalize: campaign.autoPersonalize,
  });

  const dirty = React.useMemo(
    () =>
      form.name !== campaign.name ||
      form.description !== (campaign.description ?? '') ||
      form.channel !== campaign.channel ||
      form.leadLimit !== campaign.target.leadLimit ||
      form.offer !== campaign.ai.offer ||
      form.objective !== campaign.ai.objective ||
      form.tone !== campaign.ai.tone ||
      form.cta !== campaign.ai.cta ||
      form.tier !== campaign.ai.tier ||
      form.senderName !== (campaign.ai.senderName ?? '') ||
      form.senderCompany !== (campaign.ai.senderCompany ?? '') ||
      form.autoPersonalize !== campaign.autoPersonalize,
    [form, campaign],
  );

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    update.mutate({
      name: form.name,
      description: form.description || undefined,
      channel: form.channel,
      target: { ...campaign.target, leadLimit: form.leadLimit },
      ai: {
        offer: form.offer,
        objective: form.objective,
        tone: form.tone,
        cta: form.cta,
        tier: form.tier,
        senderName: form.senderName || undefined,
        senderCompany: form.senderCompany || undefined,
      },
      autoPersonalize: form.autoPersonalize,
    });
  }

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Section title="Campaign">
        <div className="panel space-y-4 p-4">
          <Field label="Name" htmlFor="c-name" required>
            <Input
              id="c-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
            />
          </Field>
          <Field label="Description" htmlFor="c-desc">
            <Textarea
              id="c-desc"
              rows={2}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Channel" htmlFor="c-channel">
              <Select
                value={form.channel}
                onValueChange={(v) => set('channel', v as typeof form.channel)}
              >
                <SelectTrigger id="c-channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((channel) => (
                    <SelectItem key={channel} value={channel}>
                      {titleCase(channel)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Lead limit"
              htmlFor="c-limit"
              hint="Applies to the next run. Existing leads are unaffected."
            >
              <Input
                id="c-limit"
                type="number"
                min={1}
                max={5000}
                value={form.leadLimit}
                onChange={(e) => set('leadLimit', Number(e.target.value))}
              />
            </Field>
          </div>
        </div>
      </Section>

      <Section
        title="Intelligence"
        description="What the analysis stage looks for and how much model headroom it gets."
      >
        <div className="panel space-y-4 p-4">
          <Field label="What you sell" htmlFor="c-offer" required>
            <Textarea
              id="c-offer"
              rows={3}
              value={form.offer}
              onChange={(e) => set('offer', e.target.value)}
              required
            />
          </Field>
          <Field label="Objective" htmlFor="c-objective" required>
            <Textarea
              id="c-objective"
              rows={3}
              value={form.objective}
              onChange={(e) => set('objective', e.target.value)}
              required
            />
          </Field>
          <Field
            label="Model tier"
            htmlFor="c-tier"
            hint="The router still picks the cheapest model that meets the task."
          >
            <Select value={form.tier} onValueChange={(v) => set('tier', v as typeof form.tier)}>
              <SelectTrigger id="c-tier" className="max-w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="economy" description="Lightweight models, lowest cost">
                  Economy
                </SelectItem>
                <SelectItem value="balanced" description="Good reasoning at moderate cost">
                  Balanced
                </SelectItem>
                <SelectItem value="quality" description="Strongest reasoning">
                  Quality
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="Outreach">
        <div className="panel space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tone" htmlFor="c-tone">
              <Select value={form.tone} onValueChange={(v) => set('tone', v as typeof form.tone)}>
                <SelectTrigger id="c-tone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['professional', 'friendly', 'direct', 'consultative'].map((tone) => (
                    <SelectItem key={tone} value={tone}>
                      {titleCase(tone)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Call to action" htmlFor="c-cta" required>
              <Input
                id="c-cta"
                value={form.cta}
                onChange={(e) => set('cta', e.target.value)}
                required
              />
            </Field>
            <Field label="Sender name" htmlFor="c-sender">
              <Input
                id="c-sender"
                value={form.senderName}
                onChange={(e) => set('senderName', e.target.value)}
              />
            </Field>
            <Field label="Your company" htmlFor="c-company">
              <Input
                id="c-company"
                value={form.senderCompany}
                onChange={(e) => set('senderCompany', e.target.value)}
              />
            </Field>
          </div>

          <label className="flex items-start justify-between gap-3 rounded-md border border-border bg-raised p-3">
            <span>
              <span className="block text-sm font-medium">Draft messages automatically</span>
              <span className="block text-xs text-muted-foreground text-pretty">
                Generate drafts as soon as a lead is scored. They still wait for your approval.
              </span>
            </span>
            <Switch
              checked={form.autoPersonalize}
              onCheckedChange={(v) => set('autoPersonalize', v)}
            />
          </label>
        </div>
      </Section>

      {/* Sticky save bar so the action is always reachable in a long form. */}
      <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-2 border-t border-border bg-background/90 px-1 py-3 backdrop-blur">
        {dirty ? (
          <span className="mr-auto text-xs text-muted-foreground">You have unsaved changes</span>
        ) : null}
        <Button type="submit" variant="primary" disabled={!dirty} loading={update.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
