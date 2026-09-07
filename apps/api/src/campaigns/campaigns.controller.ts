import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  createCampaignSchema,
  listCampaignsSchema,
  startCampaignSchema,
  updateCampaignSchema,
} from '@leadforge/shared';
import { zodBody, zodQuery } from '@/common/http';
import { Auth, OrgId, RequireRole } from '@/auth/auth.guard';
import { AuditService } from '@/organizations/audit.service';
import { CampaignsService } from './campaigns.service';
import type { AuthContext } from '@/auth/auth.types';

@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(
    @OrgId() organizationId: string,
    @Query(zodQuery(listCampaignsSchema)) query: z.infer<typeof listCampaignsSchema>,
  ) {
    return this.campaigns.list(organizationId, query);
  }

  @Get(':id')
  get(@OrgId() organizationId: string, @Param('id') id: string) {
    return this.campaigns.get(organizationId, id);
  }

  @Get(':id/runs')
  runs(@OrgId() organizationId: string, @Param('id') id: string) {
    return this.campaigns.runs(organizationId, id);
  }

  @Post()
  @RequireRole('member')
  async create(
    @Auth() auth: AuthContext,
    @Body(zodBody(createCampaignSchema)) body: z.infer<typeof createCampaignSchema>,
  ) {
    const campaign = await this.campaigns.create(auth.organization.id, auth.user.id, body);
    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'create_campaign',
      resource: 'campaign',
      resourceId: campaign.id,
      metadata: { name: campaign.name, channel: campaign.channel },
    });
    return campaign;
  }

  @Patch(':id')
  @RequireRole('member')
  async update(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Body(zodBody(updateCampaignSchema)) body: z.infer<typeof updateCampaignSchema>,
  ) {
    const campaign = await this.campaigns.update(auth.organization.id, id, body);
    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'update_campaign',
      resource: 'campaign',
      resourceId: id,
      metadata: { fields: Object.keys(body) },
    });
    return campaign;
  }

  @Post(':id/start')
  @RequireRole('member')
  @HttpCode(202)
  async start(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Body(zodBody(startCampaignSchema)) body: z.infer<typeof startCampaignSchema>,
  ) {
    const run = await this.campaigns.start(auth.organization.id, id, body);
    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'start_campaign',
      resource: 'campaign',
      resourceId: id,
      metadata: { runId: run.id, leadLimit: run.leadLimit },
    });
    return run;
  }

  @Post(':id/pause')
  @RequireRole('member')
  @HttpCode(200)
  async pause(@Auth() auth: AuthContext, @Param('id') id: string) {
    const campaign = await this.campaigns.pause(auth.organization.id, id);
    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'pause_campaign',
      resource: 'campaign',
      resourceId: id,
    });
    return campaign;
  }

  @Post(':id/resume')
  @RequireRole('member')
  @HttpCode(200)
  async resume(@Auth() auth: AuthContext, @Param('id') id: string) {
    const campaign = await this.campaigns.resume(auth.organization.id, id);
    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'resume_campaign',
      resource: 'campaign',
      resourceId: id,
    });
    return campaign;
  }

  /* Discovery aliases from docs/29, kept so the documented contract holds. */

  @Post(':id/discovery/start')
  @RequireRole('member')
  @HttpCode(202)
  startDiscovery(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Body(zodBody(startCampaignSchema)) body: z.infer<typeof startCampaignSchema>,
  ) {
    return this.campaigns.start(auth.organization.id, id, body);
  }

  @Get(':id/discovery/status')
  async discoveryStatus(@OrgId() organizationId: string, @Param('id') id: string) {
    const campaign = await this.campaigns.get(organizationId, id);
    return campaign.latestRun;
  }
}
