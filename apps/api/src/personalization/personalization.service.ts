import { Injectable } from '@nestjs/common';
import { AppError, CHANNEL_PROFILES, Channel, DraftKind } from '@leadforge/shared';
import { PrismaService } from '@/common/prisma.service';
import { EvidenceService } from '@/common/evidence.service';
import { AiService } from '@/ai/ai.service';
import { IntelligenceService } from '@/intelligence/intelligence.service';
import { MessageValidator, ValidationIssue } from './message-validator';
import { logger } from '@/common/logger';
import type { EvidenceFact } from '@leadforge/ai';

/**
 * Personalisation engine (docs/21).
 *
 * Generates a draft, then validates it twice: deterministically (rules that
 * cannot be argued with) and with an adversarial model pass. Both results are
 * stored on the draft so a reviewer sees exactly why something was flagged.
 *
 * A draft that fails validation is still saved — the user can see and fix it —
 * but the outreach state machine refuses to queue it.
 */

export interface GenerateOptions {
  readonly channel: Channel;
  readonly kinds: readonly DraftKind[];
  readonly tone?: string;
  readonly cta?: string;
  readonly offer?: string;
  /** Instruction from a refinement button, e.g. "make it shorter". */
  readonly refinement?: string;
  readonly force?: boolean;
}

