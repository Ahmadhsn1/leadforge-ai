import { Injectable } from '@nestjs/common';
import { AppError, normalizeCategory } from '@leadforge/shared';
import { logger } from '@/common/logger';
import type { RawCandidate, SearchCriteria, SearchResult, SourceAdapter } from './source-adapter';

/**
 * OpenStreetMap discovery via the Overpass API (docs/10 "future sources").
 *
 * The zero-cost discovery source: no API key, no billing account, no card.
 * Public Overpass instances are community-funded, so the adapter is written to
 * be a good citizen — one request per page, a real User-Agent, a generous
 * server-side timeout, and a hard cap on result size.
 *
 * Coverage differs from a commercial provider: OSM has excellent phone and
 * address data for independents but no ratings or review counts. That gap is
 * handled honestly downstream — scoring simply has no rating signal to use, and
 * says so in the explanation, rather than inventing one.
 *
 * Licence: data is ODbL. Anything published from it must credit
 * "© OpenStreetMap contributors" — surfaced in the UI on OSM-sourced leads.
 */

/** Public instances, tried in order. Community-run, so failover matters. */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

/**
 * Maps a human category to the OSM tags that actually represent it.
 * OSM tagging is a folksonomy: "restaurant" is `amenity=restaurant`, but a
 * hairdresser is `shop=hairdresser`, and a gym is `leisure=fitness_centre`.
 * Without this table a naive query returns nothing for most categories.
 */
const CATEGORY_TAGS: Record<string, string[]> = {
  restaurant: ['amenity=restaurant'],
  cafe: ['amenity=cafe'],
  coffee: ['amenity=cafe'],
  bar: ['amenity=bar', 'amenity=pub'],
  pub: ['amenity=pub'],
  bakery: ['shop=bakery'],
  takeaway: ['amenity=fast_food'],
  fast_food: ['amenity=fast_food'],
  pizzeria: ['amenity=restaurant', 'amenity=fast_food'],
  bistro: ['amenity=restaurant'],
  deli: ['shop=deli'],
  hotel: ['tourism=hotel'],
  guest_house: ['tourism=guest_house'],

  hairdresser: ['shop=hairdresser'],
  salon: ['shop=hairdresser', 'shop=beauty'],
  barber: ['shop=hairdresser'],
  beauty: ['shop=beauty'],
  spa: ['leisure=spa', 'shop=beauty'],
  nails: ['shop=beauty'],
  tattoo: ['shop=tattoo'],

  gym: ['leisure=fitness_centre'],
  fitness: ['leisure=fitness_centre'],
  yoga: ['leisure=fitness_centre', 'leisure=sports_centre'],

  dentist: ['amenity=dentist'],
  doctor: ['amenity=doctors'],
  clinic: ['amenity=clinic'],
  veterinary: ['amenity=veterinary'],
  optician: ['shop=optician'],
  pharmacy: ['amenity=pharmacy'],
  physiotherapist: ['healthcare=physiotherapist'],

  garage: ['shop=car_repair'],
  car_repair: ['shop=car_repair'],
  car_dealer: ['shop=car'],
  mechanic: ['shop=car_repair'],

  florist: ['shop=florist'],
  butcher: ['shop=butcher'],
  greengrocer: ['shop=greengrocer'],
  convenience: ['shop=convenience'],
  hardware: ['shop=hardware', 'shop=doityourself'],
  furniture: ['shop=furniture'],
  jewellery: ['shop=jewelry'],
  clothing: ['shop=clothes'],
  shoes: ['shop=shoes'],
  bookshop: ['shop=books'],
  pet_shop: ['shop=pet'],
  bike_shop: ['shop=bicycle'],

  estate_agent: ['office=estate_agent'],
  solicitor: ['office=lawyer'],
  lawyer: ['office=lawyer'],
  accountant: ['office=accountant'],
  insurance: ['office=insurance'],
  financial: ['office=financial'],
  travel_agent: ['shop=travel_agency'],
  photographer: ['craft=photographer', 'shop=photo'],

  plumber: ['craft=plumber'],
  electrician: ['craft=electrician'],
  builder: ['craft=builder'],
  carpenter: ['craft=carpenter'],
  painter: ['craft=painter'],
  roofer: ['craft=roofer'],
  locksmith: ['craft=locksmith'],
  cleaner: ['shop=laundry', 'craft=cleaning'],

  nursery: ['amenity=kindergarten'],
  school: ['amenity=school'],
  driving_school: ['amenity=driving_school'],
  childcare: ['amenity=childcare'],
};

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
  remark?: string;
}

