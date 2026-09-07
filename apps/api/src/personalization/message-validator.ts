import { Injectable } from '@nestjs/common';
import {
  CHANNEL_PROFILES,
  PLACEHOLDER_PATTERNS,
  PROHIBITED_MESSAGE_PATTERNS,
  normalizeText,
  Channel,
  ValidationStatus,
} from '@leadforge/shared';

/**
 * Deterministic message validation (docs/21 quality gate).
 *
 * "Generated message is not automatically good because an LLM returned it."
 * These checks run on every draft regardless of which model wrote it, and they
 * cannot be talked out of a verdict the way a second model can.
 *
 * An AI cross-check runs alongside this (see PersonalizationService); this pass
 * is the one that must never be skipped.
 */

export interface ValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly detail: string;
}

export interface ValidationOutcome {
  readonly status: ValidationStatus;
  readonly issues: ValidationIssue[];
}

export interface ValidationContext {
  readonly businessName: string;
  readonly channel: Channel;
  /** Every statement the system can actually stand behind. */
  readonly evidenceStatements: readonly string[];
  readonly senderName?: string | null;
  readonly senderCompany?: string | null;
}

/** Numbers that are always legitimate in a message. */
const SAFE_NUMBER_PATTERNS = [
  /\b\d{1,2}\s*(min|minute|hour|day|week|month)s?\b/i,
  /\b(mon|tue|wed|thu|fri|sat|sun)/i,
  /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i,
  /\b(19|20)\d{2}\b/,
];

