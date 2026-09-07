import { describe, expect, it } from 'vitest';
import { ModelRouter, classifyFailure, shouldFallback, shouldRetrySameModel } from './router';
import { MODEL_REGISTRY } from './registry';
import { AppError } from '@leadforge/shared';

const router = new ModelRouter();

describe('ModelRouter', () => {
  it('picks the cheapest model that meets the tier', () => {
    const decision = router.route({
      task: 'classify_business',
      tier: 'economy',
      requiresStructuredOutput: false,
    });
    const first = decision.candidates[0];
    expect(first).toBeDefined();
    // Nothing cheaper may survive ahead of it.
    const cheaper = decision.candidates.filter(
      (m) => m.inputCostPerMillion < (first?.inputCostPerMillion ?? 0),
    );
    expect(cheaper).toHaveLength(0);
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
        maxCostUsd: 0.000001,
      }),
    ).toThrow(AppError);
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
  it('treats rate limits as retryable on the same model', () => {
    const kind = classifyFailure(new AppError('PROVIDER_RATE_LIMITED', 'slow down'));
    expect(kind).toBe('rate_limited');
    expect(shouldRetrySameModel(kind)).toBe(true);
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
