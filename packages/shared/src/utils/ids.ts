import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/** Prefixed, sortable-ish opaque identifier for external use. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export function newRequestId(): string {
  return `req_${randomBytes(12).toString('hex')}`;
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Constant-time comparison for tokens/signatures. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Deterministic idempotency key. The same logical unit of work always produces
 * the same key, so a retried job is a no-op rather than a duplicate.
 */
export function idempotencyKey(...parts: (string | number | null | undefined)[]): string {
  const material = parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('|');
  return sha256(material).slice(0, 40);
}
