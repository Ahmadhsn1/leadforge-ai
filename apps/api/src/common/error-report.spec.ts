import { describe, expect, it } from 'vitest';
import { formatReport, shouldReport } from './error-report';

describe('shouldReport', () => {
  it('sends the first report and stays quiet about repeats for five minutes', () => {
    const seen = new Map<string, number>();
    expect(shouldReport('http:POST /campaigns', 0, seen)).toBe(true);
    expect(shouldReport('http:POST /campaigns', 60_000, seen)).toBe(false);
    expect(shouldReport('http:POST /campaigns', 4 * 60_000, seen)).toBe(false);
    expect(shouldReport('http:POST /campaigns', 5 * 60_000 + 1, seen)).toBe(true);
  });

  it('treats a different operation as a different problem', () => {
    const seen = new Map<string, number>();
    expect(shouldReport('http:POST /campaigns', 0, seen)).toBe(true);
    expect(shouldReport('http:GET /leads', 1, seen)).toBe(true);
  });

  it('does not grow without bound', () => {
    const seen = new Map<string, number>();
    for (let i = 0; i < 600; i += 1) shouldReport(`key-${i}`, 0, seen);
    shouldReport('late', 10 * 60_000, seen);
    expect(seen.size).toBeLessThan(600);
  });
});

describe('formatReport', () => {
  it('says what failed, where, and how to find it', () => {
    const text = formatReport(
      { source: 'http', operation: 'POST /campaigns', message: 'boom', requestId: 'req_123' },
      'production',
    );
    expect(text).toContain('production');
    expect(text).toContain('POST /campaigns: boom');
    expect(text).toContain('req_123');
  });

  it('truncates a long message and omits a missing request id', () => {
    const text = formatReport(
      { source: 'leadforge.outreach', operation: 'outreach.send', message: 'x'.repeat(2_000) },
      'production',
    );
    expect(text.length).toBeLessThan(450);
    expect(text).not.toContain('Request id');
  });
});