@Injectable()
export class OverpassAdapter implements SourceAdapter {
  readonly sourceName = 'openstreetmap';

  /** Always available: there is nothing to configure. */
  isConfigured(): boolean {
    return true;
  }

  async search(criteria: SearchCriteria): Promise<SearchResult> {
    const filters = this.tagFiltersFor(criteria.target.categories);
    if (filters.length === 0) {
      throw new AppError(
        'BAD_REQUEST',
        `None of the categories (${criteria.target.categories.join(', ')}) map to an OpenStreetMap tag. ` +
          `Try one of: ${Object.keys(CATEGORY_TAGS).slice(0, 12).join(', ')}…`,
        { retryable: false },
      );
    }

    // Overpass has no cursor. Pagination is emulated with an offset encoded in
    // the cursor, and the query asks for offset+limit then slices — correct
    // because Overpass ordering is stable for an unchanged area.
    const offset = criteria.cursor ? Number.parseInt(criteria.cursor, 10) || 0 : 0;
    const limit = Math.min(50, criteria.maxResults);
    const fetchCount = Math.min(500, offset + limit);

    const query = this.buildQuery(criteria, filters, fetchCount);
    const response = await this.request(query);

    if (response.rateLimited) return { candidates: [], rateLimited: true };

    const elements = response.data?.elements ?? [];

    // Overpass reports overload and timeouts in a `remark`, with HTTP 200.
    if (response.data?.remark && /timed out|too many|overload/i.test(response.data.remark)) {
      logger('overpass').warn({ remark: response.data.remark }, 'overpass signalled load');
      return { candidates: [], rateLimited: true };
    }

    const candidates = elements
      .slice(offset, offset + limit)
      .map((element) => this.normalize(element))
      .filter((candidate): candidate is RawCandidate => candidate !== null);

    const exhausted = elements.length <= offset + limit;

    return {
      candidates,
      nextCursor: exhausted ? undefined : String(offset + limit),
      rateLimited: false,
    };
  }

  /** Overpass returns full tags in the search, so a detail call adds nothing. */
  async getDetails(externalId: string): Promise<RawCandidate | null> {
    const [type, id] = externalId.split('/');
    if (!type || !id) return null;

    const query = `[out:json][timeout:25];${type}(${id});out center tags;`;
    const response = await this.request(query);
    const element = response.data?.elements?.[0];
    return element ? this.normalize(element) : null;
  }

  /* ------------------------------------------------------------- query */

  /**
   * Builds Overpass QL.
   *
   * A radius search around a coordinate is used when one is available, because
   * it is both faster and more precise than resolving an administrative area
   * by name. Otherwise the area is looked up by name, which is what a user
   * typing "Manchester, UK" actually means.
   */
  private buildQuery(criteria: SearchCriteria, filters: string[], limit: number): string {
    const { latitude, longitude, radiusMeters, location } = criteria.target.geo;
    const hasPoint = typeof latitude === 'number' && typeof longitude === 'number';

    // Only named places are prospects; an unnamed node is not a business.
    const nameFilter = '["name"]';

    if (hasPoint) {
      const around = `(around:${Math.min(50_000, radiusMeters)},${latitude},${longitude})`;
      const statements = filters
        .flatMap((filter) => [
          `  node[${filter}]${nameFilter}${around};`,
          `  way[${filter}]${nameFilter}${around};`,
        ])
        .join('\n');
      return `[out:json][timeout:60];\n(\n${statements}\n);\nout center tags ${limit};`;
    }

    // Take the first component: "Manchester, UK" -> "Manchester".
    const areaName = (location.split(',')[0] ?? location).trim().replace(/"/g, '');
    const statements = filters
      .flatMap((filter) => [
        `  node[${filter}]${nameFilter}(area.searchArea);`,
        `  way[${filter}]${nameFilter}(area.searchArea);`,
      ])
      .join('\n');

    return (
      `[out:json][timeout:60];\n` +
      `area["name"="${areaName}"]["boundary"="administrative"]->.searchArea;\n` +
      `(\n${statements}\n);\n` +
      `out center tags ${limit};`
    );
  }

  /** Resolves campaign categories to OSM tag filters, deduplicated. */
  private tagFiltersFor(categories: readonly string[]): string[] {
    const filters = new Set<string>();

    for (const category of categories) {
      const key = normalizeCategory(category).replace(/\s+/g, '_');
      const tags = CATEGORY_TAGS[key];

      if (tags) {
        for (const tag of tags) {
          const [k, v] = tag.split('=');
          filters.add(`"${k}"="${v}"`);
        }
        continue;
      }

      // Unknown category: fall back to a substring match on the OSM cuisine or
      // shop tag, which catches long-tail values the table does not list.
      const safe = key.replace(/[^a-z0-9_]/g, '');
      if (safe.length >= 3) {
        filters.add(`"shop"~"${safe}"`);
        filters.add(`"cuisine"~"${safe}"`);
      }
    }

    return [...filters];
  }

  private async request(
    query: string,
  ): Promise<{ data: OverpassResponse | null; rateLimited: boolean }> {
    let lastError: unknown;

    for (const endpoint of ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            // Overpass asks clients to identify themselves; anonymous heavy
            // traffic is what gets IP ranges blocked.
            'User-Agent': 'LeadForgeBot/1.0 (+https://leadforge.ai/bot; B2B prospect research)',
          },
          body: query,
          signal: AbortSignal.timeout(75_000),
        });

