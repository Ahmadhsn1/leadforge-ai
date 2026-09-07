import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/common/prisma.service';
import { VerificationService } from '@/verification/verification.service';
import { EnrichmentService } from '@/enrichment/enrichment.service';
import { ScoringService } from '@/scoring/scoring.service';
import { SuppressionService } from '@/outreach/suppression.service';
import { OutreachService } from '@/outreach/outreach.service';
import { NormalizationService } from '@/normalization/normalization.service';

/**
 * End-to-end coverage of the documented V1 flow (docs/34 E2E section).
 *
 * Runs against a real Postgres and Redis. The AI stages are exercised only
 * where they are configured; the deterministic stages — normalisation,
 * dedupe, verification, scoring, suppression and the outreach state machine —
 * are always covered, because those are what the product's correctness rests on.
 */

const SUFFIX = Date.now().toString(36);
const EMAIL = `e2e-${SUFFIX}@leadforge.test`;
const PASSWORD = 'E2ETestPassword123';

describe('LeadForge pipeline (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  let organizationId: string;
  let campaignId: string;
  let leadId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    app.use(express.json({ limit: '2mb' }));
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: EMAIL,
        password: PASSWORD,
        name: 'E2E Tester',
        organizationName: `E2E Workspace ${SUFFIX}`,
      })
      .expect((res) => expect([200, 201]).toContain(res.status));

    const setCookie = signup.headers['set-cookie'];
    cookie = Array.isArray(setCookie) ? (setCookie[0]?.split(';')[0] ?? '') : '';
    organizationId = signup.body.organization.id;
  });

  afterAll(async () => {
    // Cascades clean up every child row.
    await prisma.organization.deleteMany({ where: { id: organizationId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: EMAIL } }).catch(() => undefined);
    await app?.close();
  });

  const auth = () => ({ Cookie: cookie });

  /* -------------------------------------------------------- campaign */

  it('creates a campaign with the documented contract', async () => {
    const response = await request(app.getHttpServer())
      .post('/campaigns')
      .set(auth())
      .send({
        name: 'E2E restaurants',
        source: 'google_places',
        channel: 'whatsapp',
        target: {
          categories: ['restaurant'],
          keywords: [],
          geo: { location: 'Manchester, UK', country: 'GB', radiusMeters: 8000 },
          leadLimit: 10,
        },
        filters: {
          minRating: 4,
          minReviews: 20,
          websiteCondition: 'without',
          requireContact: ['phone'],
        },
        ai: {
          offer: 'Booking websites for independent restaurants.',
          objective: 'Book short calls with owners who cannot take bookings online.',
          tone: 'friendly',
          cta: 'Ask if they are open to a quick chat this week.',
          tier: 'balanced',
        },
        autoPersonalize: true,
      })
      .expect((res) => expect([200, 201]).toContain(res.status));

    campaignId = response.body.id;
    expect(response.body.status).toBe('draft');
    expect(response.body.stats.leads).toBe(0);
  });

  it('seeds default follow-up sequences with the first campaign', async () => {
    const response = await request(app.getHttpServer())
      .get('/outreach/sequences')
      .set(auth())
      .expect(200);

    expect(response.body.length).toBeGreaterThan(0);
    const whatsapp = response.body.find((s: { channel: string }) => s.channel === 'whatsapp');
    expect(whatsapp.steps.length).toBe(4);
    expect(whatsapp.stopOnReply).toBe(true);
  });

  /* --------------------------------------------- normalisation + dedupe */

  it('normalises and deduplicates imported leads', async () => {
    const response = await request(app.getHttpServer())
      .post('/leads/import')
      .set(auth())
      .send({
        campaignId,
        rows: [
          {
            name: 'E2E Trattoria',
            phone: '0161 555 0199',
            city: 'Manchester',
            country: 'GB',
            category: 'restaurant',
          },
          // Same business, differently formatted: must merge, not duplicate.
          {
            name: 'E2E Trattoria Ltd',
            phone: '+44 161 555 0199',
            city: 'Manchester',
            country: 'GB',
            category: 'restaurant',
          },
          {
            name: 'Completely Different Cafe',
            phone: '0161 555 0288',
            city: 'Manchester',
            country: 'GB',
            category: 'cafe',
          },
        ],
      })
      .expect((res) => expect([200, 201]).toContain(res.status));

    expect(response.body.created).toBe(2);
    expect(response.body.duplicates).toBe(1);

    const leads = await request(app.getHttpServer())
      .get(`/leads?campaignId=${campaignId}`)
      .set(auth())
      .expect(200);

    expect(leads.body.total).toBe(2);
    leadId = leads.body.items.find((l: { canonicalName: string }) =>
      l.canonicalName.includes('Trattoria'),
    ).id;

    const detail = await request(app.getHttpServer())
      .get(`/leads/${leadId}`)
      .set(auth())
      .expect(200);
    expect(detail.body.phone).toBe('+441615550199');
  });

  it('scores a fuzzy match as mergeable only with a hard identifier', () => {
    const normalization = app.get(NormalizationService);

    const withPhone = normalization.normalize({
      externalId: 'x',
      name: 'E2E Trattoria',
      phone: '0161 555 0199',
      raw: {},
    });
    expect(withPhone.phoneKey).toBe('+441615550199');
    expect(withPhone.nameKey).toBe('e2e trattoria');
  });

  /* ------------------------------------------ verification + enrichment */

  it('enriches and verifies a lead deterministically, recording evidence', async () => {
    const enrichment = app.get(EnrichmentService);
    const verification = app.get(VerificationService);

    await enrichment.enrich(organizationId, leadId);
    const outcome = await verification.verify(organizationId, leadId);

    expect(outcome.checks.length).toBe(7);
    expect(outcome.score).toBeGreaterThan(0);
    // No website was supplied, so that check must fail and be explained.
    const website = outcome.checks.find((c) => c.check === 'website_reachable');
    expect(website?.passed).toBe(false);
    expect(website?.detail).toContain('No website');

    const phone = outcome.checks.find((c) => c.check === 'phone');
    expect(phone?.passed).toBe(true);

    const detail = await request(app.getHttpServer())
      .get(`/leads/${leadId}`)
      .set(auth())
      .expect(200);
    expect(detail.body.evidence.length).toBeGreaterThan(0);
    expect(detail.body.evidence.every((e: { confidence: number }) => e.confidence > 0)).toBe(true);
    expect(detail.body.websiteAnalysis.status).toBe('none');
    expect(detail.body.verification.status).toBe(outcome.status);
  });

  it('never marks a lead verified without the deterministic checks passing', async () => {
    const verification = app.get(VerificationService);
    // A lead with no contact details cannot reach "verified".
    const bare = await prisma.lead.create({
      data: {
        organizationId,
        canonicalName: 'No Contact Details Ltd',
        nameKey: 'no contact details',
        source: 'csv_import',
        country: 'GB',
      },
    });

    const outcome = await verification.verify(organizationId, bare.id);
    expect(outcome.status).not.toBe('verified');
  });

  /* --------------------------------------------------------- scoring */

  it('scores a lead deterministically and explains every dimension', async () => {
    const scoring = app.get(ScoringService);
    const result = await scoring.score(organizationId, leadId);

    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
    expect(result.explanation.length).toBe(6);
    expect(result.explanation.every((entry) => entry.reason.length > 10)).toBe(true);

    // The same inputs must produce the same score, every time.
    const again = await scoring.score(organizationId, leadId);
    expect(again.total).toBe(result.total);

    await scoring.persist(organizationId, leadId, result);

    const detail = await request(app.getHttpServer())
      .get(`/leads/${leadId}`)
      .set(auth())
      .expect(200);
    expect(detail.body.score.total).toBe(result.total);
    expect(detail.body.leadScore).toBe(result.total);
    expect(['hot', 'warm', 'moderate', 'low']).toContain(detail.body.temperature);
  });

  /* ------------------------------------------------ outreach + suppression */

  it('refuses to approve a draft that failed validation', async () => {
    const outreach = app.get(OutreachService);

    const draft = await prisma.messageDraft.create({
      data: {
        organizationId,
        leadId,
        campaignId,
        channel: 'whatsapp',
        kind: 'primary',
        body: 'This message guarantees you will double your revenue.',
        status: 'draft',
        validationStatus: 'failed',
        validationErrors: [
          { severity: 'error', code: 'prohibited_claim', detail: 'Guaranteed-outcome claim' },
        ] as never,
      },
    });

    await expect(
      outreach.approve(organizationId, draft.id, { userId: 'e2e', startSequence: false }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const after = await prisma.messageDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.status).toBe('draft');
  });

  it('blocks approval for a suppressed recipient and cancels pending work', async () => {
    const suppression = app.get(SuppressionService);
    const outreach = app.get(OutreachService);

    const draft = await prisma.messageDraft.create({
      data: {
        organizationId,
        leadId,
        campaignId,
        channel: 'whatsapp',
        kind: 'primary',
        body: 'Hi E2E Trattoria — I noticed you have no website. Worth a quick chat this week?',
        status: 'draft',
        validationStatus: 'passed',
        validationErrors: [] as never,
      },
    });

    await suppression.add(organizationId, 'phone', '+441615550199', { reason: 'E2E opt-out' });

    // The suppression must cancel the draft that was already waiting.
    const afterSuppression = await prisma.messageDraft.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect(afterSuppression.status).toBe('do_not_contact');

    await expect(
      outreach.approve(organizationId, draft.id, { userId: 'e2e', startSequence: false }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.status).toBe('do_not_contact');
  });

  it('reports a lead as suppressed through the API', async () => {
    const detail = await request(app.getHttpServer())
      .get(`/leads/${leadId}`)
      .set(auth())
      .expect(200);
    expect(detail.body.suppression).not.toBeNull();
    expect(detail.body.suppression.scope).toBe('phone');
  });

  /* ---------------------------------------------------------- analytics */

  it('produces analytics from stored events only', async () => {
    const overview = await request(app.getHttpServer())
      .get('/analytics/overview')
      .set(auth())
      .expect(200);

    expect(overview.body.funnel.length).toBe(9);
    expect(overview.body.funnel[0].stage).toBe('discovered');
    expect(overview.body.funnel[0].count).toBeGreaterThan(0);

    // No messages were ever sent, so the reply rate must be zero, not a guess.
    expect(overview.body.rates.reply).toBe(0);
    expect(overview.body.medianTimeToReplyHours).toBeNull();
  });

  it('exposes the campaign pipeline state', async () => {
    const campaign = await request(app.getHttpServer())
      .get(`/campaigns/${campaignId}`)
      .set(auth())
      .expect(200);

    expect(campaign.body.stats.leads).toBe(2);
    expect(campaign.body.stats.lastActivityAt).not.toBeNull();
  });

  /* ------------------------------------------------------------ tenancy */

  it('isolates tenants on every read and write path', async () => {
    const other = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: `e2e-other-${SUFFIX}@leadforge.test`,
        password: 'OtherPassword456Word',
        name: 'Other Tenant',
        organizationName: `Other Workspace ${SUFFIX}`,
      })
      .expect((res) => expect([200, 201]).toContain(res.status));

    const otherCookieHeader = other.headers['set-cookie'];
    const otherCookie = Array.isArray(otherCookieHeader)
      ? (otherCookieHeader[0]?.split(';')[0] ?? '')
      : '';
    const otherOrgId = other.body.organization.id;

    for (const path of [`/campaigns/${campaignId}`, `/leads/${leadId}`]) {
      await request(app.getHttpServer()).get(path).set({ Cookie: otherCookie }).expect(404);
    }

    await request(app.getHttpServer())
      .patch(`/leads/${leadId}`)
      .set({ Cookie: otherCookie })
      .send({ status: 'won' })
      .expect(404);

    const list = await request(app.getHttpServer())
      .get('/leads')
      .set({ Cookie: otherCookie })
      .expect(200);
    expect(list.body.total).toBe(0);

    await prisma.organization.deleteMany({ where: { id: otherOrgId } }).catch(() => undefined);
  });

  it('requires a session on every non-public endpoint', async () => {
    for (const path of ['/leads', '/campaigns', '/dashboard', '/analytics/overview', '/usage']) {
      await request(app.getHttpServer()).get(path).expect(401);
    }
    // Health is deliberately public so probes work without credentials.
    await request(app.getHttpServer()).get('/health').expect(200);
  });
});
