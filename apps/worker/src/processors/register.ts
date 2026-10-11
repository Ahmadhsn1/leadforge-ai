import { JOB_NAMES } from '@leadforge/shared';
import { rootLogger } from '@leadforge/api';
import type { WorkerContext } from '../context';
import type { WorkerRunner } from '../runner';
import { discoveryRun, normalizeCandidate } from './discovery.processor';
import {
  analyzeLead,
  enrichLead,
  personalizeLead,
  scoreLead,
  verifyLead,
} from './pipeline.processor';
import { classifyReply, sendOutreach, sweepFollowUps } from './outreach.processor';

/**
 * The one list of which processor handles which job. Both entry points — the
 * standalone worker and the single-process server — register from here, so a
 * new job cannot be wired into one and forgotten in the other.
 */
export function registerProcessors(runner: WorkerRunner): void {
  runner.register('discovery', { [JOB_NAMES.discoveryRun]: discoveryRun as never });
  runner.register('normalization', { [JOB_NAMES.normalizeCandidate]: normalizeCandidate as never });
  runner.register('verification', { [JOB_NAMES.verifyLead]: verifyLead as never });
  runner.register('enrichment', { [JOB_NAMES.enrichLead]: enrichLead as never });
  runner.register('intelligence', { [JOB_NAMES.analyzeLead]: analyzeLead as never });
  runner.register('scoring', { [JOB_NAMES.scoreLead]: scoreLead as never });
  runner.register('personalization', { [JOB_NAMES.personalizeLead]: personalizeLead as never });
  runner.register('outreach', {
    [JOB_NAMES.sendOutreach]: sendOutreach as never,
    [JOB_NAMES.sweepFollowUps]: sweepFollowUps as never,
    [JOB_NAMES.classifyReply]: classifyReply as never,
  });
}

/**
 * Follow-up sweep. A repeatable job rather than setInterval: BullMQ keeps
 * exactly one schedule across however many worker replicas are running.
 */
export async function scheduleFollowUpSweep(ctx: WorkerContext): Promise<void> {
  await ctx.queue
    .getQueue('outreach')
    .add(
      JOB_NAMES.sweepFollowUps,
      { organizationId: 'system', jobId: 'sweep', idempotencyKey: 'sweep', inputVersion: 1 },
      {
        repeat: { every: 5 * 60 * 1000 },
        jobId: 'follow-up-sweep',
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    )
    .catch((error: unknown) => {
      rootLogger.error({ err: error }, 'could not schedule the follow-up sweep');
    });
}
