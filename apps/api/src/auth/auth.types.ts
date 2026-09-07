import type { Request } from 'express';
import type { OrgRole } from '@leadforge/shared';

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly emailVerified: boolean;
}

export interface AuthOrganization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly role: OrgRole;
  readonly plan: string;
}

/**
 * The authenticated context for a request.
 *
 * `organization.id` is resolved server-side from the session, never taken from
 * the request body or a header. Every tenant-scoped query must use this value.
 */
export interface AuthContext {
  readonly user: AuthUser;
  readonly organization: AuthOrganization;
  readonly sessionId: string;
  readonly organizations: readonly AuthOrganization[];
}

export type AuthenticatedRequest = Request & { auth?: AuthContext; requestId?: string };

export const SESSION_COOKIE = 'leadforge_session';
