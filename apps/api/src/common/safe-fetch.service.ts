import { Injectable } from '@nestjs/common';
import * as dns from 'node:dns/promises';
import {
  AppError,
  canonicalizeUrl,
  isObviouslyPrivateHost,
  isPrivateIpv4,
  isPrivateIpv6,
} from '@leadforge/shared';
import { env } from '@leadforge/config';
import { logger } from './logger';

/**
 * SSRF-safe outbound fetcher (docs/13 safety requirements).
 *
 * A lead's website URL is attacker-controlled data: it arrives from a public
 * directory listing that anyone can edit. Fetching it naively would let a
 * prospect point us at cloud metadata or an internal service.
 *
 * Every hop is validated:
 *   - scheme restricted to http/https
 *   - hostname resolved and every returned address checked against private ranges
 *   - redirects followed manually so each new location is re-validated
 *   - hard timeout, byte cap and redirect cap
 */

export interface SafeFetchResult {
  readonly ok: boolean;
  readonly status: number;
  readonly finalUrl: string;
  readonly redirectCount: number;
  readonly body: string;
  readonly truncated: boolean;
  readonly contentType: string | null;
  readonly responseTimeMs: number;
  readonly isHttps: boolean;
}

@Injectable()
export class SafeFetchService {
  /**
   * Fetches a URL with SSRF protection.
   * @throws AppError UNSAFE_URL when the target resolves inside a private range.
   */
  async fetch(inputUrl: string): Promise<SafeFetchResult> {
    const config = env();
    const startedAt = Date.now();

    let current = await this.validate(inputUrl);
    let redirectCount = 0;

    while (redirectCount <= config.FETCH_MAX_REDIRECTS) {
      const response = await this.request(current, config.FETCH_TIMEOUT_MS);

      const location = response.headers.get('location');
      if (isRedirect(response.status) && location) {
        redirectCount += 1;
        if (redirectCount > config.FETCH_MAX_REDIRECTS) {
          throw new AppError(
            'UNSAFE_URL',
            `Too many redirects (more than ${config.FETCH_MAX_REDIRECTS}).`,
            {
              retryable: false,
            },
          );
        }
        // Each hop is re-validated: a safe URL can redirect to an unsafe one.
        const next = new URL(location, current).toString();
        current = await this.validate(next);
        // Release the body so the socket is returned to the pool.
        await response.body?.cancel().catch(() => undefined);
        continue;
      }

      const { text, truncated } = await this.readCapped(response, config.FETCH_MAX_BYTES);

      return {
        ok: response.ok,
        status: response.status,
        finalUrl: current,
        redirectCount,
        body: text,
        truncated,
        contentType: response.headers.get('content-type'),
        responseTimeMs: Date.now() - startedAt,
        isHttps: current.startsWith('https://'),
      };
    }

    throw new AppError('UNSAFE_URL', 'Redirect limit exceeded.', { retryable: false });
  }

  /**
   * Validates a URL and confirms every resolved address is public.
   * @returns the canonical URL to fetch.
   */
  async validate(inputUrl: string): Promise<string> {
    const canonical = canonicalizeUrl(inputUrl);
    if (!canonical.valid || !canonical.url || !canonical.hostname) {
      throw new AppError('UNSAFE_URL', `"${inputUrl}" is not a usable http(s) URL.`, {
        retryable: false,
      });
    }

    if (env().ALLOW_PRIVATE_NETWORK_FETCH) return canonical.url;

    if (isObviouslyPrivateHost(canonical.hostname)) {
      throw new AppError(
        'UNSAFE_URL',
        `Refusing to fetch a private or local address (${canonical.hostname}).`,
        {
          retryable: false,
        },
      );
    }

    // DNS rebinding defence: check what the name actually resolves to, not
    // just what it looks like.
    let addresses: { address: string; family: number }[];
    try {
      addresses = await dns.lookup(canonical.hostname, { all: true, verbatim: true });
    } catch {
      throw new AppError('PROVIDER_UNAVAILABLE', `Could not resolve ${canonical.hostname}.`, {
        retryable: true,
      });
    }

    if (addresses.length === 0) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `${canonical.hostname} resolved to no addresses.`,
        {
          retryable: true,
        },
      );
    }

    for (const { address, family } of addresses) {
      const isPrivate = family === 6 ? isPrivateIpv6(address) : isPrivateIpv4(address);
      if (isPrivate) {
        logger('safe-fetch').warn(
          { hostname: canonical.hostname, address },
          'blocked fetch: host resolves to a private address',
        );
        throw new AppError('UNSAFE_URL', `${canonical.hostname} resolves to a private address.`, {
          retryable: false,
        });
      }
    }

    return canonical.url;
  }

  private async request(url: string, timeoutMs: number): Promise<Response> {
    try {
      return await fetch(url, {
        // Manual redirect handling; `follow` would bypass per-hop validation.
        redirect: 'manual',
        headers: {
          'User-Agent': 'LeadForgeBot/1.0 (+https://leadforge.ai/bot; business verification)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-GB,en;q=0.9',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        timedOut
          ? `The site did not respond within ${timeoutMs}ms.`
          : 'The site could not be reached.',
        { cause: error, retryable: true },
      );
    }
  }

  /** Reads at most `maxBytes`, so a huge or endless response cannot exhaust memory. */
  private async readCapped(
    response: Response,
    maxBytes: number,
  ): Promise<{ text: string; truncated: boolean }> {
    if (!response.body) return { text: '', truncated: false };

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          chunks.push(value.subarray(0, Math.max(0, value.byteLength - (total - maxBytes))));
          truncated = true;
          break;
        }
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }

    const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    return { text: buffer.toString('utf8'), truncated };
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
