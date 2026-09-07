import type { CampaignFilters, CampaignTarget } from '@leadforge/shared';

/**
 * Discovery source adapter contract (docs/10-DISCOVERY-ENGINE.md).
 *
 * Provider-specific code lives entirely behind this interface. Core lead logic
 * consumes only `RawCandidate`, so adding a source never touches normalisation,
 * verification or scoring.
 */

export interface SearchCriteria {
  readonly target: CampaignTarget;
  readonly filters: CampaignFilters;
  /** Opaque cursor from the previous page, or undefined for the first page. */
  readonly cursor?: string;
  readonly maxResults: number;
}

/** A provider record, normalised only as far as field names. */
export interface RawCandidate {
  readonly externalId: string;
  readonly name: string;
  readonly category?: string | null;
  readonly address?: string | null;
  readonly city?: string | null;
  readonly region?: string | null;
  readonly country?: string | null;
  readonly postalCode?: string | null;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly phone?: string | null;
  readonly website?: string | null;
  readonly rating?: number | null;
  readonly reviewCount?: number | null;
  readonly sourceUrl?: string | null;
  /** The untouched provider payload, retained for provenance. */
  readonly raw: Record<string, unknown>;
}

export interface SearchResult {
  readonly candidates: readonly RawCandidate[];
  readonly nextCursor?: string;
  /** True when the provider signalled it is rate limiting us. */
  readonly rateLimited: boolean;
}

export interface SourceAdapter {
  readonly sourceName: string;
  isConfigured(): boolean;
  /** One page of results. Pagination is driven by the returned cursor. */
  search(criteria: SearchCriteria): Promise<SearchResult>;
  /** Richer detail for a single record, where the provider offers it. */
  getDetails(externalId: string): Promise<RawCandidate | null>;
}
