'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Brain, Check, ExternalLink, Zap } from 'lucide-react';
import { Section } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { ProvenanceTag } from '@/components/intelligence/trust';
import { api, type ApiError } from '@/lib/api-client';
import { useMe } from '@/lib/queries';
import { cn, formatUsd, titleCase } from '@/lib/utils';

interface ModelEntry {
  id: string;
  label: string;
  tier: 'economy' | 'balanced' | 'quality';
  supportsStructuredOutput: boolean;
  contextWindow: number;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  free: boolean;
}

interface RoutingView {
  enabled: boolean;
  provider: string;
  defaultTier: string;
  monthlyBudgetUsd: number;
  spentThisMonthUsd: number;
  models: ModelEntry[];
  /** Ordered candidate list per task, as the router would evaluate it. */
  routes: { task: string; requiresStructuredOutput: boolean; candidates: string[] }[];
}

const TASK_DESCRIPTIONS: Record<string, string> = {
  classify_business:
    'Categorise a business and detect whether it is a chain. Cheap and high volume.',
  analyze_business:
    'Turn evidence into grounded pain points, opportunities and an angle. Needs real reasoning.',
  score_lead:
    'Explain the score dimensions. The numbers themselves are computed deterministically.',
  generate_message:
    'Write a channel-native message from the facts. Needs strong instruction following.',
  validate_message: 'Check a message against the evidence. Must return strict structured output.',
  classify_reply: 'Classify intent and sentiment of an inbound reply. Cheap and latency-sensitive.',
  summarize_conversation: 'Summarise a thread and identify the agreed next step.',
};

