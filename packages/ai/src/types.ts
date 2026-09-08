import type { z } from 'zod';
import type { AiTaskName } from '@leadforge/shared';

/**
 * AI Gateway contracts (docs/16-AI-GATEWAY.md).
 *
 * The application never names a model. It names a task and a quality tier;
 * the router turns that into a concrete model, and the gateway returns the
 * validated result plus everything needed to audit it.
 */

export type QualityTier = 'economy' | 'balanced' | 'quality';

export interface ModelDescriptor {
  /** Provider-qualified id, e.g. "google/gemini-2.0-flash-001". */
  readonly id: string;
  readonly label: string;
  readonly tier: QualityTier;
  /** True when the model reliably honours a JSON schema response format. */
  readonly supportsStructuredOutput: boolean;
  readonly contextWindow: number;
  readonly inputCostPerMillion: number;
  readonly outputCostPerMillion: number;
  /** Free-tier models are development capacity, never guaranteed throughput. */
  readonly free: boolean;
  /** Rough tokens/second, used to break ties on latency preference. */
  readonly throughput: 'fast' | 'medium' | 'slow';
}

export interface RoutingRequirements {
  readonly task: AiTaskName;
  readonly tier: QualityTier;
  readonly requiresStructuredOutput: boolean;
  /** Hard ceiling for this call, in USD. Models above it are excluded. */
  readonly maxCostUsd?: number;
  readonly latencyPreference?: 'fast' | 'balanced';
  readonly allowedModels?: readonly string[];
  readonly deniedModels?: readonly string[];
  /** Approximate prompt size, used to exclude models with too little context. */
  readonly estimatedInputTokens?: number;
  /** Excludes every model that costs money. Set from AI_FREE_MODELS_ONLY. */
  readonly freeOnly?: boolean;
}

export interface RoutingDecision {
  /** Ordered candidates: first is the primary, the rest are fallbacks. */
  readonly candidates: readonly ModelDescriptor[];
  readonly reason: string;
}

export interface AiCallOptions {
  readonly tier?: QualityTier;
  readonly maxCostUsd?: number;
  readonly latencyPreference?: 'fast' | 'balanced';
  readonly allowedModels?: readonly string[];
  readonly deniedModels?: readonly string[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  /** Correlation IDs carried through to the usage record. */
  readonly requestId?: string;
  readonly organizationId?: string;
  readonly campaignId?: string;
  readonly leadId?: string;
  readonly signal?: AbortSignal;
  /**
   * Forces this call onto free models, or off them, overriding
   * AI_FREE_MODELS_ONLY. Useful for a single high-stakes task on an otherwise
   * free deployment.
   */
  readonly freeOnly?: boolean;
}

export interface AiUsageMetrics {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
}

export interface AiResult<T> {
  readonly result: T;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly usage: AiUsageMetrics;
  readonly latencyMs: number;
  readonly requestId: string;
  readonly providerRequestId?: string;
  readonly validationStatus: 'valid' | 'repaired';
  /** Models tried and rejected before this one succeeded. */
  readonly fallbackFrom: readonly string[];
  readonly attempts: number;
}

export interface PromptMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface BuiltPrompt {
  readonly messages: readonly PromptMessage[];
  readonly promptVersion: string;
  /** JSON-schema name sent to the provider for structured output. */
  readonly schemaName: string;
}

export interface CompletionRequest {
  readonly model: string;
  readonly messages: readonly PromptMessage[];
  readonly temperature: number;
  readonly maxOutputTokens: number;
  /** When set, the provider is asked to return JSON matching this schema. */
  readonly jsonSchema?: { readonly name: string; readonly schema: Record<string, unknown> };
  readonly signal?: AbortSignal;
  readonly requestId: string;
}

export interface CompletionResponse {
  readonly text: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly providerRequestId?: string;
}

/** A provider is any backend that can complete a chat request. */
export interface AiProvider {
  readonly name: string;
  isConfigured(): boolean;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

/** Per-task input types, keyed by task name. */
export interface TaskInputs {
  classify_business: BusinessFacts;
  analyze_business: AnalyzeInput;
  score_lead: ScoreInput;
  generate_message: GenerateMessageInput;
  validate_message: ValidateMessageInput;
  classify_reply: ClassifyReplyInput;
  summarize_conversation: SummarizeConversationInput;
}

export interface BusinessFacts {
  readonly name: string;
  readonly category?: string | null;
  readonly address?: string | null;
  readonly city?: string | null;
  readonly country?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly website?: string | null;
  readonly rating?: number | null;
  readonly reviewCount?: number | null;
  readonly source: string;
  readonly websiteStatus?: string | null;
  readonly socialProfiles?: readonly { platform: string; url: string }[];
}

export interface EvidenceFact {
  readonly id: string;
  readonly type: string;
  readonly statement: string;
  readonly source: string;
  readonly confidence: number;
  readonly observedAt: string;
}

export interface AnalyzeInput {
  readonly business: BusinessFacts;
  readonly evidence: readonly EvidenceFact[];
  /** What the user sells; shapes which gaps count as opportunities. */
  readonly offer: string;
  readonly objective: string;
  readonly customRules?: readonly string[];
}

export interface ScoreInput {
  readonly business: BusinessFacts;
  readonly evidence: readonly EvidenceFact[];
  readonly analysis: {
    readonly summary: string;
    readonly painPoints: readonly string[];
    readonly opportunities: readonly string[];
    readonly confidence: number;
  } | null;
  /** Deterministic dimension values the model must explain, not recompute. */
  readonly dimensions: Readonly<Record<string, number>>;
  readonly offer: string;
}

export interface GenerateMessageInput {
  readonly business: BusinessFacts;
  readonly evidence: readonly EvidenceFact[];
  readonly angle: string;
  readonly channel: 'whatsapp' | 'instagram' | 'email' | 'manual';
  readonly kind: string;
  readonly tone: string;
  readonly cta: string;
  readonly offer: string;
  readonly senderName?: string | null;
  readonly senderCompany?: string | null;
  readonly maxLength: number;
  readonly targetLength: number;
  readonly styleGuidance: string;
  /** Extra instruction from a refinement action ("make it shorter"). */
  readonly refinement?: string | null;
  /** Prior messages in the sequence, so a follow-up does not repeat them. */
  readonly previousMessages?: readonly string[];
}

export interface ValidateMessageInput {
  readonly business: BusinessFacts;
  readonly evidence: readonly EvidenceFact[];
  readonly body: string;
  readonly channel: string;
}

export interface ClassifyReplyInput {
  readonly business: BusinessFacts;
  readonly incomingMessage: string;
  readonly history: readonly { direction: 'inbound' | 'outbound'; body: string }[];
  readonly offer: string;
  /** Rep's steer for the suggested response. */
  readonly guidance?: string | null;
}

export interface SummarizeConversationInput {
  readonly business: BusinessFacts;
  readonly history: readonly { direction: 'inbound' | 'outbound'; body: string }[];
}

/** Builds the messages for one task at a fixed prompt version. */
export interface PromptBuilder<T extends AiTaskName> {
  readonly task: T;
  readonly version: string;
  readonly requiresStructuredOutput: boolean;
  readonly defaultTier: QualityTier;
  readonly schema: z.ZodType<unknown>;
  build(input: TaskInputs[T]): BuiltPrompt;
}
