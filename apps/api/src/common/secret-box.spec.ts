import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret } from './secret-box';

const SECRET = 'deployment-secret-with-enough-entropy';

describe('secret box', () => {
  it('round-trips a value under the same secret and context', () => {
    const sealed = sealSecret('smtp-p@ssword ü', SECRET, 'org_1:email');
    expect(openSecret(sealed, SECRET, 'org_1:email')).toBe('smtp-p@ssword ü');
  });

  it('never stores the plaintext and never repeats a ciphertext', () => {
    const first = sealSecret('hunter2-hunter2', SECRET, 'org_1:email');
    const second = sealSecret('hunter2-hunter2', SECRET, 'org_1:email');
    expect(first).not.toContain('hunter2');
    expect(first).not.toBe(second);
  });

  it('will not open a value moved to another workspace', () => {
    const sealed = sealSecret('password', SECRET, 'org_1:email');
    expect(openSecret(sealed, SECRET, 'org_2:email')).toBeNull();
  });

  it('will not open under a different deployment secret', () => {
    const sealed = sealSecret('password', SECRET, 'org_1:email');
    expect(openSecret(sealed, 'a-different-deployment-secret', 'org_1:email')).toBeNull();
  });

  it('detects tampering instead of returning garbage', () => {
    const parts = sealSecret('password', SECRET, 'org_1:email').split('.');
    const body = Buffer.from(parts[3] ?? '', 'base64url');
    body[0] = (body[0] ?? 0) ^ 0xff;
    parts[3] = body.toString('base64url');
    expect(openSecret(parts.join('.'), SECRET, 'org_1:email')).toBeNull();
  });

  it('returns null for malformed input', () => {
    for (const bad of ['', 'v1', 'v2.a.b.c', 'v1.a.b', 'not-a-sealed-value']) {
      expect(openSecret(bad, SECRET, 'org_1:email')).toBeNull();
    }
  });
});
