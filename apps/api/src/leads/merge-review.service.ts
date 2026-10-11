import { Injectable } from '@nestjs/common';
import { AppError } from '@leadforge/shared';
import { PrismaService } from '@/common/prisma.service';
import { logger } from '@/common/logger';
import type { Prisma } from '@leadforge/database';

const LEAD_FIELDS = {
  id: true,
  canonicalName: true,
  category: true,
  address: true,
  city: true,
  phone: true,
  email: true,
  website: true,
  source: true,
  status: true,
  leadScore: true,
  createdAt: true,
  mergedIntoId: true,
} as const;

/**
 * Review of possible duplicates (docs/11, "medium confidence → mark for review").
 *
 * Dedupe merges automatically only when it is sure. Pairs it is not sure about
 * are recorded as merge candidates, and until now nothing read them. This is
 * where a person decides: the same business, or two different ones.
 */
@Injectable()
export class MergeReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /** Unresolved pairs, newest first, with both leads side by side. */
  async list(organizationId: string) {
    const candidates = await this.prisma.mergeCandidate.findMany({
      where: { organizationId, decision: 'review', resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    if (candidates.length === 0) return [];

    const ids = [...new Set(candidates.flatMap((c) => [c.leadId, c.candidateLeadId]))];
    const leads = await this.prisma.lead.findMany({
      where: { organizationId, id: { in: ids } },
      select: LEAD_FIELDS,
    });
    const byId = new Map(leads.map((lead) => [lead.id, lead]));

    return candidates.flatMap((candidate) => {
      const lead = byId.get(candidate.leadId);
      const existing = byId.get(candidate.candidateLeadId);
      // A pair is only worth showing while both leads still stand on their own.
      if (!lead || !existing || lead.mergedIntoId || existing.mergedIntoId) return [];

      const view = (item: typeof lead) => ({
        id: item.id,
        name: item.canonicalName,
        category: item.category,
        address: [item.address, item.city].filter(Boolean).join(', ') || null,
        phone: item.phone,
        email: item.email,
        website: item.website,
        source: item.source,
        status: item.status,
        leadScore: item.leadScore,
        createdAt: item.createdAt.toISOString(),
      });

      return [
        {
          id: candidate.id,
          score: candidate.score,
          reasons: candidate.reasons,
          createdAt: candidate.createdAt.toISOString(),
          // The lead that was already here, and the newer one that resembles it.
          existing: view(existing),
          incoming: view(lead),
        },
      ];
    });
  }

  async count(organizationId: string): Promise<number> {
    return this.prisma.mergeCandidate.count({
      where: { organizationId, decision: 'review', resolvedAt: null },
    });
  }

  /**
   * Resolves a pair.
   *
   * `distinct` only records the decision. `merge` folds the newer lead into
   * the older one: everything attached to it moves across, gaps in the
   * survivor are filled from it, and it is marked as merged rather than
   * deleted — its row is the provenance for what was moved.
   */
  async resolve(
    organizationId: string,
    candidateId: string,
    action: 'merge' | 'distinct',
    userId: string,
  ): Promise<{ resolution: string; survivorId: string | null }> {
    const candidate = await this.prisma.mergeCandidate.findFirst({
      where: { id: candidateId, organizationId },
    });
    if (!candidate) throw AppError.notFound('Merge candidate', candidateId);
    if (candidate.resolvedAt) {
      throw AppError.conflict('This pair has already been resolved.');
    }

    if (action === 'distinct') {
      await this.prisma.mergeCandidate.update({
        where: { id: candidate.id },
        data: { resolvedAt: new Date(), resolution: 'distinct' },
      });
      return { resolution: 'distinct', survivorId: null };
    }

    const [duplicate, survivor] = await Promise.all([
      this.prisma.lead.findFirst({ where: { id: candidate.leadId, organizationId } }),
      this.prisma.lead.findFirst({ where: { id: candidate.candidateLeadId, organizationId } }),
    ]);
    if (!duplicate || !survivor || duplicate.mergedIntoId || survivor.mergedIntoId) {
      throw AppError.conflict('One of these leads is no longer available to merge.');
    }

    await this.prisma.$transaction(
      (tx) => this.fold(tx, organizationId, duplicate.id, survivor.id, userId),
      { timeout: 60_000, maxWait: 15_000 },
    );

    await this.prisma.lead.update({
      where: { id: survivor.id },
      data: {
        // Gaps only: what the survivor already knows is kept.
        phone: survivor.phone ?? duplicate.phone,
        phoneKey: survivor.phoneKey ?? duplicate.phoneKey,
        email: survivor.email ?? duplicate.email,
        website: survivor.website ?? duplicate.website,
        domainKey: survivor.domainKey ?? duplicate.domainKey,
        address: survivor.address ?? duplicate.address,
        city: survivor.city ?? duplicate.city,
        region: survivor.region ?? duplicate.region,
        postalCode: survivor.postalCode ?? duplicate.postalCode,
        latitude: survivor.latitude ?? duplicate.latitude,
        longitude: survivor.longitude ?? duplicate.longitude,
        category: survivor.category ?? duplicate.category,
        categoryKey: survivor.categoryKey ?? duplicate.categoryKey,
        rating: survivor.rating ?? duplicate.rating,
        reviewCount: survivor.reviewCount ?? duplicate.reviewCount,
        tags: [...new Set([...survivor.tags, ...duplicate.tags])],
      },
    });

    logger('leads').info({ survivorId: survivor.id, duplicateId: duplicate.id }, 'leads merged');
    return { resolution: 'merged', survivorId: survivor.id };
  }

  /**
   * Moves everything attached to `fromId` onto `toId`.
   *
   * Tables with a uniqueness rule on the lead (a contact value, a piece of
   * evidence, a campaign link) are moved row by row: where the survivor
   * already holds the same thing, the duplicate's copy is dropped instead.
   */
  private async fold(
    tx: Prisma.TransactionClient,
    organizationId: string,
    fromId: string,
    toId: string,
    userId: string,
  ): Promise<void> {
    const where = { leadId: fromId };
    const move = { leadId: toId };

    // No uniqueness on the lead: move wholesale.
    await tx.note.updateMany({ where, data: move });
    await tx.task.updateMany({ where, data: move });
    await tx.activity.updateMany({ where, data: move });
    await tx.messageDraft.updateMany({ where, data: move });
    await tx.conversation.updateMany({ where, data: move });
    await tx.outreachEvent.updateMany({ where, data: move });
    await tx.leadSourceRecord.updateMany({ where, data: move });
    await tx.verificationRecord.updateMany({ where, data: move });

    for (const link of await tx.campaignLeadLink.findMany({ where })) {
      const clash = await tx.campaignLeadLink.findUnique({
        where: { campaignId_leadId: { campaignId: link.campaignId, leadId: toId } },
      });
      if (clash) await tx.campaignLeadLink.delete({ where: { id: link.id } });
      else await tx.campaignLeadLink.update({ where: { id: link.id }, data: move });
    }

    for (const contact of await tx.contact.findMany({ where })) {
      const clash = await tx.contact.findUnique({
        where: {
          leadId_kind_valueKey: { leadId: toId, kind: contact.kind, valueKey: contact.valueKey },
        },
      });
      if (clash) await tx.contact.delete({ where: { id: contact.id } });
      else await tx.contact.update({ where: { id: contact.id }, data: move });
    }

    for (const profile of await tx.socialProfile.findMany({ where })) {
      const clash = await tx.socialProfile.findUnique({
        where: {
          leadId_platform_profileUrl: {
            leadId: toId,
            platform: profile.platform,
            profileUrl: profile.profileUrl,
          },
        },
      });
      if (clash) await tx.socialProfile.delete({ where: { id: profile.id } });
      else await tx.socialProfile.update({ where: { id: profile.id }, data: move });
    }

    for (const item of await tx.evidence.findMany({ where })) {
      const clash = await tx.evidence.findUnique({
        where: {
          leadId_type_statement: { leadId: toId, type: item.type, statement: item.statement },
        },
      });
      if (clash) await tx.evidence.delete({ where: { id: item.id } });
      else await tx.evidence.update({ where: { id: item.id }, data: move });
    }

    for (const run of await tx.sequenceRun.findMany({ where })) {
      const clash = await tx.sequenceRun.findUnique({
        where: { leadId_sequenceId: { leadId: toId, sequenceId: run.sequenceId } },
      });
      if (clash) await tx.sequenceRun.delete({ where: { id: run.id } });
      else await tx.sequenceRun.update({ where: { id: run.id }, data: move });
    }

    // Reports, scores and the website analysis describe the duplicate as it
    // was researched on its own. The survivor has, or will get, its own; the
    // duplicate's stay with its row.

    await tx.lead.update({ where: { id: fromId }, data: { mergedIntoId: toId } });

    // Every other open pair that involved the lead that just went away.
    await tx.mergeCandidate.updateMany({
      where: {
        organizationId,
        resolvedAt: null,
        OR: [{ leadId: fromId }, { candidateLeadId: fromId }],
      },
      data: { resolvedAt: new Date(), resolution: 'merged' },
    });

    await tx.activity.create({
      data: {
        organizationId,
        leadId: toId,
        type: 'status_changed',
        summary: 'A duplicate lead was merged into this one after review.',
        actor: 'user',
        actorUserId: userId,
        metadata: { mergedLeadId: fromId },
      },
    });
  }
}
