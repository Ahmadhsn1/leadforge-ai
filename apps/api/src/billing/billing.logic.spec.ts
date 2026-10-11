import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  entitledPlan,
  isPaddleEvent,
  isPaddleSubscription,
  planForPrice,
  verifyPaddleSignature,
} from './billing.logic';

const SECRET = 'pdl_ntfset_test_secret';
const NOW = 1_800_000_000;

function sign(body: string, timestamp: number, secret = SECRET): string {
  const h1 = createHmac('sha256', secret).update(`${timestamp}:${body}`).digest('hex');
  return `ts=${timestamp};h1=${h1}`;
}

describe('verifyPaddleSignature', () => {
  const body = JSON.stringify({ event_id: 'evt_1', event_type: 'subscription.updated' });

  it('accepts a correctly signed, fresh payload', () => {
    expect(verifyPaddleSignature(body, sign(body, NOW), SECRET, NOW)).toEqual({ valid: true });
  });

  it('rejects a body that was altered after signing', () => {
    const verdict = verifyPaddleSignature(`${body} `, sign(body, NOW), SECRET, NOW);
    expect(verdict).toEqual({ valid: false, reason: 'signature mismatch' });
  });

  it('rejects a signature made with a different secret', () => {
    const verdict = verifyPaddleSignature(body, sign(body, NOW, 'another-secret'), SECRET, NOW);
    expect(verdict.valid).toBe(false);
  });

  it('rejects a replayed payload whose timestamp is too old', () => {
    const verdict = verifyPaddleSignature(body, sign(body, NOW - 3_600), SECRET, NOW);
    expect(verdict).toEqual({ valid: false, reason: 'timestamp outside tolerance' });
  });

  it('rejects a missing or malformed header without throwing', () => {
    expect(verifyPaddleSignature(body, undefined, SECRET, NOW).valid).toBe(false);
    expect(verifyPaddleSignature(body, 'nonsense', SECRET, NOW).valid).toBe(false);
    expect(verifyPaddleSignature(body, `ts=${NOW};h1=zz`, SECRET, NOW).valid).toBe(false);
    expect(verifyPaddleSignature(body, 'ts=abc;h1=00', SECRET, NOW).valid).toBe(false);
  });
});

describe('planForPrice', () => {
  const prices = { starter: 'pri_s', growth: 'pri_g', agency: 'pri_a' };

  it('maps each configured price to its plan', () => {
    expect(planForPrice('pri_s', prices)).toBe('starter');
    expect(planForPrice('pri_g', prices)).toBe('growth');
    expect(planForPrice('pri_a', prices)).toBe('agency');
  });

  it('returns null for an unknown or absent price', () => {
    expect(planForPrice('pri_other', prices)).toBeNull();
    expect(planForPrice(undefined, prices)).toBeNull();
  });

  it('never matches an unconfigured plan against an absent price', () => {
    expect(planForPrice(undefined, { starter: undefined, growth: 'x', agency: 'y' })).toBeNull();
  });
});

describe('entitledPlan', () => {
  it('grants the subscribed plan while the subscription is in good standing', () => {
    expect(entitledPlan('active', 'growth')).toBe('growth');
    expect(entitledPlan('trialing', 'starter')).toBe('starter');
  });

  it('keeps access while a failed renewal is still being retried', () => {
    expect(entitledPlan('past_due', 'agency')).toBe('agency');
  });

  it('returns the workspace to free when the subscription ends or pauses', () => {
    expect(entitledPlan('canceled', 'growth')).toBe('free');
    expect(entitledPlan('paused', 'growth')).toBe('free');
  });

  it('does not grant a paid plan for a price it cannot identify', () => {
    expect(entitledPlan('active', null)).toBe('free');
  });
});

describe('payload guards', () => {
  it('recognises a well-formed event envelope', () => {
    expect(
      isPaddleEvent({ event_id: 'e', event_type: 't', occurred_at: '2026-10-11', data: {} }),
    ).toBe(true);
    expect(isPaddleEvent({ event_id: 'e' })).toBe(false);
    expect(isPaddleEvent(null)).toBe(false);
  });

  it('recognises a subscription entity', () => {
    expect(isPaddleSubscription({ id: 'sub_1', status: 'active', customer_id: 'ctm_1' })).toBe(
      true,
    );
    expect(isPaddleSubscription({ id: 'sub_1' })).toBe(false);
  });
});
