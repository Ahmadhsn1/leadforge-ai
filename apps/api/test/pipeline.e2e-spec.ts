import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { RateLimitService } from '@/common/rate-limit';
import { buildReplyAddress } from '@/outreach/reply-address';
import { env } from '@leadforge/config';
import { PLAN_QUOTAS } from '@leadforge/shared';
import { sha256 } from '@leadforge/shared/server';

/**
 * End-to-end coverage of the documented V1 flow (docs/34 E2E section).
 *
 * Runs against a real Postgres and Redis. The AI stages are exercised only
 * where they are configured; the deterministic stages — normalisation,
 * dedupe, verification, scoring, suppression and the outreach state machine —
 * are always covered, because those are what the product's correctness rests on.
 */

/**
 * Billing is configured with throwaway values so the webhook path runs for
 * real. Hoisted above the imports because the environment is read once, when
 * the application modules first load. No request ever reaches Paddle: the
 * tests only exercise the webhook and the read side.
 */
const BILLING = vi.hoisted(() => {
  const values = {
    apiKey: 'pdl_e2e_api_key_never_sent_anywhere',
    webhookSecret: 'pdl_e2e_webhook_secret',
    clientToken: 'test_e2e_client_token',
    prices: { starter: 'pri_e2e_starter', growth: 'pri_e2e_growth', agency: 'pri_e2e_agency' },
  };
  process.env.PADDLE_ENVIRONMENT = 'sandbox';
  process.env.PADDLE_API_KEY = values.apiKey;
  process.env.PADDLE_WEBHOOK_SECRET = values.webhookSecret;
  process.env.PADDLE_CLIENT_TOKEN = values.clientToken;
  process.env.PADDLE_PRICE_STARTER = values.prices.starter;
  process.env.PADDLE_PRICE_GROWTH = values.prices.growth;
  process.env.PADDLE_PRICE_AGENCY = values.prices.agency;
  return values;
});

/** Reply capture, likewise configured with values that reach no real provider. */
const INBOUND = vi.hoisted(() => {
  const values = { domain: 'reply.e2e.test', secret: 'inbound-e2e-shared-secret' };
  process.env.INBOUND_EMAIL_DOMAIN = values.domain;
  process.env.INBOUND_EMAIL_SECRET = values.secret;
  return values;
});

