import { describe, expect, it } from 'vitest';
import { MessageValidator } from './message-validator';

const validator = new MessageValidator();

const context = {
  businessName: "Mario's Italian Kitchen",
  channel: 'whatsapp' as const,
  evidenceStatements: [
    'Rated 4.6 out of 5 across 412 public reviews.',
    'No dedicated website detected on the business listing or by resolution.',
    'A valid GB phone number is on record.',
  ],
  senderName: 'Alex',
};

const GOOD_MESSAGE =
  "Hi — I noticed Mario's has 412 reviews on Google but no website to send that demand to. " +
  'I build simple booking sites for restaurants in Manchester. Would you be open to a quick chat this week?';

describe('MessageValidator', () => {
  it('passes a grounded, specific message', () => {
    const result = validator.validate(GOOD_MESSAGE, context);
    expect(result.status).toBe('passed');
    expect(result.issues).toHaveLength(0);
  });

  it('rejects a message that never names the business', () => {
    const result = validator.validate(
      'Hi there, I build websites for local restaurants. Would you be open to a chat this week?',
      context,
    );
    expect(result.status).toBe('failed');
    expect(result.issues.some((issue) => issue.code === 'missing_business_name')).toBe(true);
  });

  it('accepts a shortened form of the business name', () => {
    const result = validator.validate(
      "Hi — Mario's came up in my search for Manchester restaurants without a website. Fancy a quick chat?",
      context,
    );
    expect(result.issues.some((issue) => issue.code === 'missing_business_name')).toBe(false);
  });

  it('rejects invented statistics', () => {
    const result = validator.validate(
      "Hi Mario's — restaurants like yours lose 40% of bookings without a website. Can we chat?",
      context,
    );
    expect(result.status).toBe('failed');
    expect(result.issues.some((issue) => issue.code === 'unsupported_statistic')).toBe(true);
  });

  it('accepts a statistic that appears in the evidence', () => {
    const result = validator.validate(
      "Hi Mario's — 412 reviews and no website to send that traffic to. Worth a quick chat?",
      context,
    );
    expect(result.issues.some((issue) => issue.code === 'unsupported_statistic')).toBe(false);
  });

  it('rejects guaranteed outcomes', () => {
    const result = validator.validate(
      "Hi Mario's — I guarantee a website will double your bookings. Shall we talk?",
      context,
    );
    expect(result.status).toBe('failed');
    expect(result.issues.some((issue) => issue.code === 'prohibited_claim')).toBe(true);
  });

  it('rejects fabricated urgency', () => {
    const result = validator.validate(
      "Hi Mario's — last chance to get a website built this month. Interested?",
      context,
    );
    expect(result.status).toBe('failed');
    expect(result.issues.some((issue) => issue.code === 'prohibited_claim')).toBe(true);
  });

  it('rejects pretending to be a customer', () => {
    const result = validator.validate(
      "Hi Mario's — as a happy customer of yours, I noticed you have no website. Can I help?",
      context,
    );
    expect(result.status).toBe('failed');
    expect(result.issues.some((issue) => issue.code === 'prohibited_claim')).toBe(true);
  });

  it('rejects unfilled placeholders', () => {
    const result = validator.validate(
      'Hi {{business_name}} — I noticed you have no website. Can we chat?',
      context,
    );
    expect(result.status).toBe('failed');
    expect(result.issues.some((issue) => issue.code === 'unfilled_placeholder')).toBe(true);
  });

  it('rejects a message over the channel limit', () => {
    const result = validator.validate(`Hi Mario's — ${'x'.repeat(1000)}`, context);
    expect(result.status).toBe('failed');
    expect(result.issues.some((issue) => issue.code === 'too_long')).toBe(true);
  });

  it('warns about templated openings', () => {
    const result = validator.validate(
      "Hi Mario's, I hope this message finds you well. I noticed you have no website. Fancy a chat?",
      context,
    );
    expect(result.status).toBe('warned');
    expect(result.issues.some((issue) => issue.code === 'filler_opening')).toBe(true);
  });

  it('warns about generic flattery', () => {
    const result = validator.validate(
      "Hi Mario's — I love what you're doing. You have no website though. Want to chat?",
      context,
    );
    expect(result.issues.some((issue) => issue.code === 'generic_flattery')).toBe(true);
  });

  it('warns when there is no ask at all', () => {
    const result = validator.validate(
      "Hi Mario's — I noticed you have no website. I build them for restaurants in Manchester.",
      context,
    );
    expect(result.issues.some((issue) => issue.code === 'no_cta')).toBe(true);
  });

  it('warns about multiple competing asks', () => {
    const result = validator.validate(
      "Hi Mario's — no website, I noticed. Want to see some examples? Shall I call you Tuesday? Can you send your menu?",
      context,
    );
    expect(result.issues.some((issue) => issue.code === 'multiple_ctas')).toBe(true);
  });

  it('does not treat a time or day as a statistic', () => {
    const result = validator.validate(
      "Hi Mario's — no website found. Free for a 15 minute call on Thursday at 2pm?",
      context,
    );
    expect(result.issues.some((issue) => issue.code === 'unsupported_statistic')).toBe(false);
  });

  it('merges AI-reported issues without duplicating them', () => {
    const deterministic = validator.validate(GOOD_MESSAGE, context);
    const merged = validator.merge(deterministic, [
      { severity: 'error', code: 'overstated', detail: 'Claims more than the evidence supports.' },
      { severity: 'warning', code: 'no_cta', detail: 'Duplicate-ish but distinct detail.' },
    ]);

    expect(merged.status).toBe('failed');
    expect(merged.issues).toHaveLength(2);
  });

  it('applies the email channel limit rather than the WhatsApp one', () => {
    const longButValidEmail = `Hi Mario's,\n\n${'Detail about the website gap. '.repeat(40)}\n\nWorth a quick chat?`;
    const asEmail = validator.validate(longButValidEmail, { ...context, channel: 'email' });
    const asWhatsApp = validator.validate(longButValidEmail, context);

    expect(asWhatsApp.issues.some((issue) => issue.code === 'too_long')).toBe(true);
    expect(asEmail.issues.some((issue) => issue.code === 'too_long')).toBe(false);
  });
});
