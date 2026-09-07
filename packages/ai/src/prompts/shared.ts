import type { BusinessFacts, EvidenceFact } from '../types';

/**
 * Prompt building blocks (docs/18-AI-PROMPTS.md).
 *
 * Prompts are code: they are versioned, assembled from these fixed pieces, and
 * every result records the version that produced it. The grounding rules below
 * are repeated in every task that touches business claims, because a model
 * that forgets them produces output the product cannot stand behind.
 */

export const GROUNDING_RULES = `GROUNDING RULES — these are absolute:
- Use ONLY the facts and evidence provided below. You have no other knowledge of this business.
- Never invent metrics, revenue figures, customer counts, or statistics.
- Never claim a hidden or unobservable problem ("they are losing customers", "their SEO is broken") unless an evidence item states it.
- Never fabricate a conversation, review quote, or prior contact.
- If something is unknown, say it is unknown rather than guessing.
- Every pain point and opportunity you output MUST cite the evidence_ids it is based on. An empty evidence_ids array means you are speculating — do not do that.
- Confidence must reflect the strength of the evidence, not your fluency.`;

export const OUTPUT_RULES = `OUTPUT RULES:
- Return a single JSON object and nothing else. No prose before or after, no markdown fences.
- Match the schema exactly: no extra keys, no missing required keys.
- Use plain, specific English. No marketing adjectives, no filler.`;

/** Renders the business identity block. Only non-null facts are included. */
export function renderBusinessFacts(business: BusinessFacts): string {
  const lines: string[] = [`Name: ${business.name}`];

  if (business.category) lines.push(`Category: ${business.category}`);
  const location = [business.address, business.city, business.country].filter(Boolean).join(', ');
  if (location) lines.push(`Location: ${location}`);
  if (business.rating !== null && business.rating !== undefined) {
    lines.push(
      `Public rating: ${business.rating.toFixed(1)} out of 5${
        business.reviewCount ? ` across ${business.reviewCount} reviews` : ''
      }`,
    );
  }
  lines.push(`Phone on record: ${business.phone ? 'yes' : 'no'}`);
  lines.push(`Email on record: ${business.email ? 'yes' : 'no'}`);
  lines.push(
    `Website: ${
      business.website
        ? `${business.website} (status: ${business.websiteStatus ?? 'unknown'})`
        : 'none found'
    }`,
  );
  if (business.socialProfiles && business.socialProfiles.length > 0) {
    lines.push(
      `Public social profiles: ${business.socialProfiles.map((p) => p.platform).join(', ')}`,
    );
  } else {
    lines.push('Public social profiles: none found');
  }
  lines.push(`Discovery source: ${business.source}`);

  return lines.join('\n');
}

/**
 * Renders evidence with stable IDs so the model can cite them. Ordered by
 * confidence so the strongest observations are read first.
 */
export function renderEvidence(evidence: readonly EvidenceFact[]): string {
  if (evidence.length === 0) {
    return 'No evidence has been recorded for this business. You must not assert any pain point or opportunity.';
  }
  return [...evidence]
    .sort((a, b) => b.confidence - a.confidence)
    .map(
      (item) =>
        `[${item.id}] (${item.type}, confidence ${item.confidence.toFixed(2)}, observed ${item.observedAt.slice(0, 10)}, source: ${item.source})\n${item.statement}`,
    )
    .join('\n\n');
}

/** Renders a conversation history for the copilot tasks. */
export function renderHistory(
  history: readonly { direction: 'inbound' | 'outbound'; body: string }[],
  limit = 20,
): string {
  if (history.length === 0) return '(no prior messages)';
  return history
    .slice(-limit)
    .map((message) => `${message.direction === 'inbound' ? 'THEM' : 'US'}: ${message.body}`)
    .join('\n\n');
}

/** Formats a bullet list, or a placeholder when empty. */
export function renderList(
  items: readonly string[] | undefined,
  placeholder = '(none specified)',
): string {
  if (!items || items.length === 0) return placeholder;
  return items.map((item) => `- ${item}`).join('\n');
}
