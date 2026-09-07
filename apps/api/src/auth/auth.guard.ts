import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
  CustomDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError, ROLE_RANK, OrgRole } from '@leadforge/shared';
import { enrichLogContext } from '@/common/logger';
import { AuthService } from './auth.service';
import { SESSION_COOKIE, AuthContext, AuthenticatedRequest } from './auth.types';

/** Marks an endpoint as reachable without a session. */
export const PUBLIC_KEY = 'leadforge:public';
export const Public = (): CustomDecorator => SetMetadata(PUBLIC_KEY, true);

/** Minimum role required for an endpoint. */
export const ROLES_KEY = 'leadforge:minRole';
export const RequireRole = (role: OrgRole): CustomDecorator => SetMetadata(ROLES_KEY, role);

/**
 * Resolves the session cookie into an AuthContext and enforces the role floor.
 *
 * Applied globally: an endpoint is protected unless it opts out with @Public.
 * That way a new route is secure by default rather than by remembering.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    const auth = await this.authService.resolveSession(token);

    if (auth) {
      request.auth = auth;
      // Every log line for this request now carries the tenant and actor.
      enrichLogContext({ organizationId: auth.organization.id, userId: auth.user.id });
    }

    if (isPublic) return true;
    if (!auth) throw AppError.unauthenticated();

    const minRole = this.reflector.getAllAndOverride<OrgRole>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (minRole && ROLE_RANK[auth.organization.role] < ROLE_RANK[minRole]) {
      throw AppError.forbidden(
        `This action requires the ${minRole} role. Your role in this workspace is ${auth.organization.role}.`,
      );
    }

    return true;
  }
}

/** Injects the resolved auth context into a controller method. */
export const Auth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw AppError.unauthenticated();
    return request.auth;
  },
);

/**
 * Injects just the organization ID.
 *
 * Tenancy rule (docs/30): this value comes from the session only. No endpoint
 * accepts an organization ID from the client.
 */
export const OrgId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.auth) throw AppError.unauthenticated();
  return request.auth.organization.id;
});

/** Injects the raw Express request, for IP and user-agent capture. */
export const Req = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedRequest =>
    context.switchToHttp().getRequest<AuthenticatedRequest>(),
);
