import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@leadforge/shared';
import { AiGateway, type AiUsageRecord } from './gateway';
import type { AiProvider, CompletionRequest, CompletionResponse } from './types';

/** Scriptable provider so gateway behaviour can be tested without network. */
class ScriptedProvider implements AiProvider {
  readonly name = 'scripted';
  readonly calls: CompletionRequest[] = [];
  private readonly script: (request: CompletionRequest, callIndex: number) => CompletionResponse;

  constructor(script: (request: CompletionRequest, callIndex: number) => CompletionResponse) {
    this.script = script;
  }

  isConfigured(): boolean {
    return true;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const index = this.calls.length;
    this.calls.push(request);
    return this.script(request, index);
  }
}

function ok(text: string): CompletionResponse {
  return { text, model: 'test', inputTokens: 100, outputTokens: 50, providerRequestId: 'gen_1' };
}

const CLASSIFICATION = JSON.stringify({
  category: 'restaurant',
  subcategory: 'italian',
  is_chain: false,
  b2c_or_b2b: 'b2c',
  confidence: 0.9,
});

const BUSINESS = {
  name: 'Mario Italian Kitchen',
  category: 'restaurant',
  city: 'Manchester',
  country: 'GB',
  phone: '+441612345678',
  website: null,
  rating: 4.6,
  reviewCount: 412,
  source: 'google_places',
};

beforeEach(() => {
  process.env.AI_ENABLED = 'true';
  process.env.OPENROUTER_API_KEY = 'test-key';
  // Pin the routing mode rather than inheriting whatever the developer has in
  // .env. With free-models-only on, every call costs zero, which quietly
  // invalidates the cost assertions below.
  process.env.AI_FREE_MODELS_ONLY = 'false';
});

