/**
 * Package entry point.
 *
 * The worker runs the same domain services as the API — verification, scoring,
 * intelligence, personalisation and outreach are one implementation, not two.
 * It boots AppModule as a standalone Nest context and resolves what it needs.
 */
export { AppModule } from './app.module';

export { PrismaService } from './common/prisma.service';
export { MailService } from './common/mail.service';
export { EvidenceService } from './common/evidence.service';
export { SafeFetchService } from './common/safe-fetch.service';
export { QueueService } from './jobs/queue.service';
export type { JobPayload, JobPayloadBase } from './jobs/queue.service';
export { AuditService } from './organizations/audit.service';

export { AiService } from './ai/ai.service';

export { GooglePlacesAdapter } from './discovery/adapters/google-places.adapter';
export type {
  RawCandidate,
  SearchCriteria,
  SearchResult,
  SourceAdapter,
} from './discovery/adapters/source-adapter';

export { NormalizationService } from './normalization/normalization.service';
export type { NormalizedLead } from './normalization/normalization.service';
export { VerificationService } from './verification/verification.service';
export { EnrichmentService } from './enrichment/enrichment.service';
export { ScoringService } from './scoring/scoring.service';
export { IntelligenceService } from './intelligence/intelligence.service';
export { PersonalizationService } from './personalization/personalization.service';
export { MessageValidator } from './personalization/message-validator';

export { OutreachService } from './outreach/outreach.service';
export { SequenceService } from './outreach/sequence.service';
export { SuppressionService } from './outreach/suppression.service';
export { WhatsAppAdapter } from './outreach/adapters/whatsapp.adapter';
export { InstagramAdapter } from './outreach/adapters/instagram.adapter';
export { EmailAdapter } from './outreach/adapters/email.adapter';
export type { ChannelAdapter, NormalizedEvent } from './outreach/adapters/channel-adapter';

export { ConversationsService } from './conversations/conversations.service';
export { CampaignsService } from './campaigns/campaigns.service';
export { LeadsService } from './leads/leads.service';
export { AnalyticsService } from './analytics/analytics.service';

export {
  logger,
  rootLogger,
  withLogContext,
  enrichLogContext,
  newRequestId,
} from './common/logger';
