import { Injectable } from '@nestjs/common';
import { AppError, DEFAULT_SEQUENCE_STEPS, Channel, DraftKind } from '@leadforge/shared';
import { PrismaService } from '@/common/prisma.service';
import { logger } from '@/common/logger';

/**
 * Follow-up sequences (docs/25-FOLLOWUP-SEQUENCES.md).
 *
 * Scheduling is job-driven, not timer-driven: a SequenceRun carries a
 * `nextRunAt`, and a periodic sweep picks up whatever is due. A process
 * restart therefore loses nothing.
 */

export interface SequenceStepInput {
  readonly order: number;
  readonly kind: DraftKind;
  readonly delayHours: number;
  readonly guidance?: string;
}

export type StopReason =
  | 'replied'
  | 'positive_outcome'
  | 'opted_out'
  | 'do_not_contact'
  | 'lead_closed'
  | 'campaign_paused'
  | 'completed'
  | 'suppressed';

@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    const sequences = await this.prisma.outreachSequence.findMany({
      where: { organizationId },
      include: {
        steps: { orderBy: { order: 'asc' } },
        _count: { select: { runs: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const activeRuns = await this.prisma.sequenceRun.groupBy({
      by: ['sequenceId'],
      where: { organizationId, status: 'active' },
      _count: { _all: true },
    });
    const activeBySequence = new Map(activeRuns.map((row) => [row.sequenceId, row._count._all]));

    return sequences.map((sequence) => ({
      id: sequence.id,
      name: sequence.name,
      description: sequence.description,
      channel: sequence.channel,
      active: sequence.active,
      isDefault: sequence.isDefault,
      stopOnReply: sequence.stopOnReply,
      stopOnPositive: sequence.stopOnPositive,
      steps: sequence.steps.map((step) => ({
        id: step.id,
        order: step.order,
        kind: step.kind,
        delayHours: step.delayHours,
        guidance: step.guidance,
      })),
      activeRuns: activeBySequence.get(sequence.id) ?? 0,
    }));
  }

  async create(
    organizationId: string,
    input: {
      name: string;
      channel: Channel;
      description?: string;
      steps: SequenceStepInput[];
      stopOnReply: boolean;
      stopOnPositive: boolean;
      active: boolean;
    },
  ) {
    const sequence = await this.prisma.outreachSequence.create({
      data: {
        organizationId,
        name: input.name,
        description: input.description ?? null,
        channel: input.channel,
        active: input.active,
        stopOnReply: input.stopOnReply,
        stopOnPositive: input.stopOnPositive,
        steps: {
          create: input.steps.map((step) => ({
            order: step.order,
            kind: step.kind,
            delayHours: step.delayHours,
            guidance: step.guidance ?? null,
          })),
        },
      },
      include: { steps: true },
    });

    return sequence;
  }

  async remove(organizationId: string, id: string): Promise<void> {
    const deleted = await this.prisma.outreachSequence.deleteMany({
      where: { id, organizationId },
    });
    if (deleted.count === 0) throw AppError.notFound('Sequence', id);
  }

  /** Creates the default sequences for a new workspace. */
  async seedDefaults(organizationId: string): Promise<void> {
    const existing = await this.prisma.outreachSequence.count({ where: { organizationId } });
    if (existing > 0) return;

    for (const channel of ['whatsapp', 'email'] as const) {
      await this.create(organizationId, {
        name: `Standard ${channel} follow-up`,
        channel,
        description: 'Four touches over roughly two weeks, stopping the moment they reply.',
        steps: DEFAULT_SEQUENCE_STEPS.map((step) => ({
          order: step.order,
          kind: step.kind,
          delayHours: step.delayHours,
          guidance: step.guidance,
        })),
        stopOnReply: true,
        stopOnPositive: true,
        active: true,
      });
    }
  }

  /**
   * Starts a sequence for a lead after its first message sends.
   * Idempotent: a lead already in this sequence is left alone.
   */
  async start(
    organizationId: string,
    leadId: string,
    channel: Channel,
    campaignSequenceId?: string | null,
  ) {
    const sequence = campaignSequenceId
      ? await this.prisma.outreachSequence.findFirst({
          where: { id: campaignSequenceId, organizationId, active: true },
          include: { steps: { orderBy: { order: 'asc' } } },
        })
      : await this.prisma.outreachSequence.findFirst({
          where: { organizationId, channel, active: true },
          include: { steps: { orderBy: { order: 'asc' } } },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        });

    if (!sequence || sequence.steps.length <= 1) return null;

    const existing = await this.prisma.sequenceRun.findUnique({
      where: { leadId_sequenceId: { leadId, sequenceId: sequence.id } },
    });
    if (existing) return existing;

    // Step 1 is the message that just sent, so the run starts at step 2.
    const nextStep = sequence.steps[1];
    if (!nextStep) return null;

    const run = await this.prisma.sequenceRun.create({
      data: {
        organizationId,
        sequenceId: sequence.id,
        leadId,
        currentStep: nextStep.order,
        status: 'active',
        nextRunAt: new Date(Date.now() + nextStep.delayHours * 60 * 60 * 1000),
      },
    });

    logger('sequence').info(
      { leadId, sequenceId: sequence.id, nextRunAt: run.nextRunAt },
      'follow-up sequence started',
    );

    return run;
  }

  /** Runs that are due now. Used by the periodic sweep. */
  async dueRuns(limit = 100) {
    return this.prisma.sequenceRun.findMany({
      where: { status: 'active', nextRunAt: { lte: new Date() } },
      include: {
        sequence: { include: { steps: { orderBy: { order: 'asc' } } } },
        lead: true,
      },
      orderBy: { nextRunAt: 'asc' },
      take: limit,
    });
  }

  /** Advances to the next step, or completes the run when there is none. */
  async advance(runId: string): Promise<void> {
    const run = await this.prisma.sequenceRun.findUniqueOrThrow({
      where: { id: runId },
      include: { sequence: { include: { steps: { orderBy: { order: 'asc' } } } } },
    });

    const next = run.sequence.steps.find((step) => step.order > run.currentStep);

    if (!next) {
      await this.stop(runId, 'completed');
      return;
    }

    await this.prisma.sequenceRun.update({
      where: { id: runId },
      data: {
        currentStep: next.order,
        nextRunAt: new Date(Date.now() + next.delayHours * 60 * 60 * 1000),
      },
    });
  }

  async stop(runId: string, reason: StopReason): Promise<void> {
    await this.prisma.sequenceRun.update({
      where: { id: runId },
      data: {
        status: reason === 'completed' ? 'completed' : 'stopped',
        stoppedReason: reason,
        nextRunAt: null,
      },
    });
    logger('sequence').info({ runId, reason }, 'sequence run stopped');
  }

  /**
   * Stops every active run for a lead. Called on reply, opt-out, close and
   * suppression — the stop conditions in docs/25.
   */
  async stopForLead(organizationId: string, leadId: string, reason: StopReason): Promise<number> {
    const result = await this.prisma.sequenceRun.updateMany({
      where: { organizationId, leadId, status: 'active' },
      data: {
        status: 'stopped',
        stoppedReason: reason,
        nextRunAt: null,
      },
    });
    if (result.count > 0) {
      logger('sequence').info(
        { leadId, reason, stopped: result.count },
        'sequences stopped for lead',
      );
    }
    return result.count;
  }

  /** Stops every run belonging to a paused campaign. */
  async stopForCampaign(organizationId: string, campaignId: string): Promise<number> {
    const leads = await this.prisma.campaignLeadLink.findMany({
      where: { organizationId, campaignId },
      select: { leadId: true },
    });
    if (leads.length === 0) return 0;

    const result = await this.prisma.sequenceRun.updateMany({
      where: { organizationId, leadId: { in: leads.map((link) => link.leadId) }, status: 'active' },
      data: { status: 'stopped', stoppedReason: 'campaign_paused', nextRunAt: null },
    });
    return result.count;
  }
}
