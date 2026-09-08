import type { Channel } from '../domain/enums';

export interface ChannelProfile {
  readonly channel: Channel;
  /** Hard cap enforced by message validation. */
  readonly maxLength: number;
  /** Soft target used in prompts and in the "too long" warning. */
  readonly targetLength: number;
  readonly supportsSubject: boolean;
  readonly supportsDeliveryReceipts: boolean;
  readonly styleGuidance: string;
  /** Identifier the recipient must have for this channel to be usable. */
  readonly recipientField: 'phone' | 'email' | 'instagram';
}

/** Channel behaviour from docs/21-PERSONALIZATION-ENGINE.md. */
export const CHANNEL_PROFILES: Readonly<Record<Channel, ChannelProfile>> = {
  whatsapp: {
    channel: 'whatsapp',
    maxLength: 900,
    targetLength: 480,
    supportsSubject: false,
    supportsDeliveryReceipts: true,
    styleGuidance: 'Conversational, concise and direct. No greetings longer than one line.',
    recipientField: 'phone',
  },
  instagram: {
    channel: 'instagram',
    maxLength: 900,
    targetLength: 320,
    supportsSubject: false,
    supportsDeliveryReceipts: false,
    styleGuidance: 'Short, light and natural. Reads like a person, not a brochure.',
    recipientField: 'instagram',
  },
  manual: {
    channel: 'manual',
    // WhatsApp is the usual destination for a manual send, so its limit applies.
    maxLength: 900,
    targetLength: 420,
    supportsSubject: false,
    supportsDeliveryReceipts: false,
    styleGuidance:
      'Conversational and direct. This is sent by a person from their own account, so it should read exactly like something they would type.',
    recipientField: 'phone',
  },
  email: {
    channel: 'email',
    maxLength: 2200,
    targetLength: 900,
    supportsSubject: true,
    supportsDeliveryReceipts: false,
    styleGuidance: 'Structured and context-rich, with a clear subject and a single CTA.',
    recipientField: 'email',
  },
};

/**
 * Phrases that must never appear in an outbound message
 * (docs/18 message-generation constraints).
 */
export const PROHIBITED_MESSAGE_PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /\bguarantee(d|s)?\b/i, reason: 'Guaranteed-outcome claim' },
  { pattern: /\b(100%|risk[- ]free)\b/i, reason: 'Absolute or risk-free claim' },
  {
    pattern: /\byou (will|are going to) (make|earn|get) [^.!?]*\b(\d|money|revenue)/i,
    reason: 'Promised revenue outcome',
  },
  {
    pattern: /\blast chance\b|\bact now\b|\bonly \d+ (spots?|slots?) left\b/i,
    reason: 'Fabricated urgency',
  },
  {
    pattern: /\bas a (happy )?customer of yours\b|\bi (ordered|bought) from you\b/i,
    reason: 'Pretending to be a customer',
  },
  { pattern: /\byour (revenue|sales) (is|are) down\b/i, reason: 'Unsupported performance claim' },
  { pattern: /\blosing [£$€]?\d/i, reason: 'Unsupported revenue-loss claim' },
];

/** Words that indicate a placeholder the generator failed to fill. */
export const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /\{\{[^}]*\}\}/,
  /\[[A-Z_ ]{3,}\]/,
  /\bYOUR[_ ]BUSINESS\b/i,
  /\bLOREM IPSUM\b/i,
];
