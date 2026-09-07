'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Blocks, Brain, Check, Target, Upload } from 'lucide-react';
import { Wordmark } from '@/components/layout/logo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Reveal, Stagger } from '@/components/ui/motion';
import { useMe } from '@/lib/queries';
import { cn } from '@/lib/utils';

const OBJECTIVES = [
  {
    id: 'web_design',
    title: 'Sell websites and web design',
    description: 'Target businesses with strong reviews but no working site.',
    preset: 'websiteCondition=without',
  },
  {
    id: 'marketing',
    title: 'Sell marketing or ads',
    description: 'Target businesses with a site but weak conversion paths.',
    preset: 'websiteCondition=with',
  },
  {
    id: 'bookings',
    title: 'Sell booking or ordering systems',
    description: 'Target busy venues with no way to take bookings online.',
    preset: 'websiteCondition=any',
  },
  {
    id: 'other',
    title: 'Something else',
    description: 'Define your own qualification rules from scratch.',
    preset: '',
  },
] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const me = useMe();
  const [objective, setObjective] = React.useState<string | null>(null);

  const capabilities = me.data?.capabilities;
  const missing = capabilities
    ? [
        !capabilities.ai
          ? { key: 'ai', label: 'OpenRouter', reason: 'AI analysis and message generation' }
          : null,
        !capabilities.googlePlaces
          ? { key: 'places', label: 'Google Places', reason: 'lead discovery' }
          : null,
      ].filter(Boolean)
    : [];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-6 py-10">
      <Wordmark />

      <Reveal className="mt-10">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          Welcome{me.data ? `, ${me.data.user.name.split(' ')[0]}` : ''}.
        </h1>
        <p className="mt-2 text-md text-muted-foreground text-pretty">
          LeadForge finds businesses worth contacting, proves why they are worth contacting, and
          prepares the right message. Two questions and you are set up.
        </p>
      </Reveal>

      <Reveal className="mt-8" delay={80}>
        <h2 className="text-sm font-semibold">What are you selling?</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          This preselects the qualification filters in your first campaign. You can change all of it
          later.
        </p>
        <Stagger className="mt-3 grid gap-2 sm:grid-cols-2" step={50}>
          {OBJECTIVES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setObjective(item.id)}
              aria-pressed={objective === item.id}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-lg border p-3.5 text-left transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                objective === item.id
                  ? 'border-primary bg-primary/[0.07] shadow-subtle'
                  : 'border-border bg-surface hover:-translate-y-0.5 hover:border-border-strong hover:shadow-raised',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                  objective === item.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border-strong',
                )}
                aria-hidden="true"
              >
                {objective === item.id ? <Check className="size-2.5" strokeWidth={3} /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{item.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground text-pretty">
                  {item.description}
                </span>
              </span>
            </button>
          ))}
        </Stagger>
      </Reveal>

      {missing.length > 0 ? (
        <Reveal className="mt-8" delay={140}>
          <div className="rounded-lg border border-warning/30 bg-warning/[0.07] p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Blocks className="size-4 text-warning" aria-hidden="true" />
              Connect your providers
            </h2>
            <p className="mt-1 text-xs text-muted-foreground text-pretty">
              LeadForge does not simulate providers. Until these are configured, the stages that
              need them will report that plainly rather than returning made-up data.
            </p>
            <ul className="mt-2.5 space-y-1.5">
              {missing.map((item) =>
                item ? (
                  <li key={item.key} className="flex items-center gap-2 text-sm">
                    <Badge variant="warning">Not configured</Badge>
                    <span className="font-medium">{item.label}</span>
                    <span className="text-xs text-muted-foreground">needed for {item.reason}</span>
                  </li>
                ) : null,
              )}
            </ul>
            <Button variant="secondary" size="sm" className="mt-3" asChild>
              <Link href="/dashboard/settings/integrations">Open integrations</Link>
            </Button>
          </div>
        </Reveal>
      ) : null}

      <Reveal className="mt-8" delay={200}>
        <h2 className="text-sm font-semibold">How the pipeline works</h2>
        <ol className="mt-3 space-y-2.5">
          {[
            {
              icon: Target,
              title: 'Discover',
              body: 'Search authorised business listings by area, category and quality bar.',
            },
            {
              icon: Check,
              title: 'Verify and enrich',
              body: 'Deterministic checks on identity, phone, website and geography. Every observation is stored as evidence.',
            },
            {
              icon: Brain,
              title: 'Analyse and score',
              body: 'AI reads the evidence and produces grounded pain points, an angle, and an explainable score.',
            },
            {
              icon: ArrowRight,
              title: 'Draft and approve',
              body: 'Channel-native messages you review before anything is sent. Nothing sends automatically.',
            },
          ].map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="flex gap-3">
                <span
                  className="tabular flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-raised text-2xs font-semibold text-muted-foreground"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon className="size-3.5 text-primary" aria-hidden="true" />
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </Reveal>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-10">
        <Button
          variant="primary"
          size="lg"
          onClick={() => {
            const preset = OBJECTIVES.find((o) => o.id === objective)?.preset;
            router.push(preset ? `/dashboard/campaigns/new?${preset}` : '/dashboard/campaigns/new');
          }}
        >
          Create your first campaign
          <ArrowRight aria-hidden="true" />
        </Button>
        <Button variant="secondary" size="lg" asChild>
          <Link href="/dashboard/leads/import">
            <Upload aria-hidden="true" />
            Import an existing list
          </Link>
        </Button>
        <Button variant="ghost" size="lg" asChild>
          <Link href="/dashboard">Skip for now</Link>
        </Button>
      </div>
    </main>
  );
}
