import { describe, expect, it } from 'vitest';
import { createUnsubscribeToken, readUnsubscribeToken } from './unsubscribe-token';

const SECRET = 'a-test-secret-of-reasonable-length';

describe('unsubscribe tokens', () => {
  it('round-trips the workspace and lead it was issued for', () => {
    const token = createUnsubscribeToken('org_1', 'lead_1', SECRET);
    expect(readUnsubscribeToken(token, SECRET)).toEqual({
      organizationId: 'org_1',
      leadId: 'lead_1',
    });
  });

  it('is URL-safe without encoding', () => {
    const token = createUnsubscribeToken('org_1', 'lead_1', SECRET);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it('rejects a token whose payload was swapped for another lead', () => {
    const [, signature] = createUnsubscribeToken('org_1', 'lead_1', SECRET).split('.');
    const forgedPayload = Buffer.from('org_1:lead_2', 'utf8').toString('base64url');
    expect(readUnsubscribeToken(`${forgedPayload}.${signature}`, SECRET)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = createUnsubscribeToken('org_1', 'lead_1', 'some-other-secret');
    expect(readUnsubscribeToken(token, SECRET)).toBeNull();
  });

  it('rejects malformed input without throwing', () => {
    for (const bad of [undefined, '', 'nodot', 'a.b.c', '.', 'x.', '.y', 'x'.repeat(500)]) {
      expect(readUnsubscribeToken(bad, SECRET)).toBeNull();
    }
  });
});
