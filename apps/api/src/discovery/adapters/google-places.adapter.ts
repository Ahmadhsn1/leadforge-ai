import { Injectable } from '@nestjs/common';
import { AppError } from '@leadforge/shared';
import { capabilities, env } from '@leadforge/config';
import { logger } from '@/common/logger';
import type { RawCandidate, SearchCriteria, SearchResult, SourceAdapter } from './source-adapter';

/**
 * Google Places adapter (docs/10 V1 source).
 *
 * Uses the Places API (New) Text Search endpoint, which returns business
 * identity, location, contact details and review signals in one call and
 * supports server-side pagination via nextPageToken.
 *
 * Field masks are explicit: Places bills per requested field group, so asking
 * for everything would multiply the cost of every discovery run.
 */

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.location',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.rating',
  'places.userRatingCount',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.businessStatus',
  'nextPageToken',
].join(',');

const DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'addressComponents',
  'location',
  'primaryType',
  'primaryTypeDisplayName',
  'types',
  'rating',
  'userRatingCount',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'websiteUri',
  'googleMapsUri',
  'businessStatus',
].join(',');

interface PlacesLocation {
  latitude?: number;
  longitude?: number;
}

interface PlacesAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface PlacesPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: PlacesAddressComponent[];
  location?: PlacesLocation;
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  businessStatus?: string;
}

interface PlacesSearchResponse {
  places?: PlacesPlace[];
  nextPageToken?: string;
  error?: { code?: number; message?: string; status?: string };
}

@Injectable()
export class GooglePlacesAdapter implements SourceAdapter {
  readonly sourceName = 'google_places';

  isConfigured(): boolean {
    return capabilities().googlePlaces;
  }

  async search(criteria: SearchCriteria): Promise<SearchResult> {
    const apiKey = env().GOOGLE_MAPS_API_KEY;
    if (!apiKey) throw AppError.providerNotConfigured('Google Places');

    const body: Record<string, unknown> = {
      textQuery: this.buildQuery(criteria),
      // Places caps a single page at 20; the caller paginates.
      pageSize: Math.min(20, criteria.maxResults),
      languageCode: 'en',
      regionCode: criteria.target.geo.country,
    };

    if (criteria.cursor) body.pageToken = criteria.cursor;

    // A coordinate lets us bias strictly by radius instead of trusting the
    // text query to stay in the right place.
    const { latitude, longitude, radiusMeters } = criteria.target.geo;
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      body.locationRestriction = {
        circle: { center: { latitude, longitude }, radius: Math.min(50_000, radiusMeters) },
      };
    }

    if (criteria.filters.minRating !== undefined) body.minRating = criteria.filters.minRating;

    const response = await this.request(PLACES_ENDPOINT, apiKey, FIELD_MASK, body);

    if (response.status === 429) {
      logger('places').warn('google places rate limit reached');
      return { candidates: [], rateLimited: true };
    }

    const payload = (await response.json()) as PlacesSearchResponse;

    if (!response.ok || payload.error) {
      throw this.toError(response.status, payload.error?.message ?? response.statusText);
    }

    const candidates = (payload.places ?? [])
      // Permanently closed businesses are not prospects.
      .filter((place) => place.businessStatus !== 'CLOSED_PERMANENTLY')
      .map((place) => this.normalize(place))
      .filter((candidate): candidate is RawCandidate => candidate !== null);

    return { candidates, nextCursor: payload.nextPageToken, rateLimited: false };
  }

  async getDetails(externalId: string): Promise<RawCandidate | null> {
    const apiKey = env().GOOGLE_MAPS_API_KEY;
    if (!apiKey) throw AppError.providerNotConfigured('Google Places');

    const response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(externalId)}`,
      {
        headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': DETAILS_FIELD_MASK },
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (response.status === 404) return null;
    if (!response.ok) throw this.toError(response.status, response.statusText);

    const place = (await response.json()) as PlacesPlace;
    return this.normalize(place);
  }

  /**
   * Turns campaign criteria into a Places text query. Categories and keywords
   * are joined with the location because Places ranks text relevance rather
   * than accepting structured filters.
   */
  private buildQuery(criteria: SearchCriteria): string {
    const terms = [...criteria.target.categories, ...criteria.target.keywords].filter(Boolean);
    const subject = terms.length > 0 ? terms.join(' ') : 'business';
    return `${subject} in ${criteria.target.geo.location}`.trim();
  }

  private normalize(place: PlacesPlace): RawCandidate | null {
    const id = place.id;
    const name = place.displayName?.text?.trim();
    if (!id || !name) return null;

    const components = place.addressComponents ?? [];
    const component = (type: string): string | null =>
      components.find((c) => c.types?.includes(type))?.longText ?? null;
    const shortComponent = (type: string): string | null =>
      components.find((c) => c.types?.includes(type))?.shortText ?? null;

    return {
      externalId: id,
      name,
      category: place.primaryTypeDisplayName?.text ?? place.primaryType ?? null,
      address: place.formattedAddress ?? null,
      city:
        component('postal_town') ??
        component('locality') ??
        component('administrative_area_level_2'),
      region: component('administrative_area_level_1'),
      country: shortComponent('country'),
      postalCode: component('postal_code'),
      latitude: place.location?.latitude ?? null,
      longitude: place.location?.longitude ?? null,
      // Prefer the international form: it already carries a country code.
      phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null,
      website: place.websiteUri ?? null,
      rating: place.rating ?? null,
      reviewCount: place.userRatingCount ?? null,
      sourceUrl: place.googleMapsUri ?? null,
      raw: place as unknown as Record<string, unknown>,
    };
  }

  private async request(
    url: string,
    apiKey: string,
    fieldMask: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new AppError('PROVIDER_UNAVAILABLE', 'Could not reach the Google Places API.', {
        cause: error,
        retryable: true,
      });
    }
  }

  private toError(status: number, message: string): AppError {
    if (status === 401 || status === 403) {
      return new AppError(
        'PROVIDER_NOT_CONFIGURED',
        `Google Places rejected the API key: ${message}. Check the key is valid and the Places API (New) is enabled.`,
        { retryable: false },
      );
    }
    if (status === 429) {
      return new AppError('PROVIDER_RATE_LIMITED', 'Google Places rate limit reached.', {
        retryable: true,
        retryAfterMs: 30_000,
      });
    }
    if (status >= 500) {
      return new AppError('PROVIDER_UNAVAILABLE', `Google Places is unavailable: ${message}`, {
        retryable: true,
      });
    }
    return new AppError('PROVIDER_ERROR', `Google Places request failed: ${message}`, {
      retryable: false,
    });
  }
}
