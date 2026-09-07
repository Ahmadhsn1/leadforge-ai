import type { ErrorCode } from '@leadforge/shared';

/**
 * Typed fetch client.
 *
 * The browser always talks to the Next.js origin at /api/*, which proxies to
 * the API service and forwards the httpOnly session cookie. No token ever
 * reaches client JavaScript and there is no cross-origin cookie handling.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK' | 'UNKNOWN';
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(
    status: number,
    code: ErrorCode | 'NETWORK' | 'UNKNOWN',
    message: string,
    details?: unknown,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** Copy suitable for showing directly to a user. */
  get userMessage(): string {
    if (this.code === 'NETWORK')
      return 'Could not reach the server. Check your connection and try again.';
    if (this.status === 401) return 'Your session has expired. Sign in again to continue.';
    if (this.status === 403) return 'You do not have permission to do that.';
    if (this.status === 429) return 'Too many requests. Wait a moment and try again.';
    if (this.code === 'PROVIDER_NOT_CONFIGURED') return this.message;
    if (this.status >= 500)
      return 'The server ran into a problem. This has been logged — try again shortly.';
    return this.message;
  }
}

export const API_BASE = '/api';

/** Scalar query-string parameters; undefined/null/'' entries are dropped. */
export type QueryParams = Readonly<Record<string, string | number | boolean | undefined | null>>;

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: QueryParams;
  /** Absolute base override, used by server components calling the API directly. */
  baseUrl?: string;
}

function buildUrl(path: string, query?: RequestOptions['query'], baseUrl = API_BASE): string {
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, baseUrl, headers, ...rest } = options;
  const url = buildUrl(path, query, baseUrl);

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network request failed', undefined);
  }

  const requestId = response.headers.get('x-request-id') ?? undefined;

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: { code: 'UNKNOWN', message: text.slice(0, 300) } };
    }
  }

  if (!response.ok) {
    const err = (
      payload as { error?: { code?: ErrorCode; message?: string; details?: unknown } } | null
    )?.error;
    throw new ApiError(
      response.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? `Request failed with status ${response.status}`,
      err?.details,
      requestId,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'DELETE' }),
};
