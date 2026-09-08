import type { ModelDescriptor } from './types';

/**
 * Model registry.
 *
 * Pricing is per million tokens in USD, taken from OpenRouter's published
 * rates. It only drives routing and cost estimation — the real cost comes from
 * the provider's usage response where available. Adding a model here is the
 * only change needed to make the router consider it.
 *
 * Every id here is checked against the live catalogue by
 * `scripts/check-models.mjs`. A model id that OpenRouter has retired does not
 * fail at startup — it fails on the first real call, per task, after the
 * router has already committed to it, so drift is worth catching in CI.
 */
export const MODEL_REGISTRY: readonly ModelDescriptor[] = [
  // --- Economy: classification, cheap extraction, high volume ---------------
  {
    id: 'google/gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    tier: 'economy',
    supportsStructuredOutput: true,
    contextWindow: 1_048_576,
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
    // OpenRouter reports structured_outputs support for this model.
    supportsStructuredOutput: true,
    contextWindow: 131_072,
    inputCostPerMillion: 0.1,
    outputCostPerMillion: 0.32,
    free: false,
    throughput: 'medium',
  },

  // --- Balanced: analysis, message generation ------------------------------
  {
    id: 'anthropic/claude-haiku-4.5',
    label: 'Claude Haiku 4.5',
    tier: 'balanced',
    supportsStructuredOutput: true,
    contextWindow: 200_000,
    inputCostPerMillion: 1,
    outputCostPerMillion: 5,
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
    id: 'google/gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    tier: 'balanced',
    supportsStructuredOutput: true,
    contextWindow: 1_048_576,
    inputCostPerMillion: 0.3,
    outputCostPerMillion: 2.5,
    free: false,
    throughput: 'fast',
  },

  // --- Quality: complex reasoning over evidence ----------------------------
  {
    id: 'anthropic/claude-sonnet-5',
    label: 'Claude Sonnet 5',
    tier: 'quality',
    supportsStructuredOutput: true,
    contextWindow: 1_000_000,
    inputCostPerMillion: 2,
    outputCostPerMillion: 10,
    free: false,
    throughput: 'medium',
  },
  {
    id: 'google/gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    tier: 'quality',
    supportsStructuredOutput: true,
    contextWindow: 1_000_000,
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10,
    free: false,
    throughput: 'slow',
  },

  // --- Free: everything below costs nothing on OpenRouter ------------------
  //
  // Verified against https://openrouter.ai/api/v1/models: each of these
  // reports zero prompt and completion pricing *and* lists
  // `structured_outputs` in `supported_parameters`. That second condition
  // rules out most free models — a model that cannot honour a JSON schema
  // fails every structured task in this product, so listing it here would
  // just move the failure later.
  //
  // They are rate limited and weaker than the paid tiers. AI_FREE_MODELS_ONLY
  // restricts routing to them, which is what makes a zero-cost deployment
  // possible; leave it off and they act as the cheapest fallbacks.
  {
    id: 'openrouter/free',
    label: 'OpenRouter Free Router',
    tier: 'economy',
    supportsStructuredOutput: true,
    contextWindow: 200_000,
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
    free: true,
    throughput: 'medium',
  },
  {
    id: 'liquid/lfm-2.5-2.6b:free',
    label: 'LiquidAI LFM2.5 2.6B (free)',
    tier: 'economy',
    supportsStructuredOutput: true,
    contextWindow: 65_536,
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
    free: true,
    throughput: 'fast',
  },
  {
    id: 'dots-studio/dots-3-note-preview:free',
    label: 'Dots3 Note Preview (free)',
    tier: 'balanced',
    supportsStructuredOutput: true,
    contextWindow: 512_000,
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
    free: true,
    throughput: 'medium',
  },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    label: 'NVIDIA Nemotron 3 Super 120B (free)',
    tier: 'quality',
    supportsStructuredOutput: true,
    contextWindow: 262_144,
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
    free: true,
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
