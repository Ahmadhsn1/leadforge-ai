import { AppError } from '@leadforge/shared';
import { env } from '@leadforge/config';
import type { AiProvider, CompletionRequest, CompletionResponse } from '../types';

/**
 * OpenRouter provider (docs/17).
 *
 * The only place in the codebase that knows OpenRouter's wire format. It
 * translates HTTP failures into AppErrors the router can classify, and never
 * runs in the browser — the API key stays server-side.
 */

interface OpenRouterChoice {
  message?: { content?: string | null };
  finish_reason?: string;
}

interface OpenRouterResponse {
  id?: string;
  choices?: OpenRouterChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: number | string };
}

export interface OpenRouterOptions {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Sent as HTTP-Referer/X-Title so usage is attributable in the dashboard. */
  readonly appUrl?: string;
  readonly appName?: string;
}

export class OpenRouterProvider implements AiProvider {
  readonly name = 'openrouter';

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly appUrl: string;
  private readonly appName: string;

  constructor(options: OpenRouterOptions = {}) {
    const config = env();
    this.apiKey = options.apiKey ?? config.OPENROUTER_API_KEY;
    this.baseUrl = (options.baseUrl ?? config.OPENROUTER_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.appUrl = options.appUrl ?? config.APP_URL;
    this.appName = options.appName ?? 'LeadForge AI';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (!this.apiKey) throw AppError.providerNotConfigured('OpenRouter');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    // Honour an upstream cancellation (job cancelled, request aborted).
    const onAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onAbort, { once: true });

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens,
      // Keep OpenRouter from silently substituting a different model.
      allow_fallbacks: false,
    };

    if (request.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.jsonSchema.name,
          strict: true,
          schema: request.jsonSchema.schema,
        },
      };
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': this.appUrl,
          'X-Title': this.appName,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      throw new AppError(
        aborted ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
        aborted
          ? `OpenRouter request timed out after ${this.timeoutMs}ms`
          : 'OpenRouter request failed',
        { cause, retryable: true },
      );
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onAbort);
    }

    const text = await response.text();

    if (!response.ok) {
      throw this.toError(response, text);
    }

    let payload: OpenRouterResponse;
    try {
      payload = JSON.parse(text) as OpenRouterResponse;
    } catch (cause) {
      throw new AppError('PROVIDER_ERROR', 'OpenRouter returned a non-JSON response', {
        cause,
        retryable: true,
        details: { snippet: text.slice(0, 300) },
      });
    }

    if (payload.error) {
      throw new AppError(
        'PROVIDER_ERROR',
        `OpenRouter error: ${payload.error.message ?? 'unknown'}`,
        {
          retryable: true,
          details: payload.error,
        },
      );
    }

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new AppError('PROVIDER_ERROR', 'OpenRouter returned an empty completion', {
        retryable: true,
        details: { finishReason: payload.choices?.[0]?.finish_reason },
      });
    }

    // A response cut off at the token limit is almost always truncated JSON.
    // Left alone it surfaces as "not valid JSON", which sends whoever debugs it
    // looking for a schema bug instead of a budget that is too small — and it
    // is easy to hit, because reasoning models spend this same budget thinking
    // before they write anything.
    if (payload.choices?.[0]?.finish_reason === 'length') {
      throw new AppError(
        'PROVIDER_ERROR',
        `The model hit the ${request.maxOutputTokens}-token output limit before finishing its response.`,
        {
          retryable: true,
          details: {
            maxOutputTokens: request.maxOutputTokens,
            completionTokens: payload.usage?.completion_tokens,
            snippet: content.slice(-200),
          },
        },
      );
    }

    return {
      text: content,
      model: request.model,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
      providerRequestId: payload.id,
    };
  }

  /** Maps an HTTP failure onto the error taxonomy the router understands. */
  private toError(response: Response, body: string): AppError {
    const snippet = body.slice(0, 400);

    if (response.status === 401 || response.status === 403) {
      return new AppError('PROVIDER_NOT_CONFIGURED', 'OpenRouter rejected the API key.', {
        retryable: false,
        details: { status: response.status, snippet },
      });
    }
    if (response.status === 402) {
      return new AppError(
        'AI_BUDGET_EXCEEDED',
        'OpenRouter reports insufficient credit for this request.',
        {
          retryable: false,
          details: { snippet },
        },
      );
    }
    if (response.status === 404) {
      return new AppError(
        'PROVIDER_UNAVAILABLE',
        'The requested model is not available on OpenRouter.',
        {
          retryable: false,
          details: { snippet },
        },
      );
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      return new AppError('PROVIDER_RATE_LIMITED', 'OpenRouter rate limit reached.', {
        retryable: true,
        retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 5_000,
        details: { snippet },
      });
    }
    if (response.status >= 500) {
      return new AppError(
        'PROVIDER_UNAVAILABLE',
        `OpenRouter is unavailable (HTTP ${response.status}).`,
        {
          retryable: true,
          details: { snippet },
        },
      );
    }
    return new AppError(
      'PROVIDER_ERROR',
      `OpenRouter request failed with HTTP ${response.status}.`,
      {
        retryable: false,
        details: { snippet },
      },
    );
  }
}