@Injectable()
export class PersonalizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: EvidenceService,
    private readonly ai: AiService,
    private readonly intelligence: IntelligenceService,
    private readonly validator: MessageValidator,
  ) {}

  /** Generates one draft per requested kind, replacing prior drafts of that kind. */
  async generate(
    organizationId: string,
    leadId: string,
    options: GenerateOptions,
  ): Promise<string[]> {
    if (!this.ai.isConfigured()) throw AppError.providerNotConfigured('The AI gateway');

    const lead = await this.prisma.lead.findFirstOrThrow({
      where: { id: leadId, organizationId },
      include: {
        websiteAnalysis: true,
        socialProfiles: true,
        reports: { orderBy: { version: 'desc' }, take: 1 },
        campaignLinks: { include: { campaign: true }, take: 1 },
        drafts: { where: { channel: options.channel }, orderBy: { createdAt: 'asc' } },
      },
    });

    const report = lead.reports[0];
    if (!report) {
      throw new AppError(
        'CONFLICT',
        'This lead has not been analysed yet. Analysis produces the angle and evidence that message generation depends on.',
        { retryable: false },
      );
    }

    const campaign = lead.campaignLinks[0]?.campaign;
    const aiSettings = (campaign?.aiSettings ?? {}) as {
      offer?: string;
      tone?: string;
      cta?: string;
      senderName?: string;
      senderCompany?: string;
      tier?: 'economy' | 'balanced' | 'quality';
    };

    const facts = await this.evidence.factsForLead(leadId);
    const business = this.intelligence.toBusinessFacts(lead);
    const profile = CHANNEL_PROFILES[options.channel];

    const draftIds: string[] = [];

    for (const kind of options.kinds) {
      // Follow-ups must know what was already said, or they repeat it.
      const previous = lead.drafts
        .filter((draft) => draft.kind !== kind && draft.status !== 'cancelled')
        .map((draft) => draft.body)
        .slice(0, 3);

      const response = await this.ai.run(
        'generate_message',
        {
          business,
          evidence: facts as EvidenceFact[],
          angle: report.recommendedAngle,
          channel: options.channel,
          kind,
          tone: options.tone ?? aiSettings.tone ?? 'friendly',
          cta: options.cta ?? aiSettings.cta ?? 'Ask if they are open to a quick chat this week.',
          offer: options.offer ?? aiSettings.offer ?? 'General business services.',
          senderName: aiSettings.senderName,
          senderCompany: aiSettings.senderCompany,
          maxLength: profile.maxLength,
          targetLength:
            kind === 'short' ? Math.round(profile.targetLength * 0.6) : profile.targetLength,
          styleGuidance: profile.styleGuidance,
          refinement: options.refinement ?? this.guidanceForKind(kind),
          previousMessages: previous,
        },
        { organizationId, campaignId: campaign?.id, leadId },
        { tier: aiSettings.tier },
      );

      const message = response.result;

      const validation = await this.validateMessage(organizationId, leadId, message.body, {
        businessName: lead.canonicalName,
        channel: options.channel,
        evidenceStatements: facts.map((fact) => fact.statement),
        senderName: aiSettings.senderName,
        senderCompany: aiSettings.senderCompany,
        business,
        facts,
      });

      // Replacing rather than accumulating: a lead should not end up with ten
      // near-identical "primary" drafts after a few regenerations.
      await this.prisma.messageDraft.deleteMany({
        where: { leadId, channel: options.channel, kind, status: 'draft' },
      });

      const draft = await this.prisma.messageDraft.create({
        data: {
          organizationId,
          leadId,
          campaignId: campaign?.id ?? null,
          channel: options.channel,
          kind,
          subject: profile.supportsSubject ? (message.subject ?? null) : null,
          body: message.body,
          angle: message.angle,
          cta: message.cta,
          status: 'draft',
          validationStatus: validation.status,
          validationErrors: validation.issues as never,
          evidenceIds: facts.map((fact) => fact.id),
          provider: response.provider,
          model: response.model,
          promptVersion: response.promptVersion,
          schemaVersion: response.schemaVersion,
        },
      });

      draftIds.push(draft.id);

      logger('personalization').info(
        { leadId, kind, channel: options.channel, validation: validation.status },
        'draft generated',
      );
    }

    await this.prisma.lead.update({ where: { id: leadId }, data: { personalizedAt: new Date() } });

    await this.prisma.activity.create({
      data: {
        organizationId,
        leadId,
        campaignId: campaign?.id ?? null,
        type: 'message_generated',
        summary: `${draftIds.length} ${options.channel} draft${draftIds.length === 1 ? '' : 's'} generated.`,
        actor: 'system',
      },
    });

    return draftIds;
  }

  /**
   * Runs both validation passes. The AI pass is best-effort: if it fails, the
   * deterministic verdict stands rather than blocking the draft entirely.
   */
  async validateMessage(
    organizationId: string,
    leadId: string,
    body: string,
    context: {
      businessName: string;
      channel: Channel;
      evidenceStatements: string[];
      senderName?: string | null;
      senderCompany?: string | null;
      business: ReturnType<IntelligenceService['toBusinessFacts']>;
      facts: {
        id: string;
        statement: string;
        type: string;
        source: string;
        confidence: number;
        observedAt: string;
      }[];
    },
  ) {
    const deterministic = this.validator.validate(body, {
      businessName: context.businessName,
      channel: context.channel,
      evidenceStatements: context.evidenceStatements,
      senderName: context.senderName,
      senderCompany: context.senderCompany,
    });

    if (!this.ai.isConfigured()) return deterministic;

    try {
      const response = await this.ai.run(
        'validate_message',
        {
          business: context.business,
          evidence: context.facts as EvidenceFact[],
          body,
          channel: context.channel,
        },
        { organizationId, leadId },
        { tier: 'economy' },
      );

      const aiIssues: ValidationIssue[] = response.result.issues.map((issue) => ({
        severity: issue.severity,
        code: issue.code,
        detail: issue.detail,
      }));

      return this.validator.merge(deterministic, aiIssues);
    } catch (error) {
      logger('personalization').warn(
        { err: error, leadId },
        'AI validation pass failed; using the deterministic result only',
      );
      return deterministic;
    }
  }

  /** Re-validates an edited draft. */
  async revalidate(organizationId: string, draftId: string, body: string, subject?: string | null) {
    const draft = await this.prisma.messageDraft.findFirstOrThrow({
      where: { id: draftId, organizationId },
      include: {
        lead: { include: { socialProfiles: true } },
      },
    });

    const facts = await this.evidence.factsForLead(draft.leadId);

    const validation = await this.validateMessage(organizationId, draft.leadId, body, {
      businessName: draft.lead.canonicalName,
      channel: draft.channel,
      evidenceStatements: facts.map((fact) => fact.statement),
      business: this.intelligence.toBusinessFacts(draft.lead),
      facts,
    });

    return this.prisma.messageDraft.update({
      where: { id: draftId },
      data: {
        body,
        subject: subject === undefined ? draft.subject : subject,
        validationStatus: validation.status,
        validationErrors: validation.issues as never,
      },
    });
  }

  /** Per-step guidance, so a follow-up does not read like the first message. */
  private guidanceForKind(kind: DraftKind): string | null {
    switch (kind) {
      case 'short':
        return 'Write the shortest version that still carries the specific observation and the ask.';
      case 'alternative':
        return 'Use a different opening observation from the evidence than the obvious one.';
      case 'follow_up_1':
        return 'A brief nudge. Reference the first message in one clause, add nothing new, and make it easy to ignore.';
      case 'follow_up_2':
        return 'Add one concrete piece of value or proof that was not in the earlier messages.';
      case 'final':
        return 'A polite close-out. Make it genuinely easy to say no, and do not ask again after this.';
      default:
        return null;
    }
  }
}
