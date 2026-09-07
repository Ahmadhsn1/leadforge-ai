import { randomUUID } from 'node:crypto';
import { AppError, type AiOutputOf, type AiTaskName } from '@leadforge/shared';
import { env } from '@leadforge/config';
import { OpenRouterProvider } from './providers/openrouter';
import { getPrompt, SCHEMA_VERSION } from './prompts';
import { estimateCost, estimateTokens, findModel } from './registry';
import {
  ModelRouter,
  classifyFailure,
  shouldFallback,
  shouldRetrySameModel,
  type FailureKind,
} from './router';
import { zodToJsonSchema } from './json-schema';
import type { AiCallOptions, AiProvider, AiResult, ModelDescriptor, TaskInputs } from './types';

/**
 * AI Gateway (docs/16).
 *
 * The application calls `run(task, input)`. The gateway resolves the prompt,
 * routes to a model, calls the provider, validates the output against the
 * task's Zod schema, retries transient failures, falls back across models, and
 * returns the result with everything needed to audit it.
 *
 * A schema failure is treated as a provider failure, not as data: invalid
 * output is never persisted.
 */

export interface AiGatewayOptions {
  readonly provider?: AiProvider;
  readonly router?: ModelRouter;
  /** Called once per attempt, successful or not, for usage accounting. */
  readonly onUsage?: (record: AiUsageRecord) => void | Promise<void>;
}

export interface AiUsageRecord {
  readonly task: AiTaskName;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly latencyMs: number;
  readonly success: boolean;
  readonly failureReason?: string;
  readonly attempts: number;
  readonly fallbackFrom: readonly string[];
  readonly requestId: string;
  readonly providerRequestId?: string;
  readonly organizationId?: string;
  readonly campaignId?: string;
  readonly leadId?: string;
}

/** Max attempts against a single model before moving to the next candidate. */
const MAX_ATTEMPTS_PER_MODEL = 2;
/** Max models tried in total, so one bad request cannot walk the whole registry. */
const MAX_MODELS = 3;

export class AiGateway {
  private readonly provider: AiProvider;
  private readonly router: ModelRouter;
  private readonly onUsage: AiGatewayOptions['onUsage'];

  constructor(options: AiGatewayOptions = {}) {
    this.provider = options.provider ?? new OpenRouterProvider();
    this.router = options.router ?? new ModelRouter();
    this.onUsage = options.onUsage;
  }

  isConfigured(): boolean {
    return env().AI_ENABLED && this.provider.isConfigured();
  }

