import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Unsubscribe tokens.
 *
 * Stateless and signed rather than stored: the link has to keep working for as
 * long as the email sits in someone's inbox, and a recipient must be able to
 * opt out without an account. The token names one lead in one workspace and
 * can do exactly one thing — add that lead to the do-not-contact list — so
 * there is nothing worth stealing in it and no expiry to get wrong.
 */

const PURPOSE = 'leadforge:unsubscribe:v1';

function sign(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${PURPOSE}:${payload}`).digest();
}

export function createUnsubscribeToken(
  organizationId: string,
  leadId: string,
  secret: string,
): string {
  const payload = Buffer.from(`${organizationId}:${leadId}`, 'utf8').toString('base64url');
  return `${payload}.${sign(payload, secret).toString('base64url')}`;
}

export function readUnsubscribeToken(
  token: unknown,
  secret: string,
): { organizationId: string; leadId: string } | null {
  // Checked at runtime, not just in the signature: a repeated query parameter
  // arrives as an array, whatever the caller's types claim.
  if (typeof token !== 'string' || token.length === 0 || token.length > 400) return null;

  const [payload, signature, ...rest] = token.split('.');
  if (!payload || !signature || rest.length > 0) return null;

  const expected = sign(payload, secret);
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  const [organizationId, leadId, ...extra] = Buffer.from(payload, 'base64url')
    .toString('utf8')
    .split(':');
  if (!organizationId || !leadId || extra.length > 0) return null;

  return { organizationId, leadId };
}
