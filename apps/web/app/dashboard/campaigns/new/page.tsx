'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Check,
  Instagram,
  Mail,
  MapPin,
  MessageCircle,
  Rocket,
  Send,
  Sparkles,
  Star,
  Target,
} from 'lucide-react';
import { PageShell } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Checkbox, RadioGroup, RadioGroupItem, Switch, Tooltip } from '@/components/ui/primitives';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScoreRing } from '@/components/ui/score';
import { ProvenanceTag } from '@/components/intelligence/trust';
import { useCreateCampaign, useMe } from '@/lib/queries';
import { createCampaignSchema } from '@leadforge/shared';
import { cn } from '@/lib/utils';
import type { Channel } from '@leadforge/shared';

const STEPS = [
  { id: 'target', number: '01', title: 'Target', description: 'Who and where to look' },
  { id: 'qualification', number: '02', title: 'Qualification', description: 'Your quality bar' },
  {
    id: 'intelligence',
    number: '03',
    title: 'Intelligence',
    description: 'What AI should look for',
  },
  { id: 'outreach', number: '04', title: 'Outreach', description: 'Channel, tone and offer' },
  { id: 'review', number: '05', title: 'Review', description: 'Preview before launch' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

/**
 * Discovery sources offered in the wizard.
 *
 * The honest trade-off is on the card, because it changes which leads you get:
 * OpenStreetMap is free and unlimited but carries no ratings or review counts,
 * so rating filters do nothing there. Google Places has them, and charges.
 */
const SOURCES: {
  value: 'openstreetmap' | 'google_places';
  label: string;
  cost: string;
  free: boolean;
  description: string;
}[] = [
  {
    value: 'openstreetmap',
    label: 'OpenStreetMap',
    cost: 'Free',
    free: true,
    description:
      'Open business data, no API key and no billing account. Strong on independents without a website. Carries no ratings or review counts, so those filters are ignored.',
  },
  {
    value: 'google_places',
    label: 'Google Places',
    cost: 'Paid',
    free: false,
    description:
      'Richer coverage with ratings and review counts, so quality filters work. Needs a Google Cloud key with billing enabled.',
  },
];

interface WizardState {
  name: string;
  description: string;
  source: 'openstreetmap' | 'google_places';
  categories: string;
  keywords: string;
  location: string;
  country: string;
  radiusKm: number;
  leadLimit: number;
  minRating: string;
  minReviews: string;
  websiteCondition: 'any' | 'with' | 'without' | 'broken';
  socialCondition: 'any' | 'with_instagram' | 'without_instagram';
  requireContact: string[];
  excludeChains: boolean;
  customRules: string;
  objective: string;
  offer: string;
  tier: 'economy' | 'balanced' | 'quality';
  channel: Channel;
  tone: 'professional' | 'friendly' | 'direct' | 'consultative';
  cta: string;
  senderName: string;
  senderCompany: string;
  autoPersonalize: boolean;
}

const INITIAL: WizardState = {
  name: '',
  description: '',
  // OpenStreetMap needs no API key and no billing account, so a new
  // workspace can run a campaign before connecting anything.
  source: 'openstreetmap',
  categories: '',
  keywords: '',
  location: '',
  country: 'GB',
  radiusKm: 10,
  leadLimit: 100,
  minRating: '4.0',
  minReviews: '25',
  websiteCondition: 'without',
  socialCondition: 'any',
  requireContact: ['phone'],
  excludeChains: true,
  customRules: '',
  objective: '',
  offer: '',
  tier: 'balanced',
  channel: 'whatsapp',
  tone: 'friendly',
  cta: 'Ask if they are open to a quick chat this week.',
  senderName: '',
  senderCompany: '',
  autoPersonalize: true,
};

export default function NewCampaignPage() {
  const router = useRouter();
  const me = useMe();
  const createCampaign = useCreateCampaign();

  const [stepIndex, setStepIndex] = React.useState(0);
  const [state, setState] = React.useState<WizardState>(INITIAL);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const step = STEPS[stepIndex] as (typeof STEPS)[number];
  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  const stepErrors = validateStep(step.id, state);
  const canAdvance = Object.keys(stepErrors).length === 0;

  const goNext = () => {
    if (!canAdvance) {
      setErrors(stepErrors);
      return;
    }
    setErrors({});
    setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
  };

  const goBack = () => {
    setErrors({});
    setStepIndex((i) => Math.max(0, i - 1));
  };

  async function launch(startNow: boolean) {
    const payload = toPayload(state);
    const parsed = createCampaignSchema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path.join('.')] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    const campaign = await createCampaign.mutateAsync(parsed.data);
    if (startNow) {
      try {
        await fetch(`/api/campaigns/${campaign.id}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          credentials: 'include',
        });
      } catch {
        // The campaign exists either way; the detail page shows the real state.
      }
    }
    router.push(`/dashboard/campaigns/${campaign.id}`);
  }

  return (
    <PageShell className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">New campaign</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            You are configuring a research pipeline, not filling in a form. Every setting here
            changes what LeadForge looks for and how it judges a business.
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/campaigns">Cancel</Link>
        </Button>
      </div>

      <StepRail
        steps={STEPS}
        current={stepIndex}
        onSelect={(index) => index < stepIndex && setStepIndex(index)}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="panel p-5">
          {step.id === 'target' ? <TargetStep state={state} set={set} errors={errors} /> : null}
          {step.id === 'qualification' ? <QualificationStep state={state} set={set} /> : null}
          {step.id === 'intelligence' ? (
            <IntelligenceStep state={state} set={set} errors={errors} />
          ) : null}
          {step.id === 'outreach' ? (
            <OutreachStep
              state={state}
              set={set}
              errors={errors}
              capabilities={me.data?.capabilities}
            />
          ) : null}
          {step.id === 'review' ? <ReviewStep state={state} /> : null}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
            <Button variant="ghost" onClick={goBack} disabled={stepIndex === 0}>
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
            {stepIndex < STEPS.length - 1 ? (
              <Button variant="primary" onClick={goNext}>
                Continue
                <ArrowRight aria-hidden="true" />
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => launch(false)}
                  loading={createCampaign.isPending}
                >
                  Save as draft
                </Button>
                <Button
                  variant="primary"
                  onClick={() => launch(true)}
                  loading={createCampaign.isPending}
                >
                  <Rocket aria-hidden="true" />
                  Launch campaign
                </Button>
              </div>
            )}
          </div>
        </div>

        <LivePreview state={state} />
      </div>
    </PageShell>
  );
}

/* -------------------------------------------------------------------------- */

function StepRail({
  steps,
  current,
  onSelect,
}: {
  steps: typeof STEPS;
  current: number;
  onSelect: (index: number) => void;
}) {
  return (
    <ol className="flex gap-px overflow-x-auto rounded-lg border border-border bg-border no-scrollbar">
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'upcoming';
        return (
          <li key={step.id} className="min-w-[140px] flex-1">
            <button
              type="button"
              onClick={() => onSelect(index)}
              disabled={state === 'upcoming'}
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 bg-surface px-3 py-2.5 text-left transition-colors',
                state !== 'upcoming' && 'hover:bg-raised',
                state === 'current' && 'bg-raised',
                state === 'upcoming' && 'cursor-default',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              )}
            >
              <span
                className={cn(
                  'tabular flex size-6 shrink-0 items-center justify-center rounded-md text-2xs font-semibold',
                  state === 'done' && 'bg-success/15 text-success',
                  state === 'current' && 'bg-primary text-primary-foreground',
                  state === 'upcoming' && 'bg-muted text-muted-foreground',
                )}
                aria-hidden="true"
              >
                {state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : step.number}
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    'block truncate text-xs font-medium',
                    state === 'upcoming' && 'text-muted-foreground',
                  )}
                >
                  {step.title}
                </span>
                <span className="block truncate text-2xs text-muted-foreground">
                  {step.description}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

type SetFn = <K extends keyof WizardState>(key: K, value: WizardState[K]) => void;

function TargetStep({
  state,
  set,
  errors,
}: {
  state: WizardState;
  set: SetFn;
  errors: Record<string, string>;
}) {
  return (
    <div className="space-y-4">
      <StepHeading
        icon={<Target />}
        title="Who are you looking for?"
        description="LeadForge searches authorised business listings for the categories and area you define."
      />

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Where should LeadForge look?</legend>
        <RadioGroup
          value={state.source}
          onValueChange={(v) => set('source', v as WizardState['source'])}
          className="grid gap-2 sm:grid-cols-2"
        >
          {SOURCES.map((source) => (
            <label
              key={source.value}
              className={cn(
                'flex cursor-pointer gap-2.5 rounded-md border p-3 transition-colors',
                state.source === source.value
                  ? 'border-primary bg-primary/[0.07]'
                  : 'border-border hover:border-border-strong',
              )}
            >
              <RadioGroupItem value={source.value} className="mt-0.5" />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {source.label}
                  <Badge variant={source.free ? 'success' : 'default'}>{source.cost}</Badge>
                </span>
                <span className="mt-0.5 block text-2xs text-muted-foreground text-pretty">
                  {source.description}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </fieldset>

      <Field label="Campaign name" htmlFor="name" error={errors.name} required>
        <Input
          id="name"
          value={state.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="UK restaurants without a website"
        />
      </Field>

      <Field
        label="Business categories"
        htmlFor="categories"
        error={errors.categories}
        hint="One or more, comma separated. These map to the provider's category search."
        required
      >
        <Input
          id="categories"
          value={state.categories}
          onChange={(e) => set('categories', e.target.value)}
          placeholder="restaurant, cafe, bistro"
        />
      </Field>

      <Field
        label="Extra keywords"
        htmlFor="keywords"
        hint="Optional. Narrows the search text, e.g. 'italian', 'family run'."
      >
        <Input
          id="keywords"
          value={state.keywords}
          onChange={(e) => set('keywords', e.target.value)}
          placeholder="italian, pizzeria"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-[1fr_120px_140px]">
        <Field label="Location" htmlFor="location" error={errors.location} required>
          <Input
            id="location"
            value={state.location}
            onChange={(e) => set('location', e.target.value)}
            placeholder="Manchester, UK"
            leadingIcon={<MapPin />}
          />
        </Field>
        <Field label="Country" htmlFor="country">
          <Select value={state.country} onValueChange={(v) => set('country', v)}>
            <SelectTrigger id="country">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['GB', 'IE', 'US', 'CA', 'AU', 'NZ', 'AE', 'ZA'].map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Radius" htmlFor="radius" hint={`${state.radiusKm} km`}>
          <Input
            id="radius"
            type="number"
            min={1}
            max={50}
            value={state.radiusKm}
            onChange={(e) => set('radiusKm', Number(e.target.value))}
          />
        </Field>
      </div>

      <Field
        label="Lead limit"
        htmlFor="leadLimit"
        hint="The run stops once this many unique businesses have been created. Duplicates do not count."
      >
        <Input
          id="leadLimit"
          type="number"
          min={1}
          max={5000}
          value={state.leadLimit}
          onChange={(e) => set('leadLimit', Number(e.target.value))}
          className="max-w-[160px]"
        />
      </Field>
    </div>
  );
}

function QualificationStep({ state, set }: { state: WizardState; set: SetFn }) {
  return (
    <div className="space-y-5">
      <StepHeading
        icon={<Star />}
        title="What counts as a good prospect?"
        description="These filters run after verification, so they act on checked facts rather than raw listing data."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Minimum rating" htmlFor="minRating" hint="Leave empty to ignore ratings.">
          <Input
            id="minRating"
            type="number"
            step="0.1"
            min={0}
            max={5}
            value={state.minRating}
            onChange={(e) => set('minRating', e.target.value)}
          />
        </Field>
        <Field label="Minimum reviews" htmlFor="minReviews" hint="A proxy for real, active demand.">
          <Input
            id="minReviews"
            type="number"
            min={0}
            value={state.minReviews}
            onChange={(e) => set('minReviews', e.target.value)}
          />
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Website status</legend>
        <RadioGroup
          value={state.websiteCondition}
          onValueChange={(v) => set('websiteCondition', v as WizardState['websiteCondition'])}
          className="grid gap-2 sm:grid-cols-2"
        >
          <RadioOption value="any" label="Any" description="Do not filter on website presence." />
          <RadioOption
            value="without"
            label="No website"
            description="The strongest signal for web and design services."
          />
          <RadioOption
            value="broken"
            label="Broken website"
            description="Listed but does not resolve or errors."
          />
          <RadioOption
            value="with"
            label="Has a working website"
            description="For upsell and optimisation offers."
          />
        </RadioGroup>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Social presence</legend>
        <RadioGroup
          value={state.socialCondition}
          onValueChange={(v) => set('socialCondition', v as WizardState['socialCondition'])}
          className="grid gap-2 sm:grid-cols-3"
        >
          <RadioOption value="any" label="Any" description="Ignore social presence." />
          <RadioOption
            value="with_instagram"
            label="On Instagram"
            description="Has a public profile."
          />
          <RadioOption
            value="without_instagram"
            label="Not on Instagram"
            description="No profile found."
          />
        </RadioGroup>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Must be contactable by</legend>
        <p className="text-xs text-muted-foreground">
          A lead without a usable channel cannot be worked, so this also feeds the contactability
          score.
        </p>
        <div className="flex flex-wrap gap-3">
          {(['phone', 'email', 'website', 'instagram'] as const).map((option) => (
            <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={state.requireContact.includes(option)}
                onCheckedChange={(checked) =>
                  set(
                    'requireContact',
                    checked === true
                      ? [...state.requireContact, option]
                      : state.requireContact.filter((v) => v !== option),
                  )
                }
              />
              <span className="capitalize">{option}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-start justify-between gap-3 rounded-md border border-border bg-raised p-3">
        <span>
          <span className="block text-sm font-medium">Exclude chains and franchises</span>
          <span className="block text-xs text-muted-foreground text-pretty">
            Large multi-site brands rarely buy from cold outreach and skew your reply rate.
          </span>
        </span>
        <Switch checked={state.excludeChains} onCheckedChange={(v) => set('excludeChains', v)} />
      </label>

      <Field
        label="Custom qualification rules"
        htmlFor="customRules"
        hint="One rule per line. These are passed to the analysis prompt as constraints — they guide judgement, they do not filter mechanically."
      >
        <Textarea
          id="customRules"
          value={state.customRules}
          onChange={(e) => set('customRules', e.target.value)}
          placeholder={'Independent, owner-operated\nServes food on site, not delivery-only'}
          rows={3}
        />
      </Field>
    </div>
  );
}

function IntelligenceStep({
  state,
  set,
  errors,
}: {
  state: WizardState;
  set: SetFn;
  errors: Record<string, string>;
}) {
  return (
    <div className="space-y-4">
      <StepHeading
        icon={<Brain />}
        title="What should the AI look for?"
        description="The analysis stage reads the collected evidence and answers this question for every business."
      />

      <Field
        label="What you sell"
        htmlFor="offer"
        error={errors['ai.offer']}
        hint="Be concrete. This drives which gaps count as opportunities and what the messages propose."
        required
      >
        <Textarea
          id="offer"
          value={state.offer}
          onChange={(e) => set('offer', e.target.value)}
          placeholder="Fast, mobile-first restaurant websites with online booking and a menu that is easy to update."
          rows={3}
        />
      </Field>

      <Field
        label="Campaign objective"
        htmlFor="objective"
        error={errors['ai.objective']}
        hint="What a good outcome looks like for this campaign."
        required
      >
        <Textarea
          id="objective"
          value={state.objective}
          onChange={(e) => set('objective', e.target.value)}
          placeholder="Book 15-minute calls with independent restaurant owners who have strong reviews but no way to take bookings online."
          rows={3}
        />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Model quality tier</legend>
        <p className="text-xs text-muted-foreground text-pretty">
          The router picks the cheapest model that reliably meets the task. This sets how much
          headroom it has.
        </p>
        <RadioGroup
          value={state.tier}
          onValueChange={(v) => set('tier', v as WizardState['tier'])}
          className="grid gap-2 sm:grid-cols-3"
        >
          <RadioOption
            value="economy"
            label="Economy"
            description="Lightweight models. Best for large volumes."
          />
          <RadioOption
            value="balanced"
            label="Balanced"
            description="Default. Good reasoning at moderate cost."
          />
          <RadioOption
            value="quality"
            label="Quality"
            description="Strongest reasoning for high-value prospects."
          />
        </RadioGroup>
      </fieldset>

      <div className="flex items-start gap-2.5 rounded-md border border-border bg-raised px-3 py-2.5">
        <ProvenanceTag provenance="observed" showHelp={false} className="mt-0.5" />
        <p className="text-xs text-muted-foreground text-pretty">
          The model only sees facts LeadForge has actually recorded — listing data, verification
          results and website observations. It cannot invent metrics, and every claim it makes is
          linked back to the evidence it used.
        </p>
      </div>
    </div>
  );
}

function OutreachStep({
  state,
  set,
  errors,
  capabilities,
}: {
  state: WizardState;
  set: SetFn;
  errors: Record<string, string>;
  capabilities: { whatsapp: boolean; instagram: boolean; email: boolean } | undefined;
}) {
  const channels: {
    value: Channel;
    label: string;
    icon: React.ElementType;
    description: string;
    ready: boolean;
  }[] = [
    {
      value: 'whatsapp',
      label: 'WhatsApp',
      icon: MessageCircle,
      description: 'Conversational and direct. Requires a connected WhatsApp Business account.',
      ready: capabilities?.whatsapp ?? false,
    },
    {
      value: 'instagram',
      label: 'Instagram',
      icon: Instagram,
      description: 'Short and channel-native. Requires a connected Instagram business account.',
      ready: capabilities?.instagram ?? false,
    },
    {
      value: 'email',
      label: 'Email',
      icon: Mail,
      description: 'Structured and context-rich. Requires SMTP credentials.',
      ready: capabilities?.email ?? false,
    },
    {
      value: 'manual',
      label: 'Send it yourself',
      icon: Send,
      description:
        'LeadForge writes and checks the message, then hands you a one-click link. You press send from your own account. No provider, no cost.',
      // Nothing to connect: the user's own phone or inbox is the provider.
      ready: true,
    },
  ];

  return (
    <div className="space-y-4">
      <StepHeading
        icon={<Sparkles />}
        title="How will you reach them?"
        description="Drafts are always written for you to review. Nothing sends without your approval."
      />

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Channel</legend>
        <RadioGroup
          value={state.channel}
          onValueChange={(v) => set('channel', v as Channel)}
          className="grid gap-2 sm:grid-cols-3"
        >
          {channels.map((channel) => {
            const Icon = channel.icon;
            return (
              <label
                key={channel.value}
                className={cn(
                  'flex cursor-pointer gap-2.5 rounded-md border p-3 transition-colors',
                  state.channel === channel.value
                    ? 'border-primary bg-primary/[0.07]'
                    : 'border-border hover:border-border-strong',
                )}
              >
                <RadioGroupItem value={channel.value} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon className="size-3.5" aria-hidden="true" />
                    {channel.label}
                    {!channel.ready ? (
                      <Tooltip content="You can still generate and review drafts. Connect this channel in Integrations before sending.">
                        <Badge variant="warning">Not connected</Badge>
                      </Tooltip>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-2xs text-muted-foreground text-pretty">
                    {channel.description}
                  </span>
                </span>
              </label>
            );
          })}
        </RadioGroup>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Tone</legend>
        <RadioGroup
          value={state.tone}
          onValueChange={(v) => set('tone', v as WizardState['tone'])}
          className="grid gap-2 sm:grid-cols-4"
        >
          <RadioOption
            value="professional"
            label="Professional"
            description="Measured, business-like."
          />
          <RadioOption value="friendly" label="Friendly" description="Warm and human." />
          <RadioOption value="direct" label="Direct" description="Short, gets to the point." />
          <RadioOption
            value="consultative"
            label="Consultative"
            description="Advisory, leads with insight."
          />
        </RadioGroup>
      </fieldset>

      <Field
        label="Call to action"
        htmlFor="cta"
        error={errors['ai.cta']}
        hint="One clear ask. Messages with more than one CTA fail validation."
        required
      >
        <Input id="cta" value={state.cta} onChange={(e) => set('cta', e.target.value)} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sender name" htmlFor="senderName" hint="Used to sign the message.">
          <Input
            id="senderName"
            value={state.senderName}
            onChange={(e) => set('senderName', e.target.value)}
            placeholder="Your first name"
          />
        </Field>
        <Field label="Your company" htmlFor="senderCompany">
          <Input
            id="senderCompany"
            value={state.senderCompany}
            onChange={(e) => set('senderCompany', e.target.value)}
            placeholder="Your company name"
          />
        </Field>
      </div>

      <label className="flex items-start justify-between gap-3 rounded-md border border-border bg-raised p-3">
        <span>
          <span className="block text-sm font-medium">Draft messages automatically</span>
          <span className="block text-xs text-muted-foreground text-pretty">
            Generate drafts as soon as a lead is scored, so your approval queue fills as the run
            progresses.
          </span>
        </span>
        <Switch
          checked={state.autoPersonalize}
          onCheckedChange={(v) => set('autoPersonalize', v)}
        />
      </label>
    </div>
  );
}

function ReviewStep({ state }: { state: WizardState }) {
  const categories = splitList(state.categories);
  return (
    <div className="space-y-5">
      <StepHeading
        icon={<Rocket />}
        title="Ready to launch"
        description="Here is exactly what this campaign will do. You can change any of it later."
      />

      <dl className="grid gap-4 sm:grid-cols-2">
        <Summary label="Campaign" value={state.name || 'Untitled'} />
        <Summary label="Channel" value={state.channel} />
        <Summary label="Looking for" value={categories.join(', ') || '—'} />
        <Summary label="Area" value={`${state.location || '—'} (${state.radiusKm} km)`} />
        <Summary label="Lead limit" value={String(state.leadLimit)} />
        <Summary
          label="Quality bar"
          value={
            [
              state.minRating ? `${state.minRating}★+` : null,
              state.minReviews ? `${state.minReviews}+ reviews` : null,
              websiteConditionLabel(state.websiteCondition),
            ]
              .filter(Boolean)
              .join(' · ') || 'No filters'
          }
        />
        <Summary label="Offer" value={state.offer || '—'} className="sm:col-span-2" />
        <Summary label="Objective" value={state.objective || '—'} className="sm:col-span-2" />
      </dl>

      <div className="rounded-lg border border-border bg-raised p-4">
        <h3 className="text-sm font-semibold">What happens when you launch</h3>
        <ol className="mt-2.5 space-y-1.5 text-sm text-muted-foreground">
          {[
            'Discovery queries the source and stores every raw record with its provenance.',
            'Normalisation canonicalises names, phones and domains, then merges duplicates.',
            'Verification runs deterministic identity, contact and website checks.',
            'Enrichment fetches the website safely and records observable gaps as evidence.',
            'AI analysis turns that evidence into grounded pain points and a recommended angle.',
            'Scoring ranks each lead across six dimensions and explains the result.',
            state.autoPersonalize
              ? 'Personalisation drafts channel-native messages for your review.'
              : 'Drafting stays manual — generate messages per lead when you are ready.',
          ].map((line, index) => (
            <li key={line} className="flex gap-2">
              <span className="tabular mt-px shrink-0 text-2xs text-muted-foreground/70">
                {index + 1}.
              </span>
              <span className="text-pretty">{line}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5">
        <p className="text-xs text-pretty">
          <span className="font-medium">Nothing is sent automatically.</span> Every message waits in
          the outreach queue until you approve it, and suppression is re-checked immediately before
          each send.
        </p>
      </div>
    </div>
  );
}

/** Live example showing what a lead from this campaign will look like. */
function LivePreview({ state }: { state: WizardState }) {
  const categories = splitList(state.categories);
  return (
    <aside className="space-y-3 lg:sticky lg:top-[calc(theme(spacing.topbar)+1.25rem)] lg:self-start">
      <div className="panel surface-gradient p-4">
        <p className="eyebrow">Example lead</p>
        <p className="mt-0.5 text-2xs text-muted-foreground text-pretty">
          Illustrative only — shows the shape of a result from these settings, not real data.
        </p>

        <div className="mt-3 flex items-start gap-3">
          <ScoreRing score={92} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {categories[0] ? `A well-reviewed ${categories[0]}` : 'A qualifying business'}
            </p>
            <p className="mt-0.5 truncate text-2xs text-muted-foreground">
              {state.location || 'Your target area'}
            </p>
          </div>
        </div>

        <ul className="mt-3 flex flex-wrap gap-1">
          {state.minRating ? (
            <li>
              <Badge variant="outline">{state.minRating}★+</Badge>
            </li>
          ) : null}
          {state.minReviews ? (
            <li>
              <Badge variant="outline">{state.minReviews}+ reviews</Badge>
            </li>
          ) : null}
          {state.websiteCondition !== 'any' ? (
            <li>
              <Badge variant="warning">{websiteConditionLabel(state.websiteCondition)}</Badge>
            </li>
          ) : null}
          {state.socialCondition === 'with_instagram' ? (
            <li>
              <Badge variant="primary">IG active</Badge>
            </li>
          ) : null}
        </ul>

        <div className="mt-3 border-t border-border pt-3">
          <p className="eyebrow mb-1">Channel</p>
          <Badge variant="primary" className="capitalize">
            {state.channel}
          </Badge>
          <span className="ml-1.5 text-2xs capitalize text-muted-foreground">
            {state.tone} tone
          </span>
        </div>
      </div>

      <div className="panel p-3">
        <p className="eyebrow mb-1.5">Estimated work</p>
        <dl className="space-y-1 text-2xs">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Businesses to process</dt>
            <dd className="tabular font-medium">{state.leadLimit}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">AI calls per lead</dt>
            <dd className="tabular font-medium">{state.autoPersonalize ? '~5' : '~2'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Model tier</dt>
            <dd className="font-medium capitalize">{state.tier}</dd>
          </div>
        </dl>
        <p className="mt-2 text-2xs text-muted-foreground text-pretty">
          Actual spend depends on the model the router picks. Track it under AI Usage.
        </p>
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */

function StepHeading({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border pb-4">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary [&_svg]:size-4"
        aria-hidden="true"
      >
        {icon}
      </span>
      <div>
        <h2 className="text-md font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground text-pretty">{description}</p>
      </div>
    </div>
  );
}

function RadioOption({
  value,
  label,
  description,
}: {
  value: string;
  label: string;
  description: string;
}) {
  return (
    <label className="flex cursor-pointer gap-2.5 rounded-md border border-border p-2.5 transition-colors hover:border-border-strong has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-primary/[0.07]">
      <RadioGroupItem value={value} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-2xs text-muted-foreground text-pretty">
          {description}
        </span>
      </span>
    </label>
  );
}

function Summary({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 text-sm capitalize text-pretty">{value}</dd>
    </div>
  );
}

function websiteConditionLabel(condition: WizardState['websiteCondition']): string {
  return { any: '', with: 'Has website', without: 'No website', broken: 'Broken website' }[
    condition
  ];
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function validateStep(step: StepId, state: WizardState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (step === 'target') {
    if (!state.name.trim()) errors.name = 'Give the campaign a name you will recognise later.';
    if (splitList(state.categories).length === 0)
      errors.categories = 'Add at least one business category.';
    if (!state.location.trim()) errors.location = 'Where should LeadForge search?';
  }
  if (step === 'intelligence') {
    if (state.offer.trim().length < 10)
      errors['ai.offer'] = 'Describe what you sell in a sentence or two.';
    if (state.objective.trim().length < 10)
      errors['ai.objective'] = 'Describe what a good outcome looks like for this campaign.';
  }
  if (step === 'outreach') {
    if (state.cta.trim().length < 3) errors['ai.cta'] = 'Give the message one clear ask.';
  }
  return errors;
}

function toPayload(state: WizardState) {
  return {
    name: state.name.trim(),
    description: state.description.trim() || undefined,
    source: state.source,
    channel: state.channel,
    target: {
      categories: splitList(state.categories),
      keywords: splitList(state.keywords),
      geo: {
        location: state.location.trim(),
        country: state.country,
        radiusMeters: Math.round(state.radiusKm * 1000),
      },
      leadLimit: state.leadLimit,
    },
    filters: {
      minRating: state.minRating ? Number(state.minRating) : undefined,
      minReviews: state.minReviews ? Number(state.minReviews) : undefined,
      websiteCondition: state.websiteCondition,
      socialCondition: state.socialCondition,
      requireContact: state.requireContact,
      excludeChains: state.excludeChains,
      excludeKeywords: [],
      customRules: state.customRules
        .split('\n')
        .map((rule) => rule.trim())
        .filter(Boolean),
    },
    ai: {
      offer: state.offer.trim(),
      objective: state.objective.trim(),
      tone: state.tone,
      cta: state.cta.trim(),
      senderName: state.senderName.trim() || undefined,
      senderCompany: state.senderCompany.trim() || undefined,
      tier: state.tier,
    },
    autoPersonalize: state.autoPersonalize,
  };
}