export default function AiSettingsPage() {
  const me = useMe();
  const routing = useQuery<RoutingView, ApiError>({
    queryKey: ['ai-routing'],
    queryFn: () => api.get<RoutingView>('/ai/routing'),
  });

  if (routing.isLoading) return <CardSkeleton className="h-64" />;

  if (routing.isError) {
    return (
      <div className="panel">
        <ErrorState description={routing.error.userMessage} onRetry={() => routing.refetch()} />
      </div>
    );
  }

  const data = routing.data;
  if (!data) return null;

  const budgetPct = data.monthlyBudgetUsd > 0 ? data.spentThisMonthUsd / data.monthlyBudgetUsd : 0;

  return (
    <div className="space-y-6">
      {!me.data?.capabilities.ai ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">AI is not configured</p>
            <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
              Set <code className="rounded-sm bg-muted px-1 font-mono">OPENROUTER_API_KEY</code> on
              the API and worker services. Until then, analysis, scoring explanations, message
              generation and the copilot return a clear "not configured" error rather than
              fabricated output.
            </p>
          </div>
          <Button variant="secondary" size="sm" className="shrink-0" asChild>
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
              Get a key
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        </div>
      ) : null}

      <Section
        title="Gateway"
        description="Every AI call in the product goes through one gateway and one router."
      >
        <div className="panel p-4">
          <dl className="grid gap-4 sm:grid-cols-4">
            <div>
              <dt className="eyebrow">Provider</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 text-sm capitalize">
                {data.provider}
                <Badge variant={data.enabled ? 'success' : 'default'}>
                  {data.enabled ? 'Active' : 'Disabled'}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Default tier</dt>
              <dd className="mt-0.5 text-sm capitalize">{data.defaultTier}</dd>
            </div>
            <div>
              <dt className="eyebrow">Monthly budget</dt>
              <dd className="tabular mt-0.5 text-sm">{formatUsd(data.monthlyBudgetUsd)}</dd>
            </div>
            <div>
              <dt className="eyebrow">Spent this month</dt>
              <dd
                className={cn(
                  'tabular mt-0.5 text-sm',
                  budgetPct >= 0.9
                    ? 'font-medium text-destructive'
                    : budgetPct >= 0.75
                      ? 'text-warning'
                      : '',
                )}
              >
                {formatUsd(data.spentThisMonthUsd)}
              </dd>
            </div>
          </dl>

          <p className="mt-4 rounded-md border border-dashed border-border bg-raised px-3 py-2 text-xs text-muted-foreground text-pretty">
            The router picks the cheapest model that reliably meets each task's requirements. If a
            model fails, it retries transient errors, then falls back to the next compatible
            candidate, records the failure, and preserves the job state. Free models are treated as
            development capacity, never as guaranteed throughput.
          </p>
        </div>
      </Section>

      <Section
        title="Routing"
        description="How each task is matched to a model, in evaluation order."
      >
        <div className="panel divide-y divide-border">
          {data.routes.map((route) => (
            <div key={route.task} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium capitalize">{route.task.replace(/_/g, ' ')}</h3>
                {route.requiresStructuredOutput ? (
                  <Badge variant="outline" className="gap-1">
                    <Check className="size-2.5" aria-hidden="true" />
                    Structured output required
                  </Badge>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
                {TASK_DESCRIPTIONS[route.task] ?? ''}
              </p>
              <ol className="mt-2 flex flex-wrap items-center gap-1.5">
                {route.candidates.map((model, index) => (
                  <li key={model} className="flex items-center gap-1.5">
                    {index > 0 ? <span className="text-2xs text-muted-foreground">→</span> : null}
                    <code
                      className={cn(
                        'rounded-sm border px-1.5 py-0.5 font-mono text-2xs',
                        index === 0
                          ? 'border-primary/30 bg-primary/10 text-primary'
                          : 'border-border bg-muted text-muted-foreground',
                      )}
                    >
                      {model}
                    </code>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Model registry"
        description="What the router can choose from, with published pricing."
      >
        {data.models.length === 0 ? (
          <div className="panel">
            <EmptyState compact icon={<Brain />} title="No models registered" />
          </div>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Registered models with tier, structured output support, context window and pricing
                per million tokens.
              </caption>
              <thead>
                <tr className="border-b border-border bg-raised/60 text-left">
                  {['Model', 'Tier', 'Structured', 'Context', 'Input / 1M', 'Output / 1M'].map(
                    (header) => (
                      <th key={header} scope="col" className="whitespace-nowrap px-3 py-2">
                        <span className="eyebrow">{header}</span>
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.models.map((model) => (
                  <tr key={model.id} className="hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs">{model.id}</span>
                      {model.free ? (
                        <Badge variant="success" className="ml-1.5 gap-1">
                          <Zap className="size-2.5" aria-hidden="true" />
                          Free
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">{titleCase(model.tier)}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {model.supportsStructuredOutput ? (
                        <Check className="size-3.5 text-success" aria-label="Supported" />
                      ) : (
                        <span className="text-2xs text-muted-foreground">No</span>
                      )}
                    </td>
                    <td className="tabular px-3 py-2 text-muted-foreground">
                      {(model.contextWindow / 1000).toFixed(0)}k
                    </td>
                    <td className="tabular px-3 py-2">{formatUsd(model.inputCostPerMillion)}</td>
                    <td className="tabular px-3 py-2">{formatUsd(model.outputCostPerMillion)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Grounding rules"
        description="Constraints applied to every generation, not suggestions."
      >
        <div className="panel p-4">
          <div className="mb-3 flex items-center gap-2">
            <ProvenanceTag provenance="verified" />
            <span className="text-xs text-muted-foreground">
              Enforced in the prompt and re-checked after generation
            </span>
          </div>
          <ul className="space-y-1.5">
            {[
              'Use only facts supplied in the prompt; never invent observations or metrics.',
              'Every pain point and opportunity must cite the evidence IDs it came from.',
              'No guaranteed outcomes, promised revenue, or fabricated urgency.',
              'Never pretend to be a customer of the business.',
              'Respect the channel length limit and use exactly one call to action.',
              'Return output that validates against the task schema, or the result is discarded.',
            ].map((rule) => (
              <li key={rule} className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
                <span className="text-pretty">{rule}</span>
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="sm" className="mt-3" asChild>
            <Link href="/dashboard/usage">See what the models actually cost</Link>
          </Button>
        </div>
      </Section>
    </div>
  );
}
