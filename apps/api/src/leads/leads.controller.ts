import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  analyzeLeadSchema,
  createNoteSchema,
  createTaskSchema,
  generateMessageSchema,
  importLeadsSchema,
  listLeadsSchema,
  updateLeadSchema,
  updateTaskSchema,
} from '@leadforge/shared';
import { zodBody, zodQuery } from '@/common/http';
import { Auth, OrgId, RequireRole } from '@/auth/auth.guard';
import { AuditService } from '@/organizations/audit.service';
import { LeadsService } from './leads.service';
import type { AuthContext } from '@/auth/auth.types';

/** UTF-8 byte order mark, without which Excel misreads the file. */
const BOM = '﻿';

@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(
    @OrgId() organizationId: string,
    @Query(zodQuery(listLeadsSchema)) query: z.infer<typeof listLeadsSchema>,
  ) {
    return this.leads.list(organizationId, query);
  }

  /** CSV of the current filtered view. */
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(
    @OrgId() organizationId: string,
    @Query(zodQuery(listLeadsSchema)) query: z.infer<typeof listLeadsSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.leads.exportCsv(organizationId, query);
    const filename = `leadforge-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Excel needs a UTF-8 BOM to read the file correctly.
    return `${BOM}${csv}`;
  }

  @Post('import')
  @RequireRole('member')
  async import(
    @Auth() auth: AuthContext,
    @Body(zodBody(importLeadsSchema)) body: z.infer<typeof importLeadsSchema>,
  ) {
    const result = await this.leads.import(auth.organization.id, body);
    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'import_leads',
      resource: 'lead',
      metadata: { campaignId: body.campaignId, rows: body.rows.length, ...result },
    });
    return result;
  }

  @Get(':id')
  get(@OrgId() organizationId: string, @Param('id') id: string) {
    return this.leads.get(organizationId, id);
  }

  @Patch(':id')
  @RequireRole('member')
  async update(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Body(zodBody(updateLeadSchema)) body: z.infer<typeof updateLeadSchema>,
  ) {
    const lead = await this.leads.update(auth.organization.id, id, body, auth.user.id);
    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: 'update_lead',
      resource: 'lead',
      resourceId: id,
      metadata: { fields: Object.keys(body) },
    });
    return lead;
  }

  @Post(':id/analyze')
  @RequireRole('member')
  @HttpCode(202)
  analyze(
    @OrgId() organizationId: string,
    @Param('id') id: string,
    @Body(zodBody(analyzeLeadSchema)) body: z.infer<typeof analyzeLeadSchema>,
  ) {
    return this.leads.queueAnalysis(organizationId, id, body.force);
  }

  @Post(':id/generate-message')
  @RequireRole('member')
  @HttpCode(202)
  generateMessage(
    @OrgId() organizationId: string,
    @Param('id') id: string,
    @Body(zodBody(generateMessageSchema)) body: z.infer<typeof generateMessageSchema>,
  ) {
    return this.leads.queueMessageGeneration(organizationId, id, {
      channel: body.channel,
      kinds: body.kinds,
      tone: body.tone,
      cta: body.cta,
      offer: body.offer,
      force: body.force,
    });
  }

  /* ------------------------------------------------------------------ CRM */

  @Post(':id/notes')
  @RequireRole('member')
  addNote(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Body(zodBody(createNoteSchema)) body: z.infer<typeof createNoteSchema>,
  ) {
    return this.leads.addNote(auth.organization.id, id, body.body, auth.user.id);
  }

  @Post(':id/tasks')
  @RequireRole('member')
  createTask(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Body(zodBody(createTaskSchema)) body: z.infer<typeof createTaskSchema>,
  ) {
    return this.leads.createTask(auth.organization.id, id, body, auth.user.id);
  }

  @Patch(':id/tasks/:taskId')
  @RequireRole('member')
  updateTask(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body(zodBody(updateTaskSchema)) body: z.infer<typeof updateTaskSchema>,
  ) {
    return this.leads.updateTask(auth.organization.id, id, taskId, body, auth.user.id);
  }
}
