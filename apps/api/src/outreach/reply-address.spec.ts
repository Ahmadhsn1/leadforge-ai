import { describe, expect, it } from 'vitest';
import { buildReplyAddress, parseReplyAddress, stripQuotedReply } from './reply-address';

const SECRET = 'a-test-secret-of-reasonable-length';
const DRAFT = 'cmv2xir2u0001vd58ogauqz1o';

describe('reply addresses', () => {
  it('round-trips the draft id', () => {
    const address = buildReplyAddress(DRAFT, 'reply.example.com', SECRET);
    expect(parseReplyAddress(address, SECRET)).toBe(DRAFT);
  });

  it('fits within the 64-character local-part limit', () => {
    const [local] = buildReplyAddress(DRAFT, 'reply.example.com', SECRET).split('@');
    expect((local ?? '').length).toBeLessThanOrEqual(64);
  });

  it('is found inside a display-name form and a recipient list', () => {
    const address = buildReplyAddress(DRAFT, 'reply.example.com', SECRET);
    expect(parseReplyAddress(`"Alex" <${address}>`, SECRET)).toBe(DRAFT);
    expect(parseReplyAddress(`someone@else.com, ${address}`, SECRET)).toBe(DRAFT);
    // Some mail systems upper-case addresses in transit.
    expect(parseReplyAddress(address.toUpperCase(), SECRET)).toBe(DRAFT);
  });

  it('rejects an address whose draft id was changed', () => {
    const address = buildReplyAddress(DRAFT, 'reply.example.com', SECRET);
    expect(parseReplyAddress(address.replace(DRAFT, `${DRAFT.slice(0, -1)}x`), SECRET)).toBeNull();
  });

  it('rejects an address made with another secret, and ordinary addresses', () => {
    const forged = buildReplyAddress(DRAFT, 'reply.example.com', 'another-secret');
    expect(parseReplyAddress(forged, SECRET)).toBeNull();
    expect(parseReplyAddress('owner@business.com', SECRET)).toBeNull();
    expect(parseReplyAddress(undefined, SECRET)).toBeNull();
  });
});

describe('stripQuotedReply', () => {
  it('keeps only what the person wrote above a Gmail-style quote', () => {
    const text =
      'Yes, call me Thursday.\n\nOn Mon, 5 Oct 2026 at 10:00, Alex <a@b.com> wrote:\n> Hi there\n> Worth a chat?';
    expect(stripQuotedReply(text)).toBe('Yes, call me Thursday.');
  });

  it('cuts at an Outlook-style header block', () => {
    const text =
      'Not interested, thanks.\r\n\r\nFrom: Alex <a@b.com>\r\nSent: Monday\r\nSubject: Hi';
    expect(stripQuotedReply(text)).toBe('Not interested, thanks.');
  });

  it('drops inline quoted lines', () => {
    expect(stripQuotedReply('> your question\nMy answer')).toBe('My answer');
  });

  it('returns the original when stripping would leave nothing', () => {
    expect(stripQuotedReply('> only a quote')).toBe('> only a quote');
  });

  it('leaves an ordinary message alone', () => {
    expect(stripQuotedReply('Sounds good.\nSpeak soon.')).toBe('Sounds good.\nSpeak soon.');
  });
});
