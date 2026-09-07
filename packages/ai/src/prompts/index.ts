import { AI_OUTPUT_SCHEMAS, AI_SCHEMA_VERSION, type AiTaskName } from '@leadforge/shared';
import {
  GROUNDING_RULES,
  OUTPUT_RULES,
  renderBusinessFacts,
  renderEvidence,
  renderHistory,
  renderList,
} from './shared';
import type { BuiltPrompt, PromptBuilder, QualityTier, TaskInputs } from '../types';

/**
 * The prompt registry (docs/18).
 *
 * Each entry pins a version. Changing a prompt's text means bumping its
 * version, because stored results carry the version that produced them and an
 * unversioned change would silently invalidate that audit trail.
 */

export const SCHEMA_VERSION = AI_SCHEMA_VERSION;

const classifyBusiness: PromptBuilder<'classify_business'> = {
  task: 'classify_business',
  version: 'classify_business@1.0.0',
  requiresStructuredOutput: true,
  defaultTier: 'economy',
  schema: AI_OUTPUT_SCHEMAS.classify_business,
  build(input): BuiltPrompt {
    return {
      promptVersion: this.version,
      schemaName: 'business_classification',
      messages: [
        {
          role: 'system',
          content: `You classify small and medium businesses from directory listing data for a B2B sales tool.

${OUTPUT_RULES}

Be conservative: if the listing does not make the category clear, use a broad category and lower the confidence rather than guessing a specific one.
"is_chain" means part of a multi-site brand or franchise, judged only from the name and category.`,
        },
        {
          role: 'user',
          content: `BUSINESS
${renderBusinessFacts(input)}

Classify this business.`,
        },
      ],
    };
  },
};

const analyzeBusiness: PromptBuilder<'analyze_business'> = {
  task: 'analyze_business',
  version: 'analyze_business@1.0.0',
  requiresStructuredOutput: true,
  defaultTier: 'balanced',
  schema: AI_OUTPUT_SCHEMAS.analyze_business,
  build(input): BuiltPrompt {
    return {
      promptVersion: this.version,
      schemaName: 'business_analysis',
      messages: [
        {
          role: 'system',
          content: `You are a sales research analyst. You read verified facts about a business and identify, strictly from that evidence, where the seller's offer could genuinely help.

${GROUNDING_RULES}

${OUTPUT_RULES}

HOW TO THINK:
- "strengths" are things the business is demonstrably doing well. They are the reason this prospect is worth contacting at all.
- "pain_points" are observable gaps. A missing website is a pain point; "poor brand awareness" is not, unless evidence says so.
- "opportunities" are what the seller could do about those gaps, phrased in terms of the business's own outcomes.
- "recommended_angle" is one or two sentences a salesperson could actually open with. It must reference something specific and true about this business.
- "objections" are the most likely reasons this business would say no.
- "unknowns" are the gaps that matter and that you could not establish. Being explicit here is more useful than filling them in.`,
        },
        {
          role: 'user',
          content: `BUSINESS
${renderBusinessFacts(input.business)}

EVIDENCE
${renderEvidence(input.evidence)}

WHAT THE SELLER OFFERS
${input.offer}

CAMPAIGN OBJECTIVE
${input.objective}

ADDITIONAL QUALIFICATION RULES
${renderList(input.customRules)}

Analyse this business.`,
        },
      ],
    };
  },
};

