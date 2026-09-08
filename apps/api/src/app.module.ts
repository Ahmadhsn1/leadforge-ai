import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { PrismaService } from './common/prisma.service';
import { MailService } from './common/mail.service';
import { EvidenceService } from './common/evidence.service';
import { SafeFetchService } from './common/safe-fetch.service';
import {
  AppExceptionFilter,
  RequestContextMiddleware,
  RequestLoggingInterceptor,
} from './common/http';

import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';

import { AuditService } from './organizations/audit.service';
import { OrganizationsController } from './organizations/organizations.controller';

import { QueueService } from './jobs/queue.service';

import { AiService } from './ai/ai.service';

import { GooglePlacesAdapter } from './discovery/adapters/google-places.adapter';
import { OverpassAdapter } from './discovery/adapters/overpass.adapter';
import { NormalizationService } from './normalization/normalization.service';
import { VerificationService } from './verification/verification.service';
import { EnrichmentService } from './enrichment/enrichment.service';
import { ScoringService } from './scoring/scoring.service';
import { IntelligenceService } from './intelligence/intelligence.service';
import { MessageValidator } from './personalization/message-validator';
import { PersonalizationService } from './personalization/personalization.service';

import { WhatsAppAdapter } from './outreach/adapters/whatsapp.adapter';
import { InstagramAdapter } from './outreach/adapters/instagram.adapter';
import { EmailAdapter } from './outreach/adapters/email.adapter';
import { ManualAdapter } from './outreach/adapters/manual.adapter';
import { SuppressionService } from './outreach/suppression.service';
import { SequenceService } from './outreach/sequence.service';
import { OutreachService } from './outreach/outreach.service';
import { OutreachController } from './outreach/outreach.controller';

import { ConversationsService } from './conversations/conversations.service';
import { ConversationsController } from './conversations/conversations.controller';

import { CampaignsService } from './campaigns/campaigns.service';
import { CampaignsController } from './campaigns/campaigns.controller';
import { LeadsService } from './leads/leads.service';
import { LeadsController } from './leads/leads.controller';

import { AnalyticsService } from './analytics/analytics.service';
import { AnalyticsController } from './analytics/analytics.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { IntegrationsController } from './integrations/integrations.controller';
import { MiscController } from './search/misc.controller';
import { HealthController } from './health/health.controller';
import { WebhooksController } from './webhooks/webhooks.controller';

/**
 * Application root.
 *
 * Deliberately a single module: the domain services form one tightly connected
 * graph (personalisation needs intelligence needs scoring needs evidence), and
 * splitting them into feature modules would mean re-exporting almost everything
 * from almost everywhere. Boundaries are enforced by directory and by service
 * responsibility, per docs/07.
 *
 * The pipeline services are exported so the worker can build the same graph.
 */
@Module({
  controllers: [
    AuthController,
    OrganizationsController,
    CampaignsController,
    LeadsController,
    OutreachController,
    ConversationsController,
    AnalyticsController,
    DashboardController,
    IntegrationsController,
    MiscController,
    HealthController,
    WebhooksController,
  ],
  providers: [
    // Infrastructure
    PrismaService,
    MailService,
    EvidenceService,
    SafeFetchService,
    QueueService,
    AuditService,

    // Identity
    AuthService,

    // AI
    AiService,

    // Pipeline
    GooglePlacesAdapter,
    OverpassAdapter,
    NormalizationService,
    VerificationService,
    EnrichmentService,
    ScoringService,
    IntelligenceService,
    MessageValidator,
    PersonalizationService,

    // Outreach
    WhatsAppAdapter,
    InstagramAdapter,
    EmailAdapter,
    ManualAdapter,
    SuppressionService,
    SequenceService,
    OutreachService,

    // Domain
    ConversationsService,
    CampaignsService,
    LeadsService,
    AnalyticsService,

    // Cross-cutting: protected by default, one error shape, one request log.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
  exports: [
    PrismaService,
    MailService,
    EvidenceService,
    SafeFetchService,
    QueueService,
    AuditService,
    AiService,
    GooglePlacesAdapter,
    OverpassAdapter,
    NormalizationService,
    VerificationService,
    EnrichmentService,
    ScoringService,
    IntelligenceService,
    PersonalizationService,
    SuppressionService,
    SequenceService,
    OutreachService,
    ConversationsService,
    CampaignsService,
    LeadsService,
    AnalyticsService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
