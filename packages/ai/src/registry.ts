import type { ModelDescriptor } from './types';

/**
 * Model registry.
 *
 * Pricing is per million tokens in USD, taken from OpenRouter's published
 * rates. It only drives routing and cost estimation — the real cost comes from
 * the provider's usage response where available. Adding a model here is the
 * only change needed to make the router consider it.
 */
export const MODEL_REGISTRY: readonly ModelDescriptor[] = [
  // --- Economy: classification, cheap extraction, high volume ---------------
  {
    id: 'google/gemini-2.0-flash-001',
    label: 'Gemini 2.0 Flash',
    tier: 'economy',
    supportsStructuredOutput: true,
    contextWindow: 1_000_000,
    inputCostPerMillion: 0.1,
    outputCostPerMillion: 0.4,
    free: false,
    throughput: 'fast',
  },
  {
    id: 'openai/gpt-4o-mini',
    label: 'GPT-4o mini',
    tier: 'economy',
    supportsStructuredOutput: true,
    contextWindow: 128_000,
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.6,
    free: false,
    throughput: 'fast',
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    label: 'Llama 3.3 70B Instruct',
    tier: 'economy',
    supportsStructuredOutput: false,
    contextWindow: 131_072,
    inputCostPerMillion: 0.12,
    outputCostPerMillion: 0.3,
    free: false,
    throughput: 'medium',
  },

  // --- Balanced: analysis, message generation ------------------------------
  {
    id: 'anthropic/claude-3.5-haiku',
    label: 'Claude 3.5 Haiku',
    tier: 'balanced',
    supportsStructuredOutput: true,
    contextWindow: 200_000,
    inputCostPerMillion: 0.8,
    outputCostPerMillion: 4,
    free: false,
    throughput: 'fast',
  },
  {
    id: 'openai/gpt-4o',
    label: 'GPT-4o',
    tier: 'balanced',
    supportsStructuredOutput: true,
    contextWindow: 128_000,
    inputCostPerMillion: 2.5,
    outputCostPerMillion: 10,
    free: false,
    throughput: 'medium',
  },
  {
    id: 'google/gemini-2.0-flash-thinking-exp:free',
    label: 'Gemini 2.0 Flash Thinking (free)',
    tier: 'balanced',
    supportsStructuredOutput: false,
    contextWindow: 1_000_000,
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
    free: true,
    throughput: 'medium',
  },

  // --- Quality: complex reasoning over evidence ----------------------------
  {
    id: 'anthropic/claude-3.7-sonnet',
    label: 'Claude 3.7 Sonnet',
    tier: 'quality',
    supportsStructuredOutput: true,
    contextWindow: 200_000,
    inputCostPerMillion: 3,
    outputCostPerMillion: 15,
    free: false,
    throughput: 'medium',
  },
  {
    id: 'google/gemini-2.5-pro-preview',
    label: 'Gemini 2.5 Pro',
    tier: 'quality',
    supportsStructuredOutput: true,
    contextWindow: 1_000_000,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
    free: false,
    throughput: 'slow',
  },
];

const BY_ID = new Map(MODEL_REGISTRY.map((model) => [model.id, model]));

export function findModel(id: string): ModelDescriptor | undefined {
  return BY_ID.get(id);
}

/** Cost of a call in USD, from token counts. */
export function estimateCost(
  model: ModelDescriptor,
  inputTokens: number,
  outputTokens: number,
): number {
  const cost =
    (inputTokens / 1_000_000) * model.inputCostPerMillion +
    (outputTokens / 1_000_000) * model.outputCostPerMillion;
  // Round to a sane precision; sub-microdollar noise is meaningless.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * Rough token estimate for routing decisions only. Never used for billing —
 * the provider's own usage numbers are authoritative there.
 */
export function estimateTokens(text: string): number {
  // ~4 characters per token is close enough for English prose and JSON.
  return Math.ceil(text.length / 4);
}
