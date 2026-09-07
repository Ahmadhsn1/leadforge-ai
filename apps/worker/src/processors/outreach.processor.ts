import {
  JOB_NAMES,
  classifyReplyJobSchema,
  outreachSendJobSchema,
  ClassifyReplyJob,
  Channel,
  DraftKind,
  OutreachSendJob,
} from '@leadforge/shared';
import { logger } from '@leadforge/api';
import type { JobHandler } from '../runner';

/**
 * Outreach execution and follow-ups (docs/22, docs/25, docs/26).
 *
 * Sending is the one place in the product where an irreversible, outward-facing
 * action happens, so every guard runs here again rather than being assumed from
 * the approval step.
 */

export const sendOutreach: JobHandler<OutreachSendJob> = async ({ payload, ctx }) => {
  const job = outreachSendJobSchema.parse(payload);

  await ctx.outreach.send(job.organizationId, job.draftId);

  if (job.startSequence) {
    const draft = await ctx.prisma.messageDraft.findUnique({
      where: { id: job.draftId },
      include: { campaign: { select: { sequenceId: true } } },
    });

    // Follow-ups only ever chain from a first message, never from a follow-up.
    if (draft && draft.kind === 'primary') {
      await ctx.sequences.start(
        job.organizationId,
        job.leadId,
        job.channel,
        draft.campaign?.sequenceId ?? null,
      );
    }
  }
};

/**
 * Periodic sweep for due follow-ups.
 *
 * Scheduling lives in the database (`SequenceRun.nextRunAt`), not in a timer,
 * so a worker restart never loses a scheduled follow-up.
 */
export const sweepFollowUps: JobHandler<{ organizationId: string }> = async ({ ctx }) => {
  const log = logger('sequences');
  const due = await ctx.sequences.dueRuns(100);
  if (due.length === 0) return;

  log.info({ due: due.length }, 'processing due follow-ups');

  for (const run of due) {
    try {
      const step = run.sequence.steps.find((candidate) => candidate.order === run.currentStep);
      if (!step) {
        await ctx.sequences.stop(run.id, 'completed');
        continue;
      }

      /* Stop conditions, re-checked at the moment of sending. */

      if (run.lead.status === 'do_not_contact') {
        await ctx.sequences.stop(run.id, 'do_not_contact');
        continue;
      }
      if (['won', 'lost'].includes(run.lead.status)) {
        await ctx.sequences.stop(run.id, 'lead_closed');
        continue;
      }
      if (run.sequence.stopOnReply && run.lead.lastRepliedAt) {
        await ctx.sequences.stop(run.id, 'replied');
        continue;
      }

      const suppressed = await ctx.suppression.checkLead(
        run.organizationId,
        run.leadId,
        run.sequence.channel as Channel,
      );
      if (suppressed) {
        await ctx.sequences.stop(run.id, 'suppressed');
        continue;
      }

      const campaignLink = await ctx.prisma.campaignLeadLink.findFirst({
        where: { leadId: run.leadId },
        include: { campaign: { select: { id: true, status: true } } },
      });
      if (campaignLink?.campaign.status === 'paused') {
        await ctx.sequences.stop(run.id, 'campaign_paused');
        continue;
      }

      // The follow-up is drafted, not sent: it joins the approval queue like
      // any other message, which is what "human control" means in practice.
      await ctx.queue.enqueue('personalization', JOB_NAMES.personalizeLead, {
        organizationId: run.organizationId,
        idempotencyKey: ctx.queue.buildKey('personalization.follow-up', run.id, step.order),
        inputVersion: 1,
        leadId: run.leadId,
        campaignId: campaignLink?.campaign.id,
        channel: run.sequence.channel as Channel,
        kinds: [step.kind as DraftKind],
        force: true,
      });

      await ctx.prisma.activity.create({
        data: {
          organizationId: run.organizationId,
          leadId: run.leadId,
          type: 'follow_up_due',
          summary: `Follow-up ${step.order} of ${run.sequence.steps.length} is due; a draft has been queued for review.`,
          actor: 'system',
        },
      });

      await ctx.sequences.advance(run.id);
    } catch (error) {
      log.error({ err: error, runId: run.id }, 'failed to process a due follow-up');
    }
  }
};

/** Classifies an inbound reply. Queued by the webhook so it never blocks it. */
export const classifyReply: JobHandler<ClassifyReplyJob> = async ({ payload, ctx }) => {
  const job = classifyReplyJobSchema.parse(payload);
  await ctx.conversations.classifyReply(job.organizationId, job.conversationId, job.messageId);
};