const GREETING_FILLER = [
  /i hope (this|you)('| a)?\s*(email |message )?(finds you well|are well|is doing well)/i,
  /hope you('re| are) (doing )?(well|good)/i,
  /i hope you don'?t mind me reaching out/i,
];

const GENERIC_FLATTERY = [
  /i (love|really like) what you('re| are) doing/i,
  /your (business|company|work) (is|looks) (amazing|incredible|fantastic|great)/i,
  /i'?ve been following (you|your)/i,
  /big fan of/i,
];

@Injectable()
export class MessageValidator {
  validate(body: string, context: ValidationContext): ValidationOutcome {
    const issues: ValidationIssue[] = [];
    const profile = CHANNEL_PROFILES[context.channel];
    const normalized = normalizeText(body);

    /* --- Hard rules: a message failing any of these cannot be sent. ------ */

    if (body.trim().length < 20) {
      issues.push({
        severity: 'error',
        code: 'too_short',
        detail: 'The message is too short to be meaningful.',
      });
    }

    if (body.length > profile.maxLength) {
      issues.push({
        severity: 'error',
        code: 'too_long',
        detail: `${body.length} characters exceeds the ${profile.maxLength} limit for ${context.channel}.`,
      });
    }

    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(body)) {
        issues.push({
          severity: 'error',
          code: 'unfilled_placeholder',
          detail: 'The message still contains an unfilled template placeholder.',
        });
        break;
      }
    }

    for (const { pattern, reason } of PROHIBITED_MESSAGE_PATTERNS) {
      if (pattern.test(body)) {
        issues.push({
          severity: 'error',
          code: 'prohibited_claim',
          detail: `${reason}. This is not allowed in outbound messages.`,
        });
      }
    }

    // The business name must appear: a message that could go to anyone is not
    // personalised, and sending the wrong name is worse than not sending.
    if (!this.mentionsBusiness(normalized, context.businessName)) {
      issues.push({
        severity: 'error',
        code: 'missing_business_name',
        detail: `The message never refers to "${context.businessName}", so it reads as a mass send.`,
      });
    }

    // Statistics the evidence cannot support.
    for (const claim of this.findUnsupportedNumbers(body, context.evidenceStatements)) {
      issues.push({
        severity: 'error',
        code: 'unsupported_statistic',
        detail: `The message cites "${claim}", which no recorded evidence supports.`,
      });
    }

    /* --- Soft rules: worth a human's attention, not a block. ------------- */

    if (body.length > profile.targetLength) {
      issues.push({
        severity: 'warning',
        code: 'longer_than_ideal',
        detail: `${body.length} characters is longer than the ${profile.targetLength} that performs well on ${context.channel}.`,
      });
    }

    const ctaCount = this.countCallsToAction(body);
    if (ctaCount === 0) {
      issues.push({
        severity: 'warning',
        code: 'no_cta',
        detail: 'The message does not ask for anything. Add one clear next step.',
      });
    } else if (ctaCount > 1) {
      issues.push({
        severity: 'warning',
        code: 'multiple_ctas',
        detail: `The message contains ${ctaCount} separate asks. One is more likely to get a reply.`,
      });
    }

    for (const pattern of GREETING_FILLER) {
      if (pattern.test(body)) {
        issues.push({
          severity: 'warning',
          code: 'filler_opening',
          detail: 'The opening is templated filler. Lead with the specific observation instead.',
        });
        break;
      }
    }

    for (const pattern of GENERIC_FLATTERY) {
      if (pattern.test(body)) {
        issues.push({
          severity: 'warning',
          code: 'generic_flattery',
          detail: 'Contains flattery that could apply to any business.',
        });
        break;
      }
    }

    const repeated = this.findRepeatedPhrase(body);
    if (repeated) {
      issues.push({
        severity: 'warning',
        code: 'repetition',
        detail: `The phrase "${repeated}" is repeated.`,
      });
    }

    if (context.channel === 'email' && !/\n/.test(body.trim())) {
      issues.push({
        severity: 'warning',
        code: 'wall_of_text',
        detail: 'Email bodies read better broken into short paragraphs.',
      });
    }

    if (/\b(dear sir\/madam|to whom it may concern)\b/i.test(body)) {
      issues.push({
        severity: 'warning',
        code: 'impersonal_salutation',
        detail: 'An impersonal salutation undercuts a researched message.',
      });
    }

    const hasError = issues.some((issue) => issue.severity === 'error');
    const hasWarning = issues.some((issue) => issue.severity === 'warning');

    return {
      status: hasError ? 'failed' : hasWarning ? 'warned' : 'passed',
      issues,
    };
  }

  /** Merges AI-reported issues into a deterministic outcome. */
  merge(deterministic: ValidationOutcome, aiIssues: readonly ValidationIssue[]): ValidationOutcome {
    const seen = new Set(deterministic.issues.map((issue) => `${issue.code}:${issue.detail}`));
    const combined = [...deterministic.issues];

    for (const issue of aiIssues) {
      const key = `${issue.code}:${issue.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(issue);
    }

    const hasError = combined.some((issue) => issue.severity === 'error');
    const hasWarning = combined.some((issue) => issue.severity === 'warning');

    return { status: hasError ? 'failed' : hasWarning ? 'warned' : 'passed', issues: combined };
  }

  /* ------------------------------------------------------------- helpers */

  /**
   * Accepts a partial name match: "Mario's" for "Mario's Italian Kitchen" is a
   * natural way to refer to a business, and requiring the legal name would
   * make every good message fail.
   */
  private mentionsBusiness(normalizedBody: string, businessName: string): boolean {
    const name = normalizeText(businessName);
    if (!name) return true;
    if (normalizedBody.includes(name)) return true;

    const distinctive = name
      .split(' ')
      .filter((word) => word.length >= 4 && !GENERIC_NAME_WORDS.has(word));

    if (distinctive.length === 0) {
      // A name made entirely of generic words: fall back to the first word.
      const first = name.split(' ')[0];
      return Boolean(first && normalizedBody.includes(first));
    }

    return distinctive.some((word) => normalizedBody.includes(word));
  }

  /**
   * Finds numeric claims that read as statistics and are not backed by any
   * evidence statement. Times, dates and durations are ignored.
   */
  private findUnsupportedNumbers(body: string, evidenceStatements: readonly string[]): string[] {
    const evidenceText = normalizeText(evidenceStatements.join(' '));
    const unsupported: string[] = [];

    const statisticPattern =
      /(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(%|percent|reviews?|customers?|clients?|stars?|x more|times more)/gi;

    for (const match of body.matchAll(statisticPattern)) {
      const phrase = match[0];
      const number = (match[1] ?? '').replace(/,/g, '');

      if (SAFE_NUMBER_PATTERNS.some((pattern) => pattern.test(phrase))) continue;
      // The exact figure appearing in evidence is what makes a claim supported.
      if (evidenceText.includes(number)) continue;

      unsupported.push(phrase.trim());
    }

    return [...new Set(unsupported)].slice(0, 5);
  }

  /** Counts distinct asks. Question marks and imperative asks both count. */
  private countCallsToAction(body: string): number {
    const questions = (body.match(/\?/g) ?? []).length;
    const imperatives = [
      /\b(let me know|reply|get in touch|book a|schedule a|give me a shout|happy to send|shall i send)\b/gi,
    ].reduce((count, pattern) => count + (body.match(pattern) ?? []).length, 0);

    // A question mark and its matching imperative are one ask, not two.
    return Math.max(questions, imperatives) === 0 ? 0 : Math.max(questions, imperatives);
  }

  /** Detects a repeated 4-word phrase, which reads as sloppy generation. */
  private findRepeatedPhrase(body: string): string | null {
    const words = normalizeText(body).split(' ').filter(Boolean);
    if (words.length < 12) return null;

    const seen = new Map<string, number>();
    for (let i = 0; i + 4 <= words.length; i += 1) {
      const phrase = words.slice(i, i + 4).join(' ');
      const count = (seen.get(phrase) ?? 0) + 1;
      if (count > 1) return phrase;
      seen.set(phrase, count);
    }
    return null;
  }
}

/** Words too common to identify a business on their own. */
const GENERIC_NAME_WORDS = new Set([
  'restaurant',
  'cafe',
  'coffee',
  'bar',
  'shop',
  'store',
  'salon',
  'studio',
  'clinic',
  'garage',
  'centre',
  'center',
  'house',
  'kitchen',
  'services',
  'solutions',
  'group',
  'london',
  'manchester',
  'birmingham',
]);
