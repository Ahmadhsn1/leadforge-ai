import { Injectable } from '@nestjs/common';
import type { EvidenceType } from '@leadforge/shared';
import { PrismaService } from '@/common/prisma.service';
import { logger } from './logger';

/**
 * Evidence layer (docs/15-EVIDENCE-LAYER.md).
 *
 * Evidence is a first-class entity: it is what separates "we observed X" from
 * "the model thinks X". Every meaningful observation from verification and
 * enrichment is written here, with its source, timestamp and confidence, and
 * the AI is only ever shown these records.
 *
 * Writes are idempotent on (leadId, type, statement) so re-running a stage
 * refreshes an observation rather than duplicating it.
 */

export interface EvidenceInput {
  readonly organizationId: string;
  readonly leadId: string;
  readonly type: EvidenceType;
  /** Plain-language observation, e.g. "No dedicated website detected." */
  readonly statement: string;
  readonly source: string;
  readonly sourceUrl?: string | null;
  /** 0–1. Deterministic checks are near 1; inferred signals are lower. */
  readonly confidence: number;
  readonly data?: Record<string, unknown>;
  readonly observedAt?: Date;
  /** When the observation should be treated as stale. */
  readonly expiresAt?: Date | null;
}

@Injectable()
export class EvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Writes one evidence record, replacing an identical earlier observation. */
  async record(input: EvidenceInput): Promise<string> {
    const observedAt = input.observedAt ?? new Date();
    const confidence = Math.max(0, Math.min(1, input.confidence));

    const evidence = await this.prisma.evidence.upsert({
      where: {
        leadId_type_statement: {
          leadId: input.leadId,
          type: input.type,
          statement: input.statement,
        },
      },
      create: {
        organizationId: input.organizationId,
        leadId: input.leadId,
        type: input.type,
        statement: input.statement,
        source: input.source,
        sourceUrl: input.sourceUrl ?? null,
        confidence,
        data: (input.data ?? {}) as never,
        observedAt,
        expiresAt: input.expiresAt ?? null,
      },
      update: {
        source: input.source,
        sourceUrl: input.sourceUrl ?? null,
        confidence,
        data: (input.data ?? {}) as never,
        observedAt,
        expiresAt: input.expiresAt ?? null,
      },
    });

    return evidence.id;
  }

  /** Writes several observations, returning their IDs in the same order. */
  async recordMany(inputs: readonly EvidenceInput[]): Promise<string[]> {
    const ids: string[] = [];
    for (const input of inputs) {
      try {
        ids.push(await this.record(input));
      } catch (error) {
        logger('evidence').warn(
          { err: error, leadId: input.leadId, type: input.type },
          'failed to record evidence',
        );
      }
    }
    return ids;
  }

  /**
   * Evidence for a lead, freshest first.
   * Expired records are excluded by default: a stale observation must not
   * silently justify a claim made today.
   */
  async forLead(leadId: string, options: { includeExpired?: boolean } = {}) {
    return this.prisma.evidence.findMany({
      where: {
        leadId,
        ...(options.includeExpired
          ? {}
          : { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }),
      },
      orderBy: [{ confidence: 'desc' }, { observedAt: 'desc' }],
    });
  }

  /** The shape the AI gateway consumes. */
  async factsForLead(leadId: string) {
    const evidence = await this.forLead(leadId);
    return evidence.map((item) => ({
      id: item.id,
      type: item.type as string,
      statement: item.statement,
      source: item.source,
      confidence: item.confidence,
      observedAt: item.observedAt.toISOString(),
    }));
  }

  /** Removes evidence of a type before re-recording it, for full re-runs. */
  async clearType(leadId: string, type: EvidenceType): Promise<void> {
    await this.prisma.evidence.deleteMany({ where: { leadId, type } });
  }
}
