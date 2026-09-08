import { AppError } from '@leadforge/shared';
import { MODEL_REGISTRY, estimateCost } from './registry';
import type { ModelDescriptor, RoutingDecision, RoutingRequirements, QualityTier } from './types';

/**
 * Model router (docs/17-OPENROUTER-MODEL-ROUTING.md).
 *
 * Policy: use the cheapest model that reliably meets the task's requirements.
 * Requirements are hard filters; cost then orders what survives. The result is
 * an ordered candidate list, so the gateway has somewhere to fall back to
 * without asking the router again.
 */

const TIER_ORDER: readonly QualityTier[] = ['economy', 'balanced', 'quality'];

/** Assumed output size when checking a model's context window. */
const ASSUMED_OUTPUT_TOKENS = 1_500;

export class ModelRouter {
  private readonly models: readonly ModelDescriptor[];

  constructor(models: readonly ModelDescriptor[] = MODEL_REGISTRY) {
    this.models = models;
  }

  route(requirements: RoutingRequirements): RoutingDecision {
    const reasons: string[] = [];
    let candidates = [...this.models];

    // 1. Explicit allow/deny lists always win.
    if (requirements.allowedModels && requirements.allowedModels.length > 0) {
      const allowed = new Set(requirements.allowedModels);
      candidates = candidates.filter((model) => allowed.has(model.id));
      reasons.push(`restricted to ${requirements.allowedModels.length} allowed models`);
    }
    if (requirements.deniedModels && requirements.deniedModels.length > 0) {
      const denied = new Set(requirements.deniedModels);
      candidates = candidates.filter((model) => !denied.has(model.id));
      reasons.push('applied deny list');
    }

    // 2. Structured output is a hard capability, not a preference. A model
    //    that cannot honour the schema would fail validation every time.
    if (requirements.requiresStructuredOutput) {
      candidates = candidates.filter((model) => model.supportsStructuredOutput);
      reasons.push('structured output required');
    }

    // 3. Free-only is a hard filter, deliberately applied before tier and
    //    cost. Someone running at zero budget would rather the call fail
    //    loudly than silently spend money.
    if (requirements.freeOnly) {
      candidates = candidates.filter((model) => model.free);
      reasons.push('free models only');
    }

    // 4. Context window must fit the prompt plus room to answer.
    if (requirements.estimatedInputTokens) {
      const needed = requirements.estimatedInputTokens + ASSUMED_OUTPUT_TOKENS;
      candidates = candidates.filter((model) => model.contextWindow >= needed);
      reasons.push(`context >= ${needed} tokens`);
    }

    // 5. Tier is a floor, not an exact match: a stronger model still meets a
    //    weaker requirement, and cost ordering will prefer the cheap one.
    const minTierIndex = TIER_ORDER.indexOf(requirements.tier);
    candidates = candidates.filter((model) => TIER_ORDER.indexOf(model.tier) >= minTierIndex);
    reasons.push(`tier >= ${requirements.tier}`);

    // 6. Per-call cost ceiling.
    if (requirements.maxCostUsd !== undefined) {
      const budget = requirements.maxCostUsd;
      candidates = candidates.filter(
        (model) =>
          estimateCost(model, requirements.estimatedInputTokens ?? 2_000, ASSUMED_OUTPUT_TOKENS) <=
          budget,
      );
      reasons.push(`cost <= $${budget}`);
    }

    if (candidates.length === 0) {
      throw new AppError(
        'PROVIDER_NOT_CONFIGURED',
        `No model in the registry satisfies the requirements for "${requirements.task}" (${reasons.join(', ')}).`,
        { retryable: false, details: { requirements } },
      );
    }

    const sorted = this.sortCandidates(candidates, requirements);

    return {
      candidates: sorted,
      reason: `${reasons.join('; ')} — chose ${sorted[0]?.id} from ${sorted.length} candidates`,
    };
  }

  /**
   * Orders survivors: cheapest first, breaking ties on latency preference and
   * then on tier so the fallback chain climbs in capability rather than
   * bouncing sideways between equivalent models.
   *
   * Free models are the one exception to cost ordering. They cost nothing, so
   * pure cost ordering would put them first on every call and quietly downgrade
   * every paying deployment to a rate-limited model. Instead they sort last,
   * as the fallback that keeps a task working when the paid models are failing.
   * When `freeOnly` is set there is nothing else in the list, so this ordering
   * costs that mode nothing.
   */
  private sortCandidates(
    candidates: ModelDescriptor[],
    requirements: RoutingRequirements,
  ): ModelDescriptor[] {
    const inputTokens = requirements.estimatedInputTokens ?? 2_000;
    const preferFast = requirements.latencyPreference === 'fast';

    return candidates.sort((a, b) => {
      if (a.free !== b.free) return a.free ? 1 : -1;

      if (preferFast) {
        const speed = throughputRank(b.throughput) - throughputRank(a.throughput);
        if (speed !== 0) return speed;
      }
      const costA = estimateCost(a, inputTokens, ASSUMED_OUTPUT_TOKENS);
      const costB = estimateCost(b, inputTokens, ASSUMED_OUTPUT_TOKENS);
      if (costA !== costB) return costA - costB;

      const tierDiff = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier);
      if (tierDiff !== 0) return tierDiff;

      return throughputRank(b.throughput) - throughputRank(a.throughput);
    });
  }

  /** Preview of the routing table, used by the AI settings screen. */
  describe(requirements: RoutingRequirements): { task: string; candidates: string[] } {
    const decision = this.route(requirements);
    return { task: requirements.task, candidates: decision.candidates.map((model) => model.id) };
  }
}

function throughputRank(throughput: ModelDescriptor['throughput']): number {
  return { fast: 2, medium: 1, slow: 0 }[throughput];
}

/**
 * Classifies a provider failure so the gateway knows whether to retry the same
 * model, fall back to another, or give up (docs/17 graceful fallback).
 */
export type FailureKind =
  'transient' | 'rate_limited' | 'model_unavailable' | 'schema_invalid' | 'permanent';

export function classifyFailure(error: unknown): FailureKind {
  if (error instanceof AppError) {
    if (error.code === 'AI_SCHEMA_INVALID') return 'schema_invalid';
    if (error.code === 'PROVIDER_RATE_LIMITED') return 'rate_limited';
    if (error.code === 'PROVIDER_UNAVAILABLE') return 'model_unavailable';
    if (error.code === 'PROVIDER_ERROR') return 'transient';
    return 'permanent';
  }
  if (error instanceof Error) {
    if (/rate.?limit|429|too many requests/i.test(error.message)) return 'rate_limited';
    if (/not found|unsupported model|no endpoints|404/i.test(error.message))
      return 'model_unavailable';
    if (
      /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|timeout|502|503|504/i.test(
        error.message,
      )
    ) {
      return 'transient';
    }
  }
  return 'permanent';
}

/**
 * Whether a failure warrants trying the same model again.
 *
 * Rate limits are deliberately excluded. Sleeping and retrying in-process holds
 * a worker concurrency slot for up to a minute, and it does not help: the free
 * OpenRouter quota resets on a daily boundary, not in five seconds. Falling
 * through the remaining candidates and failing fast lets the worker reschedule
 * the whole job past the quota window, which is both correct and free.
 */
export function shouldRetrySameModel(kind: FailureKind): boolean {
  return kind === 'transient';
}

/** Whether a failure warrants moving to the next candidate. */
export function shouldFallback(kind: FailureKind): boolean {
  return (
    kind === 'model_unavailable' ||
    kind === 'schema_invalid' ||
    kind === 'transient' ||
    kind === 'rate_limited'
  );
}