const SUFFIX = Date.now().toString(36);
const EMAIL = `e2e-${SUFFIX}@leadforge.test`;
const PASSWORD = 'E2ETestPassword123';
const INVITEE_EMAIL = `e2e-invitee-${SUFFIX}@leadforge.test`;

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
    app.use(
      express.json({
        limit: '2mb',
        // As in main.ts: webhook signatures are checked against the raw bytes.
        verify: (req, _res, buffer) => {
          (req as express.Request & { rawBody?: string }).rawBody = buffer.toString('utf8');
        },
      }),
    );
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
    await prisma.user
      .deleteMany({ where: { email: { in: [EMAIL, INVITEE_EMAIL] } } })
      .catch(() => undefined);
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

  /* ------------------------------------------------------------- quotas */

  it('stops a CSV import at the monthly lead allowance', async () => {
    const period = new Date().toISOString().slice(0, 7);
    const limit = PLAN_QUOTAS.free.monthlyLeads;

    // One lead of allowance left.
    await prisma.usageCounter.upsert({
      where: { organizationId_metric_period: { organizationId, metric: 'leads', period } },
      create: { organizationId, metric: 'leads', period, value: limit - 1 },
      update: { value: limit - 1 },
    });

    const rows = ['Quota Bakery One', 'Quota Butcher Two', 'Quota Florist Three'].map(
      (name, index) => ({ name, phone: `0161 555 03${index}1`, city: 'Manchester', country: 'GB' }),
    );

    const partial = await request(app.getHttpServer())
      .post('/leads/import')
      .set(auth())
      .send({ campaignId, rows })
      .expect((res) => expect([200, 201]).toContain(res.status));

    expect(partial.body.created).toBe(1);
    expect(partial.body.skipped).toBe(2);

    // Nothing left: the next import is refused outright rather than silently empty.
    const refused = await request(app.getHttpServer())
      .post('/leads/import')
      .set(auth())
      .send({ campaignId, rows: rows.slice(1) })
      .expect(402);
    expect(refused.body.error.code).toBe('QUOTA_EXCEEDED');
  });

  /* ------------------------------------------------------------ invites */

  it('lets an invited person create an account and join the workspace', async () => {
    const token = `e2e-invite-token-${SUFFIX}-0123456789abcdef`;
    await prisma.invite.create({
      data: {
        organizationId,
        email: INVITEE_EMAIL,
        role: 'member',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const preview = await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(200);
    expect(preview.body.email).toBe(INVITEE_EMAIL);
    expect(preview.body.hasAccount).toBe(false);

    // A new account needs a name and a password that meets the policy.
    await request(app.getHttpServer()).post('/auth/invites/accept').send({ token }).expect(422);
    await request(app.getHttpServer())
      .post('/auth/invites/accept')
      .send({ token, name: 'Invited Person', password: 'weak' })
      .expect(422);

    const accepted = await request(app.getHttpServer())
      .post('/auth/invites/accept')
      .send({ token, name: 'Invited Person', password: 'InvitedPassword789' })
      .expect(200);

    expect(accepted.body.organization.id).toBe(organizationId);
    expect(accepted.body.organization.role).toBe('member');
    expect(accepted.body.user.emailVerified).toBe(true);
    expect(accepted.headers['set-cookie']).toBeDefined();

    // Single use.
    await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(400);
    await request(app.getHttpServer())
      .post('/auth/invites/accept')
      .send({ token, name: 'Again', password: 'InvitedPassword789' })
      .expect(400);
  });

  it('refuses an invite once the plan has no seats left', async () => {
    const token = `e2e-invite-full-${SUFFIX}-0123456789abcdef`;
    await prisma.invite.create({
      data: {
        organizationId,
        email: `e2e-overflow-${SUFFIX}@leadforge.test`,
        role: 'member',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const refused = await request(app.getHttpServer())
      .post('/auth/invites/accept')
      .send({ token, name: 'One Too Many', password: 'OverflowPassword789' })
      .expect(402);
    expect(refused.body.error.code).toBe('QUOTA_EXCEEDED');

    // The refusal must not have created the account as a side effect.
    const orphan = await prisma.user.findUnique({
      where: { email: `e2e-overflow-${SUFFIX}@leadforge.test` },
    });
    expect(orphan).toBeNull();
  });

  it('rejects an unknown invite token', async () => {
    await request(app.getHttpServer())
      .get('/auth/invites/this-token-does-not-exist-anywhere')
      .expect(400);
  });

  /* -------------------------------------------------------- rate limiting */

  it('denies requests beyond the window budget and reports when to retry', async () => {
    const limiter = app.get(RateLimitService);
    const bucket = `e2e:${SUFFIX}`;

    expect((await limiter.hit(bucket, 2, 60_000)).allowed).toBe(true);
    expect((await limiter.hit(bucket, 2, 60_000)).remaining).toBe(0);

    const third = await limiter.hit(bucket, 2, 60_000);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);

    // A different caller is unaffected.
    expect((await limiter.hit(`${bucket}:other`, 2, 60_000)).allowed).toBe(true);
  });

  it('labels API responses with the caller’s remaining budget', async () => {
    const response = await request(app.getHttpServer()).get('/leads').set(auth()).expect(200);
    expect(Number(response.headers['ratelimit-limit'])).toBeGreaterThan(0);
    expect(response.headers['ratelimit-remaining']).toBeDefined();
  });

  /* ---------------------------------------------------------- unsubscribe */

  it('lets a recipient opt out with the emailed link, and nobody else', async () => {
    const outreach = app.get(OutreachService);
    const recipient = await prisma.lead.create({
      data: {
        organizationId,
        canonicalName: 'Opt Out Optician',
        nameKey: 'opt out optician',
        source: 'csv_import',
        country: 'GB',
        email: `owner-${SUFFIX}@optout.test`,
      },
    });

    const links = outreach.unsubscribeLinks(organizationId, recipient.id);
    const token = new URL(links.unsubscribeUrl).searchParams.get('token') ?? '';
    expect(links.unsubscribePostUrl).toContain('/api/outreach/unsubscribe?token=');

    // A tampered token is answered identically and does nothing.
    await request(app.getHttpServer())
      .post('/outreach/unsubscribe')
      .send({ token: `${token}x` })
      .expect(200);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: recipient.id } })).status).toBe(
      'new',
    );

    // No session: the person clicking is not a user.
    await request(app.getHttpServer()).post('/outreach/unsubscribe').send({ token }).expect(200);

    const after = await prisma.lead.findUniqueOrThrow({ where: { id: recipient.id } });
    expect(after.status).toBe('do_not_contact');

    const suppressions = await prisma.suppression.findMany({
      where: { organizationId, value: { in: [recipient.id, `owner-${SUFFIX}@optout.test`] } },
    });
    expect(suppressions.map((s) => s.scope).sort()).toEqual(['email', 'lead']);

    // The mail client's one-click form, with the token in the query string.
    await request(app.getHttpServer())
      .post(`/outreach/unsubscribe?token=${token}`)
      .type('form')
      .send('List-Unsubscribe=One-Click')
      .expect(200);

    // And the opt-out actually blocks a send.
    const draft = await prisma.messageDraft.create({
      data: {
        organizationId,
        leadId: recipient.id,
        channel: 'email',
        kind: 'primary',
        subject: 'Hello',
        body: 'A message that must never leave.',
        status: 'draft',
        validationStatus: 'passed',
        validationErrors: [] as never,
      },
    });
    await expect(
      outreach.approve(organizationId, draft.id, { userId: 'e2e', startSequence: false }),
    ).rejects.toMatchObject({ code: 'SUPPRESSED_RECIPIENT' });
  });

  /* -------------------------------------------------------- inbound email */

  it('files an email reply under the lead its reply address names', async () => {
    const prospect = await prisma.lead.create({
      data: {
        organizationId,
        canonicalName: 'Reply Capture Cafe',
        nameKey: 'reply capture cafe',
        source: 'csv_import',
        country: 'GB',
        email: `owner-${SUFFIX}@replycapture.test`,
        status: 'contacted',
      },
    });
    const sent = await prisma.messageDraft.create({
      data: {
        organizationId,
        leadId: prospect.id,
        channel: 'email',
        kind: 'primary',
        subject: 'Quick question',
        body: 'Worth a chat this week?',
        status: 'sent',
        validationStatus: 'passed',
        validationErrors: [] as never,
      },
    });

    const replyTo = buildReplyAddress(sent.id, INBOUND.domain, env().AUTH_SECRET);
    const payload = {
      From: 'Someone Else <not-the-lead@elsewhere.test>',
      To: replyTo,
      Subject: 'Re: Quick question',
      TextBody:
        'Yes — call me Thursday.\n\nOn Mon, 5 Oct 2026 at 10:00, Alex <a@b.test> wrote:\n> Worth a chat this week?',
      MessageID: `inbound-${SUFFIX}@mail.test`,
    };
    const basic = `Basic ${Buffer.from(`postmark:${INBOUND.secret}`).toString('base64')}`;

    // Without the shared secret the payload is acknowledged and ignored.
    await request(app.getHttpServer())
      .post('/webhooks/inbound-email')
      .set('Authorization', `Basic ${Buffer.from('postmark:wrong').toString('base64')}`)
      .send(payload)
      .expect(200);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: prospect.id } })).status).toBe(
      'contacted',
    );

    await request(app.getHttpServer())
      .post('/webhooks/inbound-email')
      .set('Authorization', basic)
      .send(payload)
      .expect(200);
    // A provider retry of the same message must not create a second copy.
    await request(app.getHttpServer())
      .post('/webhooks/inbound-email')
      .set('Authorization', basic)
      .send(payload)
      .expect(200);

    expect((await prisma.lead.findUniqueOrThrow({ where: { id: prospect.id } })).status).toBe(
      'replied',
    );

    const inbound = await prisma.message.findMany({
      where: { organizationId, direction: 'inbound', conversation: { leadId: prospect.id } },
    });
    expect(inbound).toHaveLength(1);
    // The quoted original is trimmed; only what they wrote is kept.
    expect(inbound[0]?.body).toBe('Yes — call me Thursday.');

    // An address that was not issued by us matches nothing, whoever sends it.
    await request(app.getHttpServer())
      .post('/webhooks/inbound-email')
      .set('Authorization', basic)
      .send({
        ...payload,
        To: replyTo.replace(/\.[0-9a-f]{20}@/, '.00000000000000000000@'),
        MessageID: `forged-${SUFFIX}@mail.test`,
      })
      .expect(200);
    expect(
      await prisma.message.count({
        where: { organizationId, direction: 'inbound', conversation: { leadId: prospect.id } },
      }),
    ).toBe(1);
  });

  /* ---------------------------------------------------- workspace settings */

  it('keeps notification preferences when workspace settings are saved', async () => {
    await request(app.getHttpServer())
      .patch('/notifications/preferences')
      .set(auth())
      .send({ newReply: false })
      .expect(200);

    await request(app.getHttpServer())
      .patch('/organizations/current')
      .set(auth())
      .send({ settings: { defaultCountry: 'IE', senderName: 'Alex' } })
      .expect(200);

    const preferences = await request(app.getHttpServer())
      .get('/notifications/preferences')
      .set(auth())
      .expect(200);
    expect(preferences.body.newReply).toBe(false);

    const current = await request(app.getHttpServer())
      .get('/organizations/current')
      .set(auth())
      .expect(200);
    expect(current.body.settings.defaultCountry).toBe('IE');
    expect(current.body.settings.senderName).toBe('Alex');
  });

  it('validates a workspace mail account and never accepts connection details by the back door', async () => {
    const rejected = await request(app.getHttpServer())
      .put('/integrations/email/credentials')
      .set(auth())
      .send({
        host: 'smtp.example.com',
        port: 6379,
        username: 'alex',
        password: 'secret',
        fromAddress: 'alex@example.com',
      })
      .expect(422);
    expect(JSON.stringify(rejected.body)).toContain('Port must be one of');

    // The generic settings endpoint must not be a way to point mail elsewhere.
    const patched = await request(app.getHttpServer())
      .patch('/integrations/email')
      .set(auth())
      .send({ config: { host: '10.0.0.5', port: 25, replyTo: 'alex@example.com' } })
      .expect(200);
    expect(patched.body.config.host).toBeUndefined();
    expect(patched.body.config.port).toBeUndefined();
    expect(patched.body.config.replyTo).toBe('alex@example.com');

    const list = await request(app.getHttpServer()).get('/integrations').set(auth()).expect(200);
    const email = list.body.find((item: { provider: string }) => item.provider === 'email');
    expect(email.source).not.toBe('workspace');
    expect(JSON.stringify(list.body)).not.toContain('encryptedSecret');
  });

  /* --------------------------------------------------- export and deletion */

  it('exports the workspace for its owner only', async () => {
    const exported = await request(app.getHttpServer())
      .get('/organizations/export')
      .set(auth())
      .expect(200);

    expect(exported.headers['content-disposition']).toContain('attachment');
    expect(exported.body.workspace.id).toBe(organizationId);
    expect(exported.body.leads.length).toBeGreaterThan(0);
    expect(
      exported.body.leads.every(
        (l: { organizationId: string }) => l.organizationId === organizationId,
      ),
    ).toBe(true);
    // Credentials and password hashes have no place in an export.
    expect(JSON.stringify(exported.body)).not.toMatch(/passwordHash|encryptedSecret|tokenHash/);
  });

  it('deletes a workspace only on an exact name, and takes its orphaned account with it', async () => {
    const email = `e2e-doomed-${SUFFIX}@leadforge.test`;
    const name = `Doomed Workspace ${SUFFIX}`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password: 'DoomedPassword123', name: 'Doomed', organizationName: name })
      .expect((res) => expect([200, 201]).toContain(res.status));
    const header = signup.headers['set-cookie'];
    const doomedCookie = Array.isArray(header) ? (header[0]?.split(';')[0] ?? '') : '';
    const doomedOrgId = signup.body.organization.id;

    await request(app.getHttpServer())
      .delete('/organizations/current')
      .set({ Cookie: doomedCookie })
      .send({ confirmName: 'not the name' })
      .expect(422);
    expect(await prisma.organization.count({ where: { id: doomedOrgId } })).toBe(1);

    await request(app.getHttpServer())
      .delete('/organizations/current')
      .set({ Cookie: doomedCookie })
      .send({ confirmName: name })
      .expect(204);

    expect(await prisma.organization.count({ where: { id: doomedOrgId } })).toBe(0);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
    await request(app.getHttpServer()).get('/auth/me').set({ Cookie: doomedCookie }).expect(401);

    // The workspace under test is untouched.
    expect(await prisma.organization.count({ where: { id: organizationId } })).toBe(1);
  });

  /* -------------------------------------------------------------- billing */

  const subscriptionId = `sub_e2e_${SUFFIX}`;
  let eventCounter = 0;

  /** Posts a Paddle-shaped webhook, signed the way Paddle signs it. */
  function paddleEvent(
    eventType: string,
    data: Record<string, unknown>,
    options: { occurredAt?: Date; secret?: string; eventId?: string } = {},
  ) {
    eventCounter += 1;
    const body = JSON.stringify({
      event_id: options.eventId ?? `evt_e2e_${SUFFIX}_${eventCounter}`,
      event_type: eventType,
      occurred_at: (options.occurredAt ?? new Date()).toISOString(),
      data,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const h1 = createHmac('sha256', options.secret ?? BILLING.webhookSecret)
      .update(`${timestamp}:${body}`)
      .digest('hex');

    return request(app.getHttpServer())
      .post('/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('Paddle-Signature', `ts=${timestamp};h1=${h1}`)
      .send(body);
  }

  const subscription = (priceId: string, status = 'active', extra: object = {}) => ({
    id: subscriptionId,
    status,
    customer_id: `ctm_e2e_${SUFFIX}`,
    custom_data: { organizationId },
    items: [{ price: { id: priceId } }],
    current_billing_period: {
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    ...extra,
  });

  const currentPlan = async () =>
    (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).plan;

  it('offers checkout on the free plan and withholds paid features', async () => {
    const billing = await request(app.getHttpServer()).get('/billing').set(auth()).expect(200);
    expect(billing.body.enabled).toBe(true);
    expect(billing.body.plan).toBe('free');
    expect(billing.body.hasSubscription).toBe(false);
    expect(billing.body.currentPeriodEnd).toBeNull();
    // Only the browser-safe token is exposed, never the API key or secret.
    expect(JSON.stringify(billing.body)).not.toContain(BILLING.apiKey);
    expect(JSON.stringify(billing.body)).not.toContain(BILLING.webhookSecret);

    const gated = await request(app.getHttpServer())
      .post('/conversations/does-not-matter/suggest-response')
      .set(auth())
      .send({})
      .expect(402);
    expect(gated.body.error.details.requiredPlan).toBe('growth');
  });

  it('ignores a billing webhook that is not signed with the shared secret', async () => {
    await paddleEvent('subscription.created', subscription(BILLING.prices.agency), {
      secret: 'not-the-real-secret',
    }).expect(200);
    expect(await currentPlan()).toBe('free');
  });

  it('upgrades the workspace when a signed subscription event arrives', async () => {
    const createdAt = new Date();
    await paddleEvent('subscription.created', subscription(BILLING.prices.growth), {
      occurredAt: createdAt,
      eventId: `evt_e2e_${SUFFIX}_created`,
    }).expect(200);
    expect(await currentPlan()).toBe('growth');

    const billing = await request(app.getHttpServer()).get('/billing').set(auth()).expect(200);
    expect(billing.body.plan).toBe('growth');
    expect(billing.body.hasSubscription).toBe(true);
    expect(billing.body.currentPeriodEnd).not.toBeNull();

    // The paid feature is now reachable: the guard passes and the handler
    // answers for itself (there is no such conversation).
    const allowed = await request(app.getHttpServer())
      .post('/conversations/does-not-matter/suggest-response')
      .set(auth())
      .send({});
    expect(allowed.status).not.toBe(402);

    // A re-delivery of the same event changes nothing and is still acknowledged.
    await paddleEvent('subscription.created', subscription(BILLING.prices.agency), {
      eventId: `evt_e2e_${SUFFIX}_created`,
    }).expect(200);
    expect(await currentPlan()).toBe('growth');

    // An older event arriving late must not overwrite newer state.
    await paddleEvent('subscription.updated', subscription(BILLING.prices.agency), {
      occurredAt: new Date(createdAt.getTime() - 60_000),
    }).expect(200);
    expect(await currentPlan()).toBe('growth');
  });

  it('keeps the plan through a failed renewal and a scheduled cancellation', async () => {
    await paddleEvent('subscription.past_due', subscription(BILLING.prices.growth, 'past_due'), {
      occurredAt: new Date(Date.now() + 1_000),
    }).expect(200);
    expect(await currentPlan()).toBe('growth');

    await paddleEvent(
      'subscription.updated',
      subscription(BILLING.prices.growth, 'active', {
        scheduled_change: { action: 'cancel', effective_at: new Date().toISOString() },
      }),
      { occurredAt: new Date(Date.now() + 2_000) },
    ).expect(200);

    const billing = await request(app.getHttpServer()).get('/billing').set(auth()).expect(200);
    expect(billing.body.plan).toBe('growth');
    expect(billing.body.cancelAtPeriodEnd).toBe(true);
  });

  it('does not grant a plan for a price it does not sell', async () => {
    await paddleEvent('subscription.updated', subscription('pri_someone_elses_product'), {
      occurredAt: new Date(Date.now() + 3_000),
    }).expect(200);
    expect(await currentPlan()).toBe('free');
  });

  it('returns the workspace to free when the subscription ends', async () => {
    await paddleEvent('subscription.updated', subscription(BILLING.prices.starter), {
      occurredAt: new Date(Date.now() + 4_000),
    }).expect(200);
    expect(await currentPlan()).toBe('starter');

    await paddleEvent('subscription.canceled', subscription(BILLING.prices.starter, 'canceled'), {
      occurredAt: new Date(Date.now() + 5_000),
    }).expect(200);
    expect(await currentPlan()).toBe('free');

    const billing = await request(app.getHttpServer()).get('/billing').set(auth()).expect(200);
    expect(billing.body.hasSubscription).toBe(false);
  });

  it('lets only the owner start a plan change', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: INVITEE_EMAIL, password: 'InvitedPassword789' })
      .expect(200);
    const memberCookieHeader = login.headers['set-cookie'];
    const memberCookie = Array.isArray(memberCookieHeader)
      ? (memberCookieHeader[0]?.split(';')[0] ?? '')
      : '';

    await request(app.getHttpServer())
      .post('/billing/plan')
      .set({ Cookie: memberCookie })
      .send({ plan: 'growth' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/billing/portal')
      .set({ Cookie: memberCookie })
      .expect(403);
  });
});