        if (response.status === 429 || response.status === 504) {
          logger('overpass').warn(
            { endpoint, status: response.status },
            'overpass busy, trying next',
          );
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }

        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }

        return { data: (await response.json()) as OverpassResponse, rateLimited: false };
      } catch (error) {
        lastError = error;
        logger('overpass').warn({ endpoint, err: error }, 'overpass endpoint failed, trying next');
      }
    }

    // Every mirror refused. Treat as rate limiting so the run retries with a
    // delay rather than dead-lettering — the data will be there later.
    logger('overpass').error({ err: lastError }, 'all overpass endpoints unavailable');
    return { data: null, rateLimited: true };
  }

  /* --------------------------------------------------------- normalise */

  private normalize(element: OverpassElement): RawCandidate | null {
    const tags = element.tags ?? {};
    const name = tags.name?.trim();
    if (!name) return null;

    const latitude = element.lat ?? element.center?.lat ?? null;
    const longitude = element.lon ?? element.center?.lon ?? null;

    // OSM stores contact details under two conventions; both are in use.
    const phone = tags.phone ?? tags['contact:phone'] ?? tags['contact:mobile'] ?? null;
    const website = tags.website ?? tags['contact:website'] ?? tags.url ?? null;
    const email = tags.email ?? tags['contact:email'] ?? null;

    const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
    const address =
      [street, tags['addr:city'], tags['addr:postcode']].filter(Boolean).join(', ') || null;

    return {
      externalId: `${element.type}/${element.id}`,
      name,
      category: this.categoryFor(tags),
      address,
      city: tags['addr:city'] ?? tags['addr:suburb'] ?? null,
      region: tags['addr:state'] ?? tags['addr:county'] ?? null,
      country: tags['addr:country'] ?? null,
      postalCode: tags['addr:postcode'] ?? null,
      latitude,
      longitude,
      phone,
      website,
      // OSM carries no ratings or review counts. Reporting null is correct;
      // inventing a proxy would be exactly the fabrication this product avoids.
      rating: null,
      reviewCount: null,
      sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      raw: { ...tags, __osmType: element.type, __osmId: element.id, email },
    };
  }

  /** Human-readable category from whichever OSM tag carries it. */
  private categoryFor(tags: Record<string, string>): string | null {
    const value =
      tags.amenity ??
      tags.shop ??
      tags.craft ??
      tags.office ??
      tags.leisure ??
      tags.tourism ??
      tags.healthcare;
    if (!value) return null;

    const label = value.replace(/_/g, ' ');
    // Cuisine makes a restaurant far more specific: "italian restaurant".
    const cuisine = tags.cuisine?.split(';')[0]?.replace(/_/g, ' ');
    return cuisine ? `${cuisine} ${label}` : label;
  }

  /** Categories the adapter can search, for the campaign builder. */
  static supportedCategories(): string[] {
    return Object.keys(CATEGORY_TAGS).sort();
  }
}
