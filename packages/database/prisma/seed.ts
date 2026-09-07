/**
 * Development seed.
 *
 * Creates one workspace with a realistic slice of the pipeline so every screen
 * has something true to render: leads at different stages, evidence behind
 * every claim, an analysed lead with a score, drafts in the approval queue, and
 * a live conversation.
 *
 * This is development data, clearly marked as such. It never runs against a
 * production database (guarded below) and it is idempotent.
 */
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

loadDotenv({ path: path.join(__dirname, '..', '..', '..', '.env') });

const prisma = new PrismaClient();

const SEED_EMAIL = process.env.SEED_EMAIL ?? 'demo@leadforge.local';
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'LeadForgeDemo123';
const SEED_ORG = 'TractionX Digital';

async function main(): Promise<void> {
  if (process.env.APP_ENV === 'production') {
    throw new Error('Refusing to seed a production database.');
  }

  console.log('Seeding LeadForge development data...');

  /* ------------------------------------------------------------ workspace */

  const passwordHash = await argon2.hash(SEED_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const user = await prisma.user.upsert({
    where: { email: SEED_EMAIL },
    create: { email: SEED_EMAIL, passwordHash, name: 'Alex Rivera', emailVerified: true },
    update: { passwordHash, emailVerified: true },
  });

  const organization = await prisma.organization.upsert({
    where: { slug: 'tractionx-digital' },
    create: {
      name: SEED_ORG,
      slug: 'tractionx-digital',
      plan: 'growth',
      settings: { defaultCountry: 'GB', senderName: 'Alex', senderCompany: SEED_ORG },
      memberships: { create: { userId: user.id, role: 'owner' } },
      subscription: {
        create: {
          plan: 'growth',
          status: 'active',
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      },
    },
    update: { plan: 'growth' },
  });

  const orgId = organization.id;

  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: orgId } },
    create: { userId: user.id, organizationId: orgId, role: 'owner' },
    update: {},
  });

  /* ------------------------------------------------------------- sequence */

  const existingSequence = await prisma.outreachSequence.findFirst({
    where: { organizationId: orgId, channel: 'whatsapp' },
  });

  const sequence =
    existingSequence ??
    (await prisma.outreachSequence.create({
      data: {
        organizationId: orgId,
        name: 'Standard whatsapp follow-up',
        description: 'Four touches over roughly two weeks, stopping the moment they reply.',
        channel: 'whatsapp',
        active: true,
        isDefault: true,
        stopOnReply: true,
        stopOnPositive: true,
        steps: {
          create: [
            { order: 1, kind: 'primary', delayHours: 0 },
            {
              order: 2,
              kind: 'follow_up_1',
              delayHours: 72,
              guidance: 'Brief nudge referencing the first message.',
            },
            {
              order: 3,
              kind: 'follow_up_2',
              delayHours: 96,
              guidance: 'Add one concrete piece of value or proof.',
            },
            {
              order: 4,
              kind: 'final',
              delayHours: 120,
              guidance: 'Polite close-out; make it easy to say no.',
            },
          ],
        },
      },
    }));

  /* ------------------------------------------------------------- campaign */

  const campaign = await prisma.campaign.upsert({
    where: {
      id:
        (await prisma.campaign.findFirst({ where: { organizationId: orgId } }))?.id ?? 'seed-none',
    },
    create: {
      organizationId: orgId,
      name: 'Manchester restaurants without a website',
      description: 'Well-reviewed independents with strong demand and nowhere to send it.',
      status: 'completed',
      source: 'google_places',
      channel: 'whatsapp',
      target: {
        categories: ['restaurant', 'bistro'],
        keywords: ['italian'],
        geo: { location: 'Manchester, UK', country: 'GB', radiusMeters: 10_000 },
        leadLimit: 100,
      },
      filters: {
        minRating: 4,
        minReviews: 25,
        websiteCondition: 'without',
        socialCondition: 'any',
        requireContact: ['phone'],
        excludeChains: true,
        excludeKeywords: [],
        customRules: ['Independent, owner-operated'],
      },
      aiSettings: {
        offer:
          'Fast, mobile-first restaurant websites with online booking and a menu the owner can update themselves.',
        objective:
          'Book 15-minute calls with independent restaurant owners who have strong reviews but no way to take bookings online.',
        tone: 'friendly',
        cta: 'Ask if they are open to a quick chat this week.',
        senderName: 'Alex',
        senderCompany: SEED_ORG,
        tier: 'balanced',
      },
      autoPersonalize: true,
      sequenceId: sequence.id,
      createdById: user.id,
    },
    update: {},
  });

  await prisma.campaignRun.deleteMany({ where: { campaignId: campaign.id } });
  await prisma.campaignRun.create({
    data: {
      organizationId: orgId,
      campaignId: campaign.id,
      status: 'completed',
      stage: 'done',
      leadLimit: 100,
      candidatesDiscovered: 58,
      pagesFetched: 3,
      leadsCreated: 4,
      duplicatesFound: 2,
      leadsVerified: 4,
      leadsEnriched: 4,
      leadsAnalyzed: 2,
      leadsScored: 4,
      draftsGenerated: 3,
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      finishedAt: new Date(Date.now() - 90 * 60 * 1000),
    },
  });

  /* ---------------------------------------------------------------- leads */

  const leadSeeds = [
    {
      name: "Mario's Italian Kitchen",
      externalId: 'seed_place_mario',
      category: 'Italian restaurant',
      city: 'Manchester',
      phone: '+441612345678',
      website: null as string | null,
      websiteStatus: 'none' as const,
      rating: 4.6,
      reviewCount: 412,
      score: 92,
      temperature: 'hot' as const,
      status: 'ready' as const,
      instagram: 'mariositaliankitchen',
      analysed: true,
    },
    {
      name: 'The Bloom Bistro',
      externalId: 'seed_place_bloom',
      category: 'Bistro',
      city: 'Manchester',
      phone: '+441619876543',
      website: 'https://thebloombistro-example.co.uk',
      websiteStatus: 'broken' as const,
      rating: 4.4,
      reviewCount: 168,
      score: 81,
      temperature: 'warm' as const,
      status: 'contacted' as const,
      instagram: 'thebloombistro',
      analysed: true,
    },
    {
      name: 'Northern Quarter Pizza Co',
      externalId: 'seed_place_nqpizza',
      category: 'Pizza restaurant',
      city: 'Manchester',
      phone: '+441613334444',
      website: 'https://nqpizza-example.co.uk',
      websiteStatus: 'active' as const,
      rating: 4.2,
      reviewCount: 96,
      score: 67,
      temperature: 'moderate' as const,
      status: 'qualified' as const,
      instagram: null,
      analysed: false,
    },
    {
      name: 'Didsbury Deli',
      externalId: 'seed_place_didsbury',
      category: 'Delicatessen',
      city: 'Manchester',
      phone: null,
      website: null,
      websiteStatus: 'none' as const,
      rating: 4.8,
      reviewCount: 34,
      score: 54,
      temperature: 'low' as const,
      status: 'new' as const,
      instagram: null,
      analysed: false,
    },
  ];

  const leadIds: Record<string, string> = {};

  for (const seed of leadSeeds) {
    const nameKey = seed.name
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const lead = await prisma.lead.upsert({
      where: {
        lead_source_identity: {
          organizationId: orgId,
          source: 'google_places',
          sourceExternalId: seed.externalId,
        },
      },
      create: {
        organizationId: orgId,
        canonicalName: seed.name,
        nameKey,
        category: seed.category,
        categoryKey: seed.category.toLowerCase(),
        address: `${Math.floor(Math.random() * 90) + 10} High Street, ${seed.city}`,
        city: seed.city,
        region: 'Greater Manchester',
        country: 'GB',
        latitude: 53.4808 + (Math.random() - 0.5) * 0.05,
        longitude: -2.2426 + (Math.random() - 0.5) * 0.05,
        phone: seed.phone,
        phoneKey: seed.phone,
        website: seed.website,
        domainKey: seed.website ? new URL(seed.website).hostname.replace(/^www\./, '') : null,
        rating: seed.rating,
        reviewCount: seed.reviewCount,
        source: 'google_places',
        sourceExternalId: seed.externalId,
        sourceUrl: `https://maps.google.com/?cid=${seed.externalId}`,
        verificationStatus: seed.phone ? 'verified' : 'needs_review',
        verificationScore: seed.phone ? 88 : 55,
        contactabilityScore: seed.phone ? 70 : 25,
        leadScore: seed.score,
        temperature: seed.temperature,
        websiteStatus: seed.websiteStatus,
        status: seed.status,
        verifiedAt: new Date(),
        enrichedAt: new Date(),
        ...(seed.analysed
          ? { analyzedAt: new Date(), scoredAt: new Date() }
          : { scoredAt: new Date() }),
      },
      update: { leadScore: seed.score, temperature: seed.temperature, status: seed.status },
    });

    leadIds[seed.externalId] = lead.id;

    await prisma.campaignLeadLink.upsert({
      where: { campaignId_leadId: { campaignId: campaign.id, leadId: lead.id } },
      create: { organizationId: orgId, campaignId: campaign.id, leadId: lead.id },
      update: {},
    });

    /* Evidence — every claim below traces to one of these. */
    const evidence = [
      {
        type: 'source_record' as const,
        statement: `Listed on Google Places with a ${seed.rating.toFixed(1)} rating from ${seed.reviewCount} reviews.`,
        source: 'google_places',
        confidence: 0.98,
      },
      {
        type: 'rating' as const,
        statement: `Rated ${seed.rating.toFixed(1)} out of 5 across ${seed.reviewCount} public reviews.`,
        source: 'google_places',
        confidence: 0.95,
      },
      {
        type: 'website' as const,
        statement:
          seed.websiteStatus === 'none'
            ? 'No dedicated website detected on the business listing or by resolution.'
            : seed.websiteStatus === 'broken'
              ? 'The listed website does not load: the site did not respond within the allowed time.'
              : 'Website is live and responded with HTTP 200.',
        source: seed.website ? 'website_fetch' : 'google_places',
        confidence: 0.95,
      },
      {
        type: 'contact' as const,
        statement: seed.phone
          ? 'A valid GB phone number is on record.'
          : 'No phone number is published for this business.',
        source: 'google_places',
        confidence: seed.phone ? 0.95 : 0.85,
      },
      ...(seed.instagram
        ? [
            {
              type: 'social' as const,
              statement: 'Public profiles linked from the listing: instagram.',
              source: 'google_places',
              confidence: 0.9,
            },
          ]
        : []),
      ...(seed.websiteStatus === 'active'
        ? [
            {
              type: 'website' as const,
              statement: 'No booking or appointment path found on the website.',
              source: 'website_fetch',
              confidence: 0.85,
            },
          ]
        : []),
    ];

    for (const item of evidence) {
      await prisma.evidence.upsert({
        where: {
          leadId_type_statement: { leadId: lead.id, type: item.type, statement: item.statement },
        },
        create: { organizationId: orgId, leadId: lead.id, ...item, data: {} },
        update: {},
      });
    }

    if (seed.instagram) {
      await prisma.socialProfile.upsert({
        where: {
          leadId_platform_profileUrl: {
            leadId: lead.id,
            platform: 'instagram',
            profileUrl: `https://instagram.com/${seed.instagram}`,
          },
        },
        create: {
          organizationId: orgId,
          leadId: lead.id,
          platform: 'instagram',
          profileUrl: `https://instagram.com/${seed.instagram}`,
          username: seed.instagram,
          status: 'found',
          source: 'google_places',
        },
        update: {},
      });
    }

    await prisma.websiteAnalysis.upsert({
      where: { leadId: lead.id },
      create: {
        organizationId: orgId,
        leadId: lead.id,
        url: seed.website,
        finalUrl: seed.website,
        status: seed.websiteStatus,
        httpStatus:
          seed.websiteStatus === 'active' ? 200 : seed.websiteStatus === 'broken' ? 522 : null,
        isHttps: Boolean(seed.website),
        responseTimeMs: seed.websiteStatus === 'active' ? 640 : null,
        title: seed.websiteStatus === 'active' ? seed.name : null,
        hasContactPage: seed.websiteStatus === 'active',
        hasBookingCta: false,
        hasMenuOrServices: seed.websiteStatus === 'active',
        hasConversionCta: false,
        hasViewport: seed.websiteStatus === 'active',
        identityMatch: seed.websiteStatus === 'active',
        opportunitySignals:
          seed.websiteStatus === 'none'
            ? ['No dedicated website detected']
            : seed.websiteStatus === 'broken'
              ? ['Listed website does not load']
              : ['No booking or appointment path', 'No visible conversion call to action'],
        confidence: 0.92,
        checkedAt: new Date(),
      },
      update: {},
    });

    /* Verification record. */
    await prisma.verificationRecord.create({
      data: {
        organizationId: orgId,
        leadId: lead.id,
        status: seed.phone ? 'verified' : 'needs_review',
        score: seed.phone ? 88 : 55,
        checks: [
          {
            check: 'identity',
            passed: true,
            weight: 0.2,
            detail: 'Named business with a resolvable location.',
          },
          { check: 'freshness', passed: true, weight: 0.1, detail: 'Source record fetched today.' },
          {
            check: 'phone',
            passed: Boolean(seed.phone),
            weight: 0.2,
            detail: seed.phone
              ? `Phone normalises to ${seed.phone}.`
              : 'No phone number on record.',
          },
          {
            check: 'website_reachable',
            passed: seed.websiteStatus === 'active',
            weight: 0.2,
            detail:
              seed.websiteStatus === 'none'
                ? 'No website listed for this business.'
                : seed.websiteStatus === 'broken'
                  ? 'Site did not resolve to a healthy page.'
                  : 'Site responded with HTTP 200.',
          },
          {
            check: 'domain_match',
            passed: seed.websiteStatus === 'active',
            weight: 0.1,
            detail: seed.website ? 'Domain matches the business name.' : 'No website to match.',
          },
          {
            check: 'geography',
            passed: true,
            weight: 0.1,
            detail: 'Located in the targeted country (GB).',
          },
          {
            check: 'not_duplicate',
            passed: true,
            weight: 0.1,
            detail: 'Canonical record for the business.',
          },
        ],
      },
    });

    /* Score. */
    await prisma.leadScore.upsert({
      where: { leadId_version: { leadId: lead.id, version: 1 } },
      create: {
        organizationId: orgId,
        leadId: lead.id,
        version: 1,
        total: seed.score,
        fit: Math.min(100, seed.score + 3),
        opportunity: Math.min(100, seed.score + 6),
        contactability: seed.phone ? 85 : 25,
        maturity: Math.min(100, 40 + Math.round(seed.reviewCount / 8)),
        confidence: 90,
        urgency: seed.websiteStatus === 'none' ? 86 : 60,
        explanation: [
          {
            dimension: 'fit',
            value: Math.min(100, seed.score + 3),
            reason: `Rating ${seed.rating.toFixed(1)} and ${seed.reviewCount} reviews clear the campaign thresholds; website status "${seed.websiteStatus}" matches the target.`,
          },
          {
            dimension: 'opportunity',
            value: Math.min(100, seed.score + 6),
            reason:
              seed.websiteStatus === 'none'
                ? 'No website at all — the largest possible digital gap, with demand already proven by review volume.'
                : 'Observable gaps on the live site leave room for a concrete improvement.',
          },
          {
            dimension: 'contactability',
            value: seed.phone ? 85 : 25,
            reason: seed.phone
              ? 'Reachable by phone and WhatsApp.'
              : 'No direct contact route on record.',
          },
          {
            dimension: 'maturity',
            value: Math.min(100, 40 + Math.round(seed.reviewCount / 8)),
            reason: `${seed.reviewCount} reviews indicate an established business.`,
          },
          {
            dimension: 'confidence',
            value: 90,
            reason: 'Multiple independent observations, all recent and high confidence.',
          },
          {
            dimension: 'urgency',
            value: seed.websiteStatus === 'none' ? 86 : 60,
            reason:
              seed.websiteStatus === 'none'
                ? 'High demand with nowhere to send it.'
                : 'No particular timing signal either way.',
          },
        ],
        method: 'deterministic',
        weights: {
          fit: 0.25,
          opportunity: 0.25,
          contactability: 0.15,
          maturity: 0.1,
          confidence: 0.15,
          urgency: 0.1,
        },
      },
      update: {},
    });

    /* Activity trail. */
    await prisma.activity.createMany({
      data: [
        {
          organizationId: orgId,
          leadId: lead.id,
          campaignId: campaign.id,
          type: 'discovered',
          summary: 'Discovered via google places.',
          actor: 'system',
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
        {
          organizationId: orgId,
          leadId: lead.id,
          campaignId: campaign.id,
          type: 'verified',
          summary: `Verification ${seed.phone ? 'verified' : 'needs_review'} (${seed.phone ? 88 : 55}/100).`,
          actor: 'system',
          createdAt: new Date(Date.now() - 110 * 60 * 1000),
        },
        {
          organizationId: orgId,
          leadId: lead.id,
          campaignId: campaign.id,
          type: 'scored',
          summary: `Scored ${seed.score}/100 (${seed.temperature}).`,
          actor: 'system',
          createdAt: new Date(Date.now() - 95 * 60 * 1000),
        },
      ],
      skipDuplicates: true,
    });
  }

  /* -------------------------------------------------- analysis + drafts */

  const marioId = leadIds.seed_place_mario;
  const bloomId = leadIds.seed_place_bloom;

  if (marioId) {
    const evidenceIds = (
      await prisma.evidence.findMany({
        where: { leadId: marioId },
        select: { id: true, type: true },
      })
    ).reduce<Record<string, string>>((acc, item) => ({ ...acc, [item.type]: item.id }), {});

    await prisma.intelligenceReport.upsert({
      where: { leadId_version: { leadId: marioId, version: 1 } },
      create: {
        organizationId: orgId,
        leadId: marioId,
        version: 1,
        summary:
          "Mario's Italian Kitchen has built a strong local reputation — 412 reviews at 4.6 is well above what an independent restaurant typically accumulates. That demand currently has nowhere to go online: there is no dedicated website, so every booking depends on a phone call during service hours.",
        strengths: [
          'Exceptional review volume for an independent restaurant',
          'Consistently high rating suggests reliable delivery',
          'Active public Instagram presence',
        ],
        painPoints: [
          {
            statement:
              'No dedicated website, so prospective customers researching the restaurant have nothing to land on beyond the listing.',
            evidenceIds: [evidenceIds.website].filter(Boolean),
            confidence: 0.96,
          },
          {
            statement:
              'Bookings depend entirely on a phone call, which cannot be answered during a busy service.',
            evidenceIds: [evidenceIds.contact, evidenceIds.website].filter(Boolean),
            confidence: 0.84,
          },
        ],
        opportunities: [
          {
            statement:
              'A simple booking-first website would convert existing local interest into confirmed covers without adding phone load.',
            evidenceIds: [evidenceIds.website, evidenceIds.rating].filter(Boolean),
            confidence: 0.91,
          },
          {
            statement:
              'The existing Instagram audience could be pointed at a bookable page rather than a phone number.',
            evidenceIds: [evidenceIds.social].filter(Boolean),
            confidence: 0.78,
          },
        ],
        recommendedAngle:
          'Lead with their existing reputation — 412 reviews at 4.6 is the proof the demand is already there — and position the website as the way to turn that local interest into direct bookings rather than missed calls.',
        objections: [
          'They may believe the phone works fine and a website is unnecessary overhead',
          'Concern about who maintains the menu once it is online',
        ],
        unknowns: [
          'Whether they already take bookings through a third-party platform',
          'Current cover volume and how many enquiries go unanswered',
        ],
        confidence: 0.89,
        provider: 'seed',
        model: 'seed/development-data',
        promptVersion: 'analyze_business@1.0.0',
        schemaVersion: '1.0.0',
        evidenceIds: Object.values(evidenceIds),
      },
      update: {},
    });

    const existingDraft = await prisma.messageDraft.findFirst({
      where: { leadId: marioId, kind: 'primary' },
    });

    if (!existingDraft) {
      await prisma.messageDraft.create({
        data: {
          organizationId: orgId,
          leadId: marioId,
          campaignId: campaign.id,
          channel: 'whatsapp',
          kind: 'primary',
          body: "Hi — I came across Mario's while looking at well-reviewed Italian places in Manchester. 412 reviews at 4.6 is a lot of people who already want to eat with you, but I couldn't find a website, so it looks like every booking has to come through the phone.\n\nI build simple booking pages for restaurants — menu, times, done. Would you be open to a quick chat this week?",
          angle: 'Website opportunity: convert proven local demand into direct bookings',
          cta: 'Ask if they are open to a quick chat this week',
          status: 'draft',
          validationStatus: 'passed',
          validationErrors: [],
          evidenceIds: Object.values(evidenceIds),
          provider: 'seed',
          model: 'seed/development-data',
          promptVersion: 'generate_message@1.0.0',
          schemaVersion: '1.0.0',
        },
      });
    }
  }

  /* ----------------------------------------------------- conversation */

  if (bloomId) {
    const existing = await prisma.conversation.findFirst({ where: { leadId: bloomId } });

    if (!existing) {
      const conversation = await prisma.conversation.create({
        data: {
          organizationId: orgId,
          leadId: bloomId,
          channel: 'whatsapp',
          status: 'open',
          externalId: '+441619876543',
          lastIntent: 'pricing',
          lastSentiment: 'positive',
          summary:
            'They noticed the site has been down and are interested, but want to know the cost before committing to a call.',
          needsHuman: false,
          lastMessageAt: new Date(Date.now() - 25 * 60 * 1000),
          firstRepliedAt: new Date(Date.now() - 25 * 60 * 1000),
          createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
        },
      });

      await prisma.message.createMany({
        data: [
          {
            organizationId: orgId,
            conversationId: conversation.id,
            direction: 'outbound',
            body: "Hi — I was looking at bistros in Manchester and tried to open The Bloom Bistro's site, but it doesn't load at the moment. With 168 reviews at 4.4 that's a lot of people hitting a dead end.\n\nI fix and rebuild restaurant sites. Worth a quick chat this week?",
            provider: 'whatsapp',
            sentAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
            createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
          },
          {
            organizationId: orgId,
            conversationId: conversation.id,
            direction: 'inbound',
            body: "Yeah we know, it's been down for weeks and our old guy has gone quiet. What sort of cost are we talking?",
            provider: 'whatsapp',
            providerMessageId: `seed_${randomBytes(6).toString('hex')}`,
            intent: 'pricing',
            sentiment: 'positive',
            classification: {
              intent: 'pricing',
              sentiment: 'positive',
              requires_human: true,
              summary: 'Confirms the site is down and asks directly about price.',
              next_action: 'Give a straight price range, then offer a short call to confirm scope.',
              confidence: 0.93,
            },
            receivedAt: new Date(Date.now() - 25 * 60 * 1000),
            createdAt: new Date(Date.now() - 25 * 60 * 1000),
          },
        ],
      });

      await prisma.lead.update({
        where: { id: bloomId },
        data: {
          status: 'replied',
          lastContactedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
          lastRepliedAt: new Date(Date.now() - 25 * 60 * 1000),
        },
      });

      await prisma.activity.create({
        data: {
          organizationId: orgId,
          leadId: bloomId,
          conversationId: conversation.id,
          type: 'replied',
          summary: 'Reply received on whatsapp.',
          actor: 'provider',
          createdAt: new Date(Date.now() - 25 * 60 * 1000),
        },
      });
    }
  }

  /* -------------------------------------------------------- suppression */

  await prisma.suppression.upsert({
    where: {
      organizationId_scope_value: { organizationId: orgId, scope: 'phone', value: '+441610000000' },
    },
    create: {
      organizationId: orgId,
      scope: 'phone',
      value: '+441610000000',
      reason: 'Asked not to be contacted.',
    },
    update: {},
  });

  /* ------------------------------------------------------------- usage */

  const period = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
  for (const [metric, value] of [
    ['leads', 4],
    ['ai_requests', 12],
    ['messages', 2],
  ] as const) {
    await prisma.usageCounter.upsert({
      where: { organizationId_metric_period: { organizationId: orgId, metric, period } },
      create: { organizationId: orgId, metric, period, value },
      update: { value },
    });
  }

  console.log(`
Seed complete.

  Workspace : ${SEED_ORG}
  Sign in   : ${SEED_EMAIL}
  Password  : ${SEED_PASSWORD}

  ${leadSeeds.length} leads, 1 analysed with evidence-backed pain points,
  1 draft awaiting approval, 1 live conversation.
`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