const scoreLead: PromptBuilder<'score_lead'> = {
  task: 'score_lead',
  version: 'score_lead@1.0.0',
  requiresStructuredOutput: true,
  defaultTier: 'economy',
  schema: AI_OUTPUT_SCHEMAS.score_lead,
  build(input): BuiltPrompt {
    return {
      promptVersion: this.version,
      schemaName: 'lead_score',
      messages: [
        {
          role: 'system',
          content: `You explain a lead score that has already been calculated. You do NOT recalculate it.

${GROUNDING_RULES}

${OUTPUT_RULES}

CRITICAL: return the dimension values you are given, unchanged, and return the total you are given, unchanged. Your job is the "explanation" array: one short, concrete sentence per dimension saying why it landed where it did, citing the specific fact responsible. A reader should be able to argue with your reasoning.`,
        },
        {
          role: 'user',
          content: `BUSINESS
${renderBusinessFacts(input.business)}

EVIDENCE
${renderEvidence(input.evidence)}

ANALYSIS
${
  input.analysis
    ? `Summary: ${input.analysis.summary}\nPain points:\n${renderList(input.analysis.painPoints)}\nOpportunities:\n${renderList(input.analysis.opportunities)}`
    : '(no analysis available)'
}

WHAT THE SELLER OFFERS
${input.offer}

CALCULATED SCORE — return these values unchanged
${JSON.stringify(input.dimensions, null, 2)}

Explain this score.`,
        },
      ],
    };
  },
};

const generateMessage: PromptBuilder<'generate_message'> = {
  task: 'generate_message',
  version: 'generate_message@1.0.0',
  requiresStructuredOutput: true,
  defaultTier: 'balanced',
  schema: AI_OUTPUT_SCHEMAS.generate_message,
  build(input): BuiltPrompt {
    return {
      promptVersion: this.version,
      schemaName: 'generated_message',
      messages: [
        {
          role: 'system',
          content: `You write the first message a real salesperson would send to a small business. It must sound like a person who did their homework, not a template.

${GROUNDING_RULES}

MESSAGE RULES — a message breaking any of these is rejected:
- Reference something specific and verifiably true about THIS business, taken from the evidence.
- Exactly one call to action. Never two asks.
- No guarantees, no promised revenue, no "100%", no risk-free claims.
- No invented urgency ("only 3 spots left", "last chance").
- Never imply you are or were their customer.
- No flattery that could apply to any business ("I love what you're doing").
- Do not open with "I hope this finds you well" or any equivalent filler.
- Write in British English.
- Keep it under ${input.maxLength} characters; aim for about ${input.targetLength}.

CHANNEL: ${input.channel}. ${input.styleGuidance}
TONE: ${input.tone}.

"validation_targets" must list every factual claim your message makes, one per entry, so it can be checked against the evidence.

${OUTPUT_RULES}`,
        },
        {
          role: 'user',
          content: `BUSINESS
${renderBusinessFacts(input.business)}

EVIDENCE YOU MAY REFERENCE
${renderEvidence(input.evidence)}

RECOMMENDED ANGLE
${input.angle}

WHAT YOU OFFER
${input.offer}

CALL TO ACTION
${input.cta}

FROM
${input.senderName ?? 'the sender'}${input.senderCompany ? ` at ${input.senderCompany}` : ''}

MESSAGE TYPE
${input.kind}${
            input.previousMessages && input.previousMessages.length > 0
              ? `\n\nPREVIOUS MESSAGES IN THIS SEQUENCE — do not repeat their content or opening:\n${input.previousMessages.map((m, i) => `(${i + 1}) ${m}`).join('\n\n')}`
              : ''
          }${input.refinement ? `\n\nADJUSTMENT REQUESTED\n${input.refinement}` : ''}

Write the message.`,
        },
      ],
    };
  },
};

const validateMessage: PromptBuilder<'validate_message'> = {
  task: 'validate_message',
  version: 'validate_message@1.0.0',
  requiresStructuredOutput: true,
  defaultTier: 'economy',
  schema: AI_OUTPUT_SCHEMAS.validate_message,
  build(input): BuiltPrompt {
    return {
      promptVersion: this.version,
      schemaName: 'message_validation',
      messages: [
        {
          role: 'system',
          content: `You are a fact-checker for outbound sales messages. You are adversarial: assume the message overstates things until the evidence proves otherwise.

Check every factual claim in the message against the evidence and the business facts. Report an issue for each problem found.

Use severity "error" for: a claim with no supporting evidence, an invented metric or statistic, a guaranteed outcome, fabricated urgency, pretending to be a customer, or the wrong business name.
Use severity "warning" for: a claim that stretches the evidence, vague flattery, more than one call to action, or an opening that reads as templated.

"factually_grounded" is true only when there are no "error" issues.

${OUTPUT_RULES}`,
        },
        {
          role: 'user',
          content: `BUSINESS
${renderBusinessFacts(input.business)}

EVIDENCE (the complete set of things known about this business)
${renderEvidence(input.evidence)}

MESSAGE TO CHECK (${input.channel})
"""
${input.body}
"""

Check this message.`,
        },
      ],
    };
  },
};

