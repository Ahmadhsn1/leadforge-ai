import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Reply addresses for inbound email capture.
 *
 * An outgoing email's Reply-To is `r+<draftId>.<mac>@<inbound domain>`. When
 * the reply comes back through the inbound-mail provider, the address itself
 * says which message it answers — and therefore which workspace and lead —
 * without trusting the sender's From line, which anyone can forge and which
 * the same business may share across several workspaces.
 *
 * The MAC is truncated to keep the local part under the 64-character limit.
 * 80 bits is ample here: a forgery only files a message under a lead, and the
 * endpoint is already behind a shared secret.
 */

const PURPOSE = 'leadforge:reply-address:v1';
const MAC_BYTES = 10;

function mac(draftId: string, secret: string): Buffer {
  return createHmac('sha256', secret)
    .update(`${PURPOSE}:${draftId}`)
    .digest()
    .subarray(0, MAC_BYTES);
}

export function buildReplyAddress(draftId: string, domain: string, secret: string): string {
  return `r+${draftId}.${mac(draftId, secret).toString('hex')}@${domain}`;
}

/** @returns the draft id a reply address names, or null if it is not one of ours. */
export function parseReplyAddress(address: string | undefined, secret: string): string | null {
  if (!address) return null;

  const match = /(?:^|[<\s,;])r\+([a-z0-9]{10,40})\.([0-9a-f]{20})@/i.exec(address);
  if (!match?.[1] || !match[2]) return null;

  // Ids are lowercase; some mail systems upper-case an address in transit.
  const draftId = match[1].toLowerCase();
  const received = Buffer.from(match[2].toLowerCase(), 'hex');
  const expected = mac(draftId, secret);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  return draftId;
}

/**
 * Trims the quoted original from a reply, so the thread shows what the person
 * wrote rather than a copy of our own message underneath it. Conservative: if
 * nothing looks like a quote marker, the text is returned as it came.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cut = lines.findIndex(
    (line) =>
      /^On .{5,200} wrote:\s*$/i.test(line.trim()) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim()) ||
      /^From:\s.+/i.test(line.trim()) ||
      /^_{10,}$/.test(line.trim()),
  );

  const kept = (cut > 0 ? lines.slice(0, cut) : lines).filter((line) => !/^\s*>/.test(line));
  const result = kept.join('\n').trim();
  return result.length > 0 ? result : text.trim();
}
