import { Injectable } from '@nestjs/common';
import {
  canonicalizeUrl,
  isAppError,
  nameSimilarity,
  normalizeEmail,
  socialHandleFromUrl,
  stripHtml,
  truncate,
  SocialPlatform,
  WebsiteStatus,
} from '@leadforge/shared';
import { PrismaService } from '@/common/prisma.service';
import { EvidenceService } from '@/common/evidence.service';
import { SafeFetchService } from '@/common/safe-fetch.service';
import { logger } from '@/common/logger';

/**
 * Website and social enrichment (docs/13, docs/14).
 *
 * Everything here is an observation of a publicly served page. There is no
 * login automation, no anti-bot evasion and no private-data scraping: the
 * fetcher identifies itself, follows one page, and records what it saw.
 */

export interface WebsiteObservation {
  readonly status: WebsiteStatus;
  readonly url: string | null;
  readonly finalUrl: string | null;
  readonly httpStatus: number | null;
  readonly isHttps: boolean;
  readonly redirectCount: number;
  readonly responseTimeMs: number | null;
  readonly title: string | null;
  readonly description: string | null;
  readonly hasContactPage: boolean;
  readonly hasBookingCta: boolean;
  readonly hasMenuOrServices: boolean;
  readonly hasConversionCta: boolean;
  readonly hasViewport: boolean;
  readonly identityMatch: boolean;
  readonly opportunitySignals: string[];
  readonly discoveredEmails: string[];
  readonly discoveredSocials: { platform: SocialPlatform; url: string }[];
  readonly confidence: number;
  readonly error: string | null;
}

/** Link text and hrefs that indicate a contact route. */
const CONTACT_PATTERNS = [/\/contact/i, />\s*contact\s*</i, /get in touch/i, /\/about/i];
const BOOKING_PATTERNS = [
  /book\s*(a\s*)?(table|now|online|appointment)/i,
  /reserve|reservation/i,
  /\/booking/i,
  /order\s*online/i,
  /opentable|resdiary|sevenrooms|quandoo|calendly|square(up)?\.com\/appointments/i,
];
const MENU_PATTERNS = [
  /\/menu/i,
  />\s*menu\s*</i,
  /\/services/i,
  />\s*services\s*</i,
  /\/products/i,
  /price list/i,
];
const CTA_PATTERNS = [
  /get a quote/i,
  /request a callback/i,
  /free consultation/i,
  /\bsign up\b/i,
  /\benquire\b|\binquire\b/i,
  /call us/i,
];

const SOCIAL_HOSTS: { pattern: RegExp; platform: SocialPlatform }[] = [
  { pattern: /(^|\.)instagram\.com$/i, platform: 'instagram' },
  { pattern: /(^|\.)facebook\.com$/i, platform: 'facebook' },
  { pattern: /(^|\.)linkedin\.com$/i, platform: 'linkedin' },
  { pattern: /(^|\.)(twitter|x)\.com$/i, platform: 'x' },
  { pattern: /(^|\.)tiktok\.com$/i, platform: 'tiktok' },
  { pattern: /(^|\.)youtube\.com$/i, platform: 'youtube' },
];