const classifyReply: PromptBuilder<'classify_reply'> = {
  task: 'classify_reply',
  version: 'classify_reply@1.0.0',
  requiresStructuredOutput: true,
  defaultTier: 'economy',
  schema: AI_OUTPUT_SCHEMAS.classify_reply,
  build(input): BuiltPrompt {
    return {
      promptVersion: this.version,
      schemaName: 'reply_classification',
      messages: [
        {
          role: 'system',
          content: `You triage replies to sales outreach for a human rep.

Classify the intent and sentiment of the latest inbound message, and recommend the next step.

Set "requires_human" to true whenever the reply is an opt-out request, a complaint, a legal or compliance question, a pricing negotiation, or anything where a templated answer would damage the relationship. When in doubt, set it true — a human reading a message unnecessarily costs a minute; an automated reply to the wrong message costs the deal.

${OUTPUT_RULES}`,
        },
        {
          role: 'user',
          content: `BUSINESS
${renderBusinessFacts(input.business)}

WHAT WE OFFER
${input.offer}

CONVERSATION SO FAR
${renderHistory(input.history)}

LATEST INBOUND MESSAGE
"""
${input.incomingMessage}
"""${input.guidance ? `\n\nREP'S STEER FOR THE SUGGESTED RESPONSE\n${input.guidance}` : ''}

Classify this reply.`,
        },
      ],
    };
  },
};

const summarizeConversation: PromptBuilder<'summarize_conversation'> = {
  task: 'summarize_conversation',
  version: 'summarize_conversation@1.0.0',
  requiresStructuredOutput: true,
  defaultTier: 'economy',
  schema: AI_OUTPUT_SCHEMAS.summarize_conversation,
  build(input): BuiltPrompt {
    return {
      promptVersion: this.version,
      schemaName: 'conversation_summary',
      messages: [
        {
          role: 'system',
          content: `You summarise a sales conversation so a rep can pick it up cold.

State what was discussed, what the prospect actually said (not what we hoped they meant), what is still open, and what was agreed. If nothing was agreed, say so — do not invent a next step.

${OUTPUT_RULES}`,
        },
        {
          role: 'user',
          content: `BUSINESS
${renderBusinessFacts(input.business)}

CONVERSATION
${renderHistory(input.history, 40)}

Summarise this conversation.`,
        },
      ],
    };
  },
};

/** All prompt builders, keyed by task. */
export const PROMPTS = {
  classify_business: classifyBusiness,
  analyze_business: analyzeBusiness,
  score_lead: scoreLead,
  generate_message: generateMessage,
  validate_message: validateMessage,
  classify_reply: classifyReply,
  summarize_conversation: summarizeConversation,
} as const;

export function getPrompt<T extends AiTaskName>(task: T): PromptBuilder<T> {
  return PROMPTS[task] as unknown as PromptBuilder<T>;
}

/** Convenience for the settings screen: every task's routing requirements. */
export function promptMetadata(): {
  task: AiTaskName;
  version: string;
  requiresStructuredOutput: boolean;
  defaultTier: QualityTier;
}[] {
  return (Object.keys(PROMPTS) as AiTaskName[]).map((task) => {
    const prompt = getPrompt(task);
    return {
      task,
      version: prompt.version,
      requiresStructuredOutput: prompt.requiresStructuredOutput,
      defaultTier: prompt.defaultTier,
    };
  });
}

export type { TaskInputs };
export * from './shared';
