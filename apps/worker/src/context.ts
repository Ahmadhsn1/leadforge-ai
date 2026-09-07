import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import {
  AppModule,
  AiService,
  AnalyticsService,
  CampaignsService,
  ConversationsService,
  EnrichmentService,
  EvidenceService,
  GooglePlacesAdapter,
  IntelligenceService,
  LeadsService,
  NormalizationService,
  OutreachService,
  PersonalizationService,
  PrismaService,
  QueueService,
  ScoringService,
  SequenceService,
  SuppressionService,
  VerificationService,
} from '@leadforge/api';

/**
 * The worker runs the same domain services as the API.
 *
 * Booting AppModule as a standalone Nest context (no HTTP listener) means
 * verification, scoring, intelligence and outreach have exactly one
 * implementation. A behaviour that differs between the API and the worker is
 * a bug the architecture makes impossible.
 */
export interface WorkerContext {
  readonly app: INestApplicationContext;
  readonly prisma: PrismaService;
  readonly queue: QueueService;
  readonly evidence: EvidenceService;
  readonly ai: AiService;
  readonly places: GooglePlacesAdapter;
  readonly normalization: NormalizationService;
  readonly verification: VerificationService;
  readonly enrichment: EnrichmentService;
  readonly intelligence: IntelligenceService;
  readonly scoring: ScoringService;
  readonly personalization: PersonalizationService;
  readonly outreach: OutreachService;
  readonly sequences: SequenceService;
  readonly suppression: SuppressionService;
  readonly conversations: ConversationsService;
  readonly campaigns: CampaignsService;
  readonly leads: LeadsService;
  readonly analytics: AnalyticsService;
}

export async function createWorkerContext(): Promise<WorkerContext> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  app.enableShutdownHooks();

  return {
    app,
    prisma: app.get(PrismaService),
    queue: app.get(QueueService),
    evidence: app.get(EvidenceService),
    ai: app.get(AiService),
    places: app.get(GooglePlacesAdapter),
    normalization: app.get(NormalizationService),
    verification: app.get(VerificationService),
    enrichment: app.get(EnrichmentService),
    intelligence: app.get(IntelligenceService),
    scoring: app.get(ScoringService),
    personalization: app.get(PersonalizationService),
    outreach: app.get(OutreachService),
    sequences: app.get(SequenceService),
    suppression: app.get(SuppressionService),
    conversations: app.get(ConversationsService),
    campaigns: app.get(CampaignsService),
    leads: app.get(LeadsService),
    analytics: app.get(AnalyticsService),
  };
}