@Injectable()
export class EnrichmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: EvidenceService,
    private readonly safeFetch: SafeFetchService,
  ) {}

  /**
   * Enriches a lead from its website, then persists the analysis, the derived
   * contacts and social profiles, and the evidence behind each observation.
   */
  async enrich(organizationId: string, leadId: string): Promise<WebsiteObservation> {
    const lead = await this.prisma.lead.findFirstOrThrow({ where: { id: leadId, organizationId } });

    const observation = lead.website
      ? await this.inspectWebsite(lead.website, lead.canonicalName)
      : this.noWebsiteObservation();

    await this.persist(organizationId, leadId, lead.canonicalName, lead.source, observation);

    logger('enrichment').info(
      { leadId, status: observation.status, signals: observation.opportunitySignals.length },
      'lead enriched',
    );

    return observation;
  }

  /** Fetches and reads one page. Never throws: a dead site is a finding. */
  async inspectWebsite(website: string, businessName: string): Promise<WebsiteObservation> {
    const canonical = canonicalizeUrl(website);
    if (!canonical.valid || !canonical.url) {
      return {
        ...this.noWebsiteObservation(),
        status: 'broken',
        url: website,
        error: 'The listed website address is not a valid URL.',
        opportunitySignals: ['Listed website address is malformed'],
        confidence: 0.9,
      };
    }

    try {
      const response = await this.safeFetch.fetch(canonical.url);
      const html = response.body;
      const text = stripHtml(html);

      const title = this.extractTitle(html);
      const description = this.extractMetaDescription(html);
      const haystack = `${html.slice(0, 300_000)}`;

      const hasContactPage = CONTACT_PATTERNS.some((pattern) => pattern.test(haystack));
      const hasBookingCta = BOOKING_PATTERNS.some((pattern) => pattern.test(haystack));
      const hasMenuOrServices = MENU_PATTERNS.some((pattern) => pattern.test(haystack));
      const hasConversionCta = CTA_PATTERNS.some((pattern) => pattern.test(haystack));
      const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);

      const identityMatch =
        nameSimilarity(businessName, title ?? '') >= 0.5 ||
        text.toLowerCase().includes(businessName.toLowerCase().slice(0, 20));

      // A 4xx/5xx that still returned HTML is a broken site, not a healthy one.
      const status: WebsiteStatus = response.ok
        ? 'active'
        : response.status >= 400
          ? 'broken'
          : 'uncertain';

      const signals: string[] = [];
      if (!response.ok) signals.push(`Site returns HTTP ${response.status}`);
      if (!response.isHttps) signals.push('Not served over HTTPS');
      if (!hasViewport) signals.push('No mobile viewport — likely not mobile-friendly');
      if (!hasContactPage) signals.push('No contact page or route found');
      if (!hasBookingCta) signals.push('No booking or appointment path');
      if (!hasMenuOrServices) signals.push('No menu, services or product listing');
      if (!hasConversionCta) signals.push('No visible conversion call to action');
      if (!identityMatch) signals.push('Page content does not clearly reference the business name');
      if (text.length < 400) signals.push('Very little readable content on the homepage');
      if (response.responseTimeMs > 4_000)
        signals.push(`Slow to respond (${response.responseTimeMs}ms)`);

      return {
        status,
        url: canonical.url,
        finalUrl: response.finalUrl,
        httpStatus: response.status,
        isHttps: response.isHttps,
        redirectCount: response.redirectCount,
        responseTimeMs: response.responseTimeMs,
        title,
        description,
        hasContactPage,
        hasBookingCta,
        hasMenuOrServices,
        hasConversionCta,
        hasViewport,
        identityMatch,
        opportunitySignals: signals,
        discoveredEmails: this.extractEmails(html),
        discoveredSocials: this.extractSocials(html),
        // Confidence is high for a page we actually read; lower when we had to
        // truncate it and may have missed a footer link.
        confidence: response.truncated ? 0.75 : 0.92,
        error: null,
      };
    } catch (error) {
      const message = isAppError(error) ? error.message : 'The site could not be reached.';
      const unsafe = isAppError(error) && error.code === 'UNSAFE_URL';

      return {
        ...this.noWebsiteObservation(),
        status: unsafe ? 'uncertain' : 'broken',
        url: canonical.url,
        error: message,
        opportunitySignals: unsafe
          ? ['Website could not be checked safely']
          : ['Listed website does not load'],
        confidence: unsafe ? 0.5 : 0.9,
      };
    }
  }

  private noWebsiteObservation(): WebsiteObservation {
    return {
      status: 'none',
      url: null,
      finalUrl: null,
      httpStatus: null,
      isHttps: false,
      redirectCount: 0,
      responseTimeMs: null,
      title: null,
      description: null,
      hasContactPage: false,
      hasBookingCta: false,
      hasMenuOrServices: false,
      hasConversionCta: false,
      hasViewport: false,
      identityMatch: false,
      opportunitySignals: ['No dedicated website detected'],
      discoveredEmails: [],
      discoveredSocials: [],
      confidence: 0.95,
      error: null,
    };
  }

  private async persist(
    organizationId: string,
    leadId: string,
    businessName: string,
    source: string,
    observation: WebsiteObservation,
  ): Promise<void> {
    const websiteData = {
      organizationId,
      url: observation.url,
      finalUrl: observation.finalUrl,
      status: observation.status,
      httpStatus: observation.httpStatus,
      isHttps: observation.isHttps,
      redirectCount: observation.redirectCount,
      responseTimeMs: observation.responseTimeMs,
      title: observation.title ? truncate(observation.title, 300) : null,
      description: observation.description ? truncate(observation.description, 500) : null,
      hasContactPage: observation.hasContactPage,
      hasBookingCta: observation.hasBookingCta,
      hasMenuOrServices: observation.hasMenuOrServices,
      hasConversionCta: observation.hasConversionCta,
      hasViewport: observation.hasViewport,
      identityMatch: observation.identityMatch,
      opportunitySignals: observation.opportunitySignals as never,
      confidence: observation.confidence,
      error: observation.error,
      checkedAt: new Date(),
    };

    await this.prisma.websiteAnalysis.upsert({
      where: { leadId },
      create: { leadId, ...websiteData },
      update: websiteData,
    });

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { websiteStatus: observation.status, enrichedAt: new Date() },
    });

    /* Contacts found on the page. */
    for (const email of observation.discoveredEmails.slice(0, 3)) {
      await this.prisma.contact
        .upsert({
          where: { leadId_kind_valueKey: { leadId, kind: 'email', valueKey: email } },
          create: {
            organizationId,
            leadId,
            kind: 'email',
            value: email,
            valueKey: email,
            source: 'website',
            isPrimary: false,
          },
          update: { observedAt: new Date() },
        })
        .catch(() => undefined);
    }

    // Promote the first discovered address onto the lead when it has none.
    const primaryEmail = observation.discoveredEmails[0];
    if (primaryEmail) {
      await this.prisma.lead.updateMany({
        where: { id: leadId, email: null },
        data: { email: primaryEmail },
      });
    }

    /* Public social profiles linked from the site. */
    for (const social of observation.discoveredSocials.slice(0, 6)) {
      await this.prisma.socialProfile
        .upsert({
          where: {
            leadId_platform_profileUrl: {
              leadId,
              platform: social.platform,
              profileUrl: social.url,
            },
          },
          create: {
            organizationId,
            leadId,
            platform: social.platform,
            profileUrl: social.url,
            username: socialHandleFromUrl(social.url),
            status: 'found',
            source: 'website',
          },
          update: { observedAt: new Date() },
        })
        .catch(() => undefined);
    }

    /* Evidence: one record per meaningful observation. */
    const evidence = [
      {
        organizationId,
        leadId,
        type: 'website' as const,
        statement:
          observation.status === 'none'
            ? 'No dedicated website detected on the business listing or by resolution.'
            : observation.status === 'broken'
              ? `The listed website does not load: ${observation.error ?? `HTTP ${observation.httpStatus}`}.`
              : `Website is live and responded with HTTP ${observation.httpStatus} in ${observation.responseTimeMs}ms.`,
        source: observation.url ? 'website_fetch' : source,
        sourceUrl: observation.finalUrl ?? observation.url,
        confidence: observation.confidence,
        data: {
          status: observation.status,
          httpStatus: observation.httpStatus,
          isHttps: observation.isHttps,
          responseTimeMs: observation.responseTimeMs,
        },
        // A site can change; treat the observation as stale after 30 days.
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      ...observation.opportunitySignals
        .filter((signal) => signal !== 'No dedicated website detected')
        .map((signal) => ({
          organizationId,
          leadId,
          type: 'website' as const,
          statement: `${signal}${observation.finalUrl ? ` (${observation.finalUrl})` : ''}.`,
          source: 'website_fetch',
          sourceUrl: observation.finalUrl,
          confidence: Math.max(0.6, observation.confidence - 0.1),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        })),
      ...(observation.discoveredSocials.length > 0
        ? [
            {
              organizationId,
              leadId,
              type: 'social' as const,
              statement: `Public profiles linked from the website: ${observation.discoveredSocials
                .map((s) => s.platform)
                .join(', ')}.`,
              source: 'website_fetch',
              sourceUrl: observation.finalUrl,
              confidence: 0.9,
            },
          ]
        : []),
      ...(observation.discoveredEmails.length > 0
        ? [
            {
              organizationId,
              leadId,
              type: 'contact' as const,
              statement: 'A public contact email address is published on the website.',
              source: 'website_fetch',
              sourceUrl: observation.finalUrl,
              confidence: 0.85,
            },
          ]
        : []),
    ];

    await this.evidence.recordMany(evidence);
  }

  /* ------------------------------------------------------------- extraction */

  private extractTitle(html: string): string | null {
    const match = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
    const value = match?.[1] ? stripHtml(match[1]).trim() : '';
    return value || null;
  }

  private extractMetaDescription(html: string): string | null {
    const match =
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,500})["']/i.exec(html) ??
      /<meta[^>]+content=["']([^"']{0,500})["'][^>]+name=["']description["']/i.exec(html);
    const value = match?.[1]?.trim();
    return value || null;
  }

  /** Public mailto/plain addresses on the page, excluding asset filenames. */
  private extractEmails(html: string): string[] {
    const found = new Set<string>();

    for (const match of html.matchAll(/mailto:([^"'?\s>]+)/gi)) {
      const email = normalizeEmail(decodeURIComponent(match[1] ?? ''));
      if (email) found.add(email);
    }

    const text = stripHtml(html);
    for (const match of text.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g)) {
      const email = normalizeEmail(match[0]);
      // Image and font filenames can look like addresses; drop them.
      if (email && !/\.(png|jpe?g|gif|svg|webp|woff2?|css|js)$/i.test(email)) found.add(email);
    }

    return [...found].slice(0, 5);
  }

  /** Social profile links, ignoring share/intent URLs. */
  private extractSocials(html: string): { platform: SocialPlatform; url: string }[] {
    const results = new Map<string, { platform: SocialPlatform; url: string }>();

    for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
      const href = match[1];
      if (!href) continue;

      const canonical = canonicalizeUrl(href);
      if (!canonical.valid || !canonical.hostname || !canonical.url) continue;

      const entry = SOCIAL_HOSTS.find((candidate) =>
        candidate.pattern.test(canonical.hostname as string),
      );
      if (!entry) continue;

      // A share button is not the business's own profile.
      if (/\/(share|sharer|intent|dialog)\b/i.test(canonical.url)) continue;

      const handle = socialHandleFromUrl(canonical.url);
      if (!handle) continue;
      // Platform section paths are not profiles.
      if (['about', 'privacy', 'legal', 'policies', 'explore', 'watch', 'login'].includes(handle))
        continue;

      const key = `${entry.platform}:${handle}`;
      if (!results.has(key)) results.set(key, { platform: entry.platform, url: canonical.url });
    }

    return [...results.values()].slice(0, 8);
  }
}
