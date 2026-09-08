import { describe, expect, it } from 'vitest';
import { ModelRouter, classifyFailure, shouldFallback, shouldRetrySameModel } from './router';
import { MODEL_REGISTRY, estimateCost } from './registry';
import { AppError } from '@leadforge/shared';

const router = new ModelRouter();

describe('ModelRouter', () => {
  it('picks the cheapest paid model that meets the tier', () => {
    const decision = router.route({
      task: 'classify_business',
      tier: 'economy',
      requiresStructuredOutput: false,
    });
    const first = decision.candidates[0];
    expect(first).toBeDefined();
    expect(first?.free).toBe(false);

    // The router orders on the estimated cost of a whole call, not on the
    // input rate alone — a model with cheap input and expensive output is not
    // the cheaper choice. Free models are excluded from the comparison on
    // purpose: they sort last regardless of price, so that a paid deployment
    // is never silently downgraded to a rate-limited model.
    const paid = decision.candidates.filter((m) => !m.free);
    const costs = paid.map((m) => estimateCost(m, 2_000, 1_500));
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(paid[0]).toBe(first);
  });

  it('excludes models that cannot do structured output when required', () => {
    const decision = router.route({
      task: 'validate_message',
      tier: 'economy',
      requiresStructuredOutput: true,
    });
    expect(decision.candidates.every((m) => m.supportsStructuredOutput)).toBe(true);
    expect(decision.candidates.length).toBeGreaterThan(0);
  });

  it('treats tier as a floor, so a quality request never returns an economy model', () => {
    const decision = router.route({
      task: 'analyze_business',
      tier: 'quality',
      requiresStructuredOutput: true,
    });
    expect(decision.candidates.every((m) => m.tier === 'quality')).toBe(true);
  });

  it('honours a deny list', () => {
    const denied = MODEL_REGISTRY[0]?.id as string;
    const decision = router.route({
      task: 'classify_business',
      tier: 'economy',
      requiresStructuredOutput: false,
      deniedModels: [denied],
    });
    expect(decision.candidates.map((m) => m.id)).not.toContain(denied);
  });

  it('honours an allow list', () => {
    const decision = router.route({
      task: 'classify_business',
      tier: 'economy',
      requiresStructuredOutput: true,
      allowedModels: ['openai/gpt-4o-mini'],
    });
    expect(decision.candidates.map((m) => m.id)).toEqual(['openai/gpt-4o-mini']);
  });

  it('excludes models whose context window cannot fit the prompt', () => {
    const decision = router.route({
      task: 'analyze_business',
      tier: 'economy',
      requiresStructuredOutput: false,
      estimatedInputTokens: 500_000,
    });
    expect(decision.candidates.every((m) => m.contextWindow >= 501_500)).toBe(true);
  });

  it('prefers faster models when latency is the priority', () => {
    const decision = router.route({
      task: 'classify_reply',
      tier: 'economy',
      requiresStructuredOutput: true,
      latencyPreference: 'fast',
    });
    expect(decision.candidates[0]?.throughput).toBe('fast');
  });

  it('throws a clear error when nothing satisfies the requirements', () => {
    expect(() =>
      router.route({
        task: 'analyze_business',
        tier: 'quality',
        requiresStructuredOutput: true,
        // Larger than any model's context window, so nothing survives. A cost
        // ceiling no longer works as the impossible requirement here: free
        // models really do cost zero and would pass any budget.
        estimatedInputTokens: 100_000_000,
      }),
    ).toThrow(AppError);
  });

  it('prefers paid models over free ones, and keeps free ones as fallbacks', () => {
    const decision = router.route({
      task: 'analyze_business',
      tier: 'economy',
      requiresStructuredOutput: true,
    });

    expect(decision.candidates[0]?.free).toBe(false);
    // Free models are still in the chain — just behind everything that pays
    // for better reliability.
    expect(decision.candidates.some((model) => model.free)).toBe(true);
  });

  it('routes only to free models when freeOnly is set', () => {
    const decision = router.route({
      task: 'analyze_business',
      tier: 'quality',
      requiresStructuredOutput: true,
      freeOnly: true,
    });

    expect(decision.candidates.length).toBeGreaterThan(0);
    expect(decision.candidates.every((model) => model.free)).toBe(true);
  });

  it('always returns fallbacks after the primary', () => {
    const decision = router.route({
      task: 'generate_message',
      tier: 'balanced',
      requiresStructuredOutput: true,
    });
    expect(decision.candidates.length).toBeGreaterThan(1);
  });
});

describe('failure classification', () => {
  it('falls back on a rate limit but does not sit and retry the same model', () => {
    const kind = classifyFailure(new AppError('PROVIDER_RATE_LIMITED', 'slow down'));
    expect(kind).toBe('rate_limited');
    // Sleeping in-process holds a worker slot and does not help: a daily quota
    // does not reset in five seconds. The worker reschedules the job instead.
    expect(shouldRetrySameModel(kind)).toBe(false);
    expect(shouldFallback(kind)).toBe(true);
  });

  it('falls back but does not retry on a schema failure', () => {
    const kind = classifyFailure(new AppError('AI_SCHEMA_INVALID', 'bad shape'));
    expect(kind).toBe('schema_invalid');
    expect(shouldRetrySameModel(kind)).toBe(false);
    expect(shouldFallback(kind)).toBe(true);
  });

  it('does neither for a configuration failure', () => {
    const kind = classifyFailure(AppError.providerNotConfigured('OpenRouter'));
    expect(kind).toBe('permanent');
    expect(shouldRetrySameModel(kind)).toBe(false);
    expect(shouldFallback(kind)).toBe(false);
  });

  it('recognises network errors as transient', () => {
    expect(classifyFailure(new Error('fetch failed: ECONNRESET'))).toBe('transient');
    expect(classifyFailure(new Error('socket hang up'))).toBe('transient');
  });

  it('recognises a missing model as unavailable', () => {
    expect(classifyFailure(new Error('No endpoints found for model'))).toBe('model_unavailable');
  });
});
