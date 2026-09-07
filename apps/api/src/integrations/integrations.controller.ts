import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { z } from 'zod';
import { AppError, jsonValueSchema } from '@leadforge/shared';
import { capabilities } from '@leadforge/config';
import { zodBody } from '@/common/http';
import { PrismaService } from '@/common/prisma.service';
import { Auth, OrgId, RequireRole } from '@/auth/auth.guard';
import { AuditService } from '@/organizations/audit.service';
import { AiService } from '@/ai/ai.service';
import type { AuthContext } from '@/auth/auth.types';

const updateIntegrationSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.record(jsonValueSchema).optional(),
});

/** Providers the product knows about, and the capability that enables each. */
const PROVIDERS = ['openrouter', 'google_places', 'whatsapp', 'instagram', 'email'] as const;
type Provider = (typeof PROVIDERS)[number];

@Controller()
export class IntegrationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: AiService,
  ) {}

  /**
   * Integration status.
   *
   * "Configured" reflects the actual server environment, not a database flag:
   * a row saying WhatsApp is connected while the token is missing would be a
   * lie the UI would faithfully repeat.
   */
  @Get('integrations')
  async list(@OrgId() organizationId: string) {
    const caps = capabilities();
    const configured: Record<Provider, boolean> = {
      openrouter: caps.ai,
      google_places: caps.googlePlaces,
      whatsapp: caps.whatsapp,
      instagram: caps.instagram,
      email: caps.email,
    };

    const rows = await this.prisma.integration.findMany({ where: { organizationId } });
    const byProvider = new Map(rows.map((row) => [row.provider, row]));

    return PROVIDERS.map((provider) => {
      const row = byProvider.get(provider);
      return {
        provider,
        // A provider with credentials is enabled unless explicitly turned off.
        enabled: row ? row.enabled : configured[provider],
        status: !configured[provider] ? 'not_configured' : (row?.status ?? 'connected'),
        configured: configured[provider],
        config: (row?.config as Record<string, unknown>) ?? {},
        lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
        lastError: row?.lastError ?? null,
      };
    });
  }

  @Patch('integrations/:provider')
  @RequireRole('admin')
  async update(
    @Auth() auth: AuthContext,
    @Param('provider') provider: string,
    @Body(zodBody(updateIntegrationSchema)) body: z.infer<typeof updateIntegrationSchema>,
  ) {
    if (!PROVIDERS.includes(provider as Provider)) {
      throw AppError.notFound('Integration', provider);
    }

    const existing = await this.prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId: auth.organization.id, provider } },
    });

    const integration = await this.prisma.integration.upsert({
      where: { organizationId_provider: { organizationId: auth.organization.id, provider } },
      create: {
        organizationId: auth.organization.id,
        provider,
        enabled: body.enabled ?? true,
        config: (body.config ?? {}) as never,
        status: 'connected',
      },
      update: {
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.config !== undefined
          ? { config: { ...((existing?.config as object) ?? {}), ...body.config } as never }
          : {}),
      },
    });

    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'update_integration',
      resource: 'integration',
      resourceId: provider,
      // Config values can hold identifiers but never secrets; keys only.
      metadata: { enabled: body.enabled, configKeys: Object.keys(body.config ?? {}) },
    });

    const caps = capabilities();
    const configuredMap: Record<string, boolean> = {
      openrouter: caps.ai,
      google_places: caps.googlePlaces,
      whatsapp: caps.whatsapp,
      instagram: caps.instagram,
      email: caps.email,
    };

    return {
      provider,
      enabled: integration.enabled,
      status: integration.status,
      configured: configuredMap[provider] ?? false,
      config: integration.config as Record<string, unknown>,
      lastCheckedAt: integration.lastCheckedAt?.toISOString() ?? null,
      lastError: integration.lastError,
    };
  }

  /** Model registry and routing table for the AI settings screen. */
  @Get('ai/routing')
  routing(@OrgId() organizationId: string) {
    return this.ai.describeRouting(organizationId);
  }
}
