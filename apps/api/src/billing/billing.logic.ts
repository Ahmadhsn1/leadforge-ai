import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Plan } from '@leadforge/shared';

/**
 * The parts of billing that are pure decisions: is this webhook genuine, which
 * plan does this price mean, and what should the workspace be entitled to.
 * Kept free of I/O so each rule can be tested on its own.
 */

/** How far a webhook timestamp may be from now before it is treated as a replay. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureVerdict = { valid: true } | { valid: false; reason: string };

/**
 * Verifies a `Paddle-Signature` header (`ts=<unix>;h1=<hex hmac>`).
 *
 * The HMAC covers `<ts>:<raw body>`, so the bytes must be exactly what Paddle
 * sent — a re-serialised body will not match. The timestamp is checked too, so
 * a captured request cannot be replayed later.
 */
export function verifyPaddleSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SignatureVerdict {
  if (!header) return { valid: false, reason: 'missing signature header' };

  const parts = new Map<string, string>();
  for (const segment of header.split(';')) {
    const index = segment.indexOf('=');
    if (index > 0) parts.set(segment.slice(0, index).trim(), segment.slice(index + 1).trim());
  }

  const timestamp = parts.get('ts');
  const signature = parts.get('h1');
  if (!timestamp || !signature) return { valid: false, reason: 'malformed signature header' };

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return { valid: false, reason: 'malformed timestamp' };
  if (Math.abs(nowSeconds - sentAt) > SIGNATURE_TOLERANCE_SECONDS) {
    return { valid: false, reason: 'timestamp outside tolerance' };
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}:${rawBody}`).digest();
  const received = Buffer.from(signature, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return { valid: false, reason: 'signature mismatch' };
  }
  return { valid: true };
}

export type PaidPlan = Exclude<Plan, 'free'>;
export type PriceMap = Readonly<Record<PaidPlan, string | undefined>>;

/** The plan a provider price id stands for, or null for a price we do not sell. */
export function planForPrice(priceId: string | undefined, prices: PriceMap): PaidPlan | null {
  if (!priceId) return null;
  for (const plan of ['starter', 'growth', 'agency'] as const) {
    if (prices[plan] === priceId) return plan;
  }
  return null;
}

/**
 * Provider statuses under which the customer keeps what they paid for.
 * `past_due` is included on purpose: the provider is still retrying the card,
 * and cutting someone off mid-campaign over a declined renewal loses customers
 * who would have paid a day later. The provider cancels if retries run out.
 */
const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due']);

/** The plan a workspace should be on, given its subscription's state. */
export function entitledPlan(status: string, subscribedPlan: PaidPlan | null): Plan {
  if (!subscribedPlan) return 'free';
  return ENTITLED_STATUSES.has(status) ? subscribedPlan : 'free';
}

/** The subset of a Paddle subscription entity that billing acts on. */
export interface PaddleSubscription {
  readonly id: string;
  readonly status: string;
  readonly customer_id: string;
  readonly custom_data?: { organizationId?: unknown } | null;
  readonly items?: readonly { price?: { id?: string } | null }[];
  readonly current_billing_period?: { starts_at?: string; ends_at?: string } | null;
  readonly scheduled_change?: { action?: string; effective_at?: string } | null;
}

export interface PaddleEvent {
  readonly event_id: string;
  readonly event_type: string;
  readonly occurred_at: string;
  readonly data: unknown;
}

/** Narrowing guard for the envelope; the payload is untrusted until this passes. */
export function isPaddleEvent(value: unknown): value is PaddleEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.event_id === 'string' &&
    typeof event.event_type === 'string' &&
    typeof event.occurred_at === 'string' &&
    typeof event.data === 'object' &&
    event.data !== null
  );
}

export function isPaddleSubscription(value: unknown): value is PaddleSubscription {
  if (typeof value !== 'object' || value === null) return false;
  const subscription = value as Record<string, unknown>;
  return (
    typeof subscription.id === 'string' &&
    typeof subscription.status === 'string' &&
    typeof subscription.customer_id === 'string'
  );
}