describe('AiGateway', () => {
  it('returns validated output and records usage', async () => {
    const usage: AiUsageRecord[] = [];
    const gateway = new AiGateway({
      provider: new ScriptedProvider(() => ok(CLASSIFICATION)),
      onUsage: (record) => {
        usage.push(record);
      },
    });

    const result = await gateway.run('classify_business', BUSINESS);

    expect(result.result.category).toBe('restaurant');
    expect(result.validationStatus).toBe('valid');
    expect(result.attempts).toBe(1);
    expect(result.promptVersion).toContain('classify_business@');
    expect(usage).toHaveLength(1);
    expect(usage[0]?.success).toBe(true);
    expect(usage[0]?.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('reports a rate limit as a rate limit after every model has been tried', async () => {
    // The aggregate error used to flatten every cause to PROVIDER_UNAVAILABLE.
    // The worker keys its "reschedule instead of retry" behaviour off this
    // code, so losing it meant a daily quota burned all five retry attempts in
    // half a minute and dead-lettered while the quota was still exhausted.
    const gateway = new AiGateway({
      provider: new ScriptedProvider(() => {
        throw new AppError('PROVIDER_RATE_LIMITED', 'OpenRouter rate limit reached.', {
          retryable: true,
        });
      }),
    });

    await expect(gateway.run('classify_business', BUSINESS)).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
    });
  });

  it('reports an exhausted budget as non-retryable', async () => {
    // No amount of waiting fixes an empty account, so this must not be retried.
    const gateway = new AiGateway({
      provider: new ScriptedProvider(() => {
        throw new AppError('AI_BUDGET_EXCEEDED', 'OpenRouter reports insufficient credit.', {
          retryable: false,
        });
      }),
    });

    await expect(gateway.run('classify_business', BUSINESS)).rejects.toMatchObject({
      code: 'AI_BUDGET_EXCEEDED',
      retryable: false,
    });
  });

  it('unwraps a markdown-fenced JSON response and marks it repaired', async () => {
    const gateway = new AiGateway({
      provider: new ScriptedProvider(() => ok('```json\n' + CLASSIFICATION + '\n```')),
    });

    const result = await gateway.run('classify_business', BUSINESS);
    expect(result.result.category).toBe('restaurant');
    expect(result.validationStatus).toBe('repaired');
  });

  it('extracts JSON when the model adds prose around it', async () => {
    const gateway = new AiGateway({
      provider: new ScriptedProvider(() => ok(`Here you go:\n${CLASSIFICATION}\nHope that helps!`)),
    });

    const result = await gateway.run('classify_business', BUSINESS);
    expect(result.result.is_chain).toBe(false);
    expect(result.validationStatus).toBe('repaired');
  });

  it('falls back to another model when output fails the schema', async () => {
    const provider = new ScriptedProvider((_request, index) =>
      // First model returns a well-formed but wrong-shaped object.
      index === 0 ? ok(JSON.stringify({ nonsense: true })) : ok(CLASSIFICATION),
    );
    const gateway = new AiGateway({ provider });

    const result = await gateway.run('classify_business', BUSINESS);

    expect(result.result.category).toBe('restaurant');
    expect(result.fallbackFrom.length).toBeGreaterThan(0);
    // The retry used a different model, not the same one again.
    expect(provider.calls[0]?.model).not.toBe(provider.calls[1]?.model);
  });

  it('retries the same model on a transient failure', async () => {
    const provider = new ScriptedProvider((_request, index) => {
      if (index === 0) throw new AppError('PROVIDER_ERROR', 'socket hang up');
      return ok(CLASSIFICATION);
    });
    const gateway = new AiGateway({ provider });

    const result = await gateway.run('classify_business', BUSINESS);

    expect(result.result.category).toBe('restaurant');
    expect(provider.calls[0]?.model).toBe(provider.calls[1]?.model);
    expect(result.fallbackFrom).toHaveLength(0);
  });

  it('does not retry a configuration failure', async () => {
    const provider = new ScriptedProvider(() => {
      throw AppError.providerNotConfigured('OpenRouter');
    });
    const gateway = new AiGateway({ provider });

    await expect(gateway.run('classify_business', BUSINESS)).rejects.toThrow(AppError);
    expect(provider.calls).toHaveLength(1);
  });

  it('gives up with a clear error when every candidate fails', async () => {
    const provider = new ScriptedProvider(() => ok('not json at all'));
    const gateway = new AiGateway({ provider });

    await expect(gateway.run('classify_business', BUSINESS)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(provider.calls.length).toBeGreaterThan(1);
  });

  it('records a usage row for failed attempts too', async () => {
    const usage: AiUsageRecord[] = [];
    const gateway = new AiGateway({
      provider: new ScriptedProvider((_r, index) =>
        index === 0 ? ok('broken') : ok(CLASSIFICATION),
      ),
      onUsage: (record) => {
        usage.push(record);
      },
    });

    await gateway.run('classify_business', BUSINESS);

    expect(usage.filter((u) => !u.success)).toHaveLength(1);
    expect(usage.filter((u) => u.success)).toHaveLength(1);
    expect(usage[0]?.failureReason).toBe('schema_invalid');
  });

  it('sends a JSON schema for tasks that require structured output', async () => {
    const provider = new ScriptedProvider(() => ok(CLASSIFICATION));
    const gateway = new AiGateway({ provider });

    await gateway.run('classify_business', BUSINESS);

    const schema = provider.calls[0]?.jsonSchema;
    expect(schema?.name).toBe('business_classification');
    expect(schema?.schema).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it('refuses to run when AI is not configured', async () => {
    const gateway = new AiGateway({
      provider: {
        name: 'unconfigured',
        isConfigured: () => false,
        complete: async () => {
          throw new Error('should not be called');
        },
      },
    });

    await expect(gateway.run('classify_business', BUSINESS)).rejects.toMatchObject({
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  });

  it('never lets a usage-recording failure break the call', async () => {
    const gateway = new AiGateway({
      provider: new ScriptedProvider(() => ok(CLASSIFICATION)),
      onUsage: () => {
        throw new Error('accounting is down');
      },
    });

    await expect(gateway.run('classify_business', BUSINESS)).resolves.toBeDefined();
  });
});