  /**
   * Runs one AI task end to end.
   *
   * @throws AppError PROVIDER_NOT_CONFIGURED when AI is unavailable — callers
   * surface this to the user rather than substituting fabricated output.
   */
  async run<T extends AiTaskName>(
    task: T,
    input: TaskInputs[T],
    options: AiCallOptions = {},
  ): Promise<AiResult<AiOutputOf<T>>> {
    if (!this.isConfigured()) {
      throw AppError.providerNotConfigured('The AI gateway');
    }

    const prompt = getPrompt(task);
    const built = prompt.build(input);
    const requestId = options.requestId ?? `ai_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

    const promptText = built.messages.map((m) => m.content).join('\n');
    const estimatedInputTokens = estimateTokens(promptText);

    const decision = this.router.route({
      task,
      tier: options.tier ?? prompt.defaultTier,
      requiresStructuredOutput: prompt.requiresStructuredOutput,
      maxCostUsd: options.maxCostUsd,
      latencyPreference: options.latencyPreference,
      allowedModels: options.allowedModels,
      deniedModels: options.deniedModels,
      estimatedInputTokens,
    });

    const jsonSchema = prompt.requiresStructuredOutput
      ? { name: built.schemaName, schema: zodToJsonSchema(prompt.schema) }
      : undefined;

    const fallbackFrom: string[] = [];
    let totalAttempts = 0;
    let lastError: unknown;

    for (const model of decision.candidates.slice(0, MAX_MODELS)) {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
        totalAttempts += 1;
        const startedAt = Date.now();

        try {
          const response = await this.provider.complete({
            model: model.id,
            messages: built.messages,
            temperature: options.temperature ?? defaultTemperature(task),
            maxOutputTokens: options.maxOutputTokens ?? 2_000,
            jsonSchema,
            signal: options.signal,
            requestId,
          });

          const latencyMs = Date.now() - startedAt;
          const parsed = this.parseAndValidate(prompt.schema, response.text, task);
          const usage = this.usageFor(
            model,
            response.inputTokens,
            response.outputTokens,
            estimatedInputTokens,
          );

          await this.recordUsage({
            task,
            provider: this.provider.name,
            model: model.id,
            promptVersion: built.promptVersion,
            schemaVersion: SCHEMA_VERSION,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            estimatedCostUsd: usage.estimatedCostUsd,
            latencyMs,
            success: true,
            attempts: totalAttempts,
            fallbackFrom,
            requestId,
            providerRequestId: response.providerRequestId,
            organizationId: options.organizationId,
            campaignId: options.campaignId,
            leadId: options.leadId,
          });

          return {
            result: parsed.value as AiOutputOf<T>,
            provider: this.provider.name,
            model: model.id,
            promptVersion: built.promptVersion,
            schemaVersion: SCHEMA_VERSION,
            usage,
            latencyMs,
            requestId,
            providerRequestId: response.providerRequestId,
            validationStatus: parsed.repaired ? 'repaired' : 'valid',
            fallbackFrom,
            attempts: totalAttempts,
          };
        } catch (error) {
          lastError = error;
          const kind = classifyFailure(error);
          const latencyMs = Date.now() - startedAt;

          await this.recordUsage({
            task,
            provider: this.provider.name,
            model: model.id,
            promptVersion: built.promptVersion,
            schemaVersion: SCHEMA_VERSION,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostUsd: 0,
            latencyMs,
            success: false,
            failureReason: kind,
            attempts: totalAttempts,
            fallbackFrom,
            requestId,
            organizationId: options.organizationId,
            campaignId: options.campaignId,
            leadId: options.leadId,
          });

          // A key or credit problem will not be fixed by another model.
          if (!shouldFallback(kind) && !shouldRetrySameModel(kind)) throw error;

          const isLastAttemptOnModel = attempt >= MAX_ATTEMPTS_PER_MODEL;
          if (shouldRetrySameModel(kind) && !isLastAttemptOnModel) {
            await delay(backoffMs(attempt, kind, error));
            continue;
          }

          fallbackFrom.push(model.id);
          break;
        }
      }
    }

    throw new AppError(
      'PROVIDER_UNAVAILABLE',
      `Every candidate model failed for task "${task}". Tried: ${fallbackFrom.join(', ') || 'none'}.`,
      {
        cause: lastError,
        retryable: true,
        details: { task, fallbackFrom, routing: decision.reason },
      },
    );
  }

  /**
   * Parses the model's text as JSON and validates it against the task schema.
   * Tolerates the two harmless things models do to JSON — wrapping it in a
   * markdown fence, and adding prose around it — but never tolerates output
   * that fails the schema.
   */
  private parseAndValidate(
    schema: {
      safeParse: (value: unknown) => { success: boolean; data?: unknown; error?: unknown };
    },
    text: string,
    task: AiTaskName,
  ): { value: unknown; repaired: boolean } {
    let raw = text.trim();
    let repaired = false;

    const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(raw);
    if (fenced?.[1]) {
      raw = fenced[1].trim();
      repaired = true;
    }

    if (!raw.startsWith('{') && !raw.startsWith('[')) {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start >= 0 && end > start) {
        raw = raw.slice(start, end + 1);
        repaired = true;
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new AppError('AI_SCHEMA_INVALID', `Model output for "${task}" was not valid JSON.`, {
        cause,
        retryable: true,
        details: { snippet: text.slice(0, 300) },
      });
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new AppError(
        'AI_SCHEMA_INVALID',
        `Model output for "${task}" did not match the expected schema.`,
        {
          retryable: true,
          details: { issues: summariseZodError(result.error) },
        },
      );
    }

    return { value: result.data, repaired };
  }

  /**
   * Prefers the provider's reported token counts; falls back to an estimate
   * when the provider omits them, so cost is never silently recorded as zero.
   */
  private usageFor(
    model: ModelDescriptor,
    inputTokens: number,
    outputTokens: number,
    estimatedInput: number,
  ): { inputTokens: number; outputTokens: number; estimatedCostUsd: number } {
    const input = inputTokens > 0 ? inputTokens : estimatedInput;
    const output = outputTokens > 0 ? outputTokens : 500;
    return {
      inputTokens: input,
      outputTokens: output,
      estimatedCostUsd: estimateCost(model, input, output),
    };
  }

  private async recordUsage(record: AiUsageRecord): Promise<void> {
    if (!this.onUsage) return;
    try {
      await this.onUsage(record);
    } catch {
      // Usage accounting must never break the call that produced the result.
    }
  }

  /** Exposes the routing table for the AI settings screen. */
  describeRouting(): {
    task: AiTaskName;
    requiresStructuredOutput: boolean;
    candidates: string[];
  }[] {
    const tasks = Object.keys({
      classify_business: 1,
      analyze_business: 1,
      score_lead: 1,
      generate_message: 1,
      validate_message: 1,
      classify_reply: 1,
      summarize_conversation: 1,
    } satisfies Record<AiTaskName, number>) as AiTaskName[];

    return tasks.map((task) => {
      const prompt = getPrompt(task);
      try {
        const decision = this.router.route({
          task,
          tier: prompt.defaultTier,
          requiresStructuredOutput: prompt.requiresStructuredOutput,
        });
        return {
          task,
          requiresStructuredOutput: prompt.requiresStructuredOutput,
          candidates: decision.candidates.slice(0, MAX_MODELS).map((model) => model.id),
        };
      } catch {
        return { task, requiresStructuredOutput: prompt.requiresStructuredOutput, candidates: [] };
      }
    });
  }
}

/** Lower temperature for classification and validation; higher for writing. */
function defaultTemperature(task: AiTaskName): number {
  switch (task) {
    case 'generate_message':
      return 0.7;
    case 'analyze_business':
      return 0.4;
    case 'summarize_conversation':
      return 0.3;
    default:
      return 0.1;
  }
}

function backoffMs(attempt: number, kind: FailureKind, error: unknown): number {
  if (kind === 'rate_limited') {
    const hinted = error instanceof AppError ? error.retryAfterMs : undefined;
    return hinted ?? 5_000 * attempt;
  }
  // Exponential with jitter, so parallel workers do not retry in lockstep.
  return Math.min(8_000, 500 * 2 ** attempt) + Math.random() * 250;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summariseZodError(error: unknown): string[] {
  const issues = (
    error as { issues?: { path: (string | number)[]; message: string }[] } | undefined
  )?.issues;
  if (!issues) return ['unknown validation error'];
  return issues
    .slice(0, 10)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

export { findModel };
