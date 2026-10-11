/**
 * Inbound email payloads.
 *
 * Inbound-parse providers agree on the idea and not on the field names. This
 * reads the handful of fields reply capture needs from the common shapes —
 * Postmark (`From`, `To`, `TextBody`, `MessageID`), Mailgun (`sender`,
 * `recipient`, `stripped-text`, `Message-Id`), SendGrid (`from`, `to`, `text`)
 * — and from a plain `{ from, to, text, messageId }` for anything else.
 */

export interface InboundEmail {
  readonly from: string;
  /** Every recipient address, joined; the reply address is searched for in it. */
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly messageId: string;
}

function pick(source: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

export function parseInboundEmail(payload: unknown): InboundEmail | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const source = payload as Record<string, unknown>;

  const from = pick(source, ['From', 'from', 'sender', 'Sender']);
  // The envelope recipient first: it survives a reply that was BCC'd or forwarded.
  const to = [
    pick(source, ['OriginalRecipient', 'recipient', 'envelope_to']),
    pick(source, ['To', 'to']),
    pick(source, ['Cc', 'cc']),
  ]
    .filter(Boolean)
    .join(', ');
  const text = pick(source, [
    'StrippedTextReply',
    'stripped-text',
    'TextBody',
    'body-plain',
    'text',
  ]);
  const messageId = pick(source, ['MessageID', 'Message-Id', 'message-id', 'messageId']);

  // Without an id there is nothing to make a re-delivery idempotent on.
  if (!from || !to || !text || !messageId) return null;

  return {
    from: from.slice(0, 320),
    to: to.slice(0, 2_000),
    subject: (pick(source, ['Subject', 'subject']) ?? '').slice(0, 300),
    text,
    messageId: messageId.slice(0, 300),
  };
}
