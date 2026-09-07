import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { analyticsRangeSchema } from '@leadforge/shared';
import { zodQuery } from '@/common/http';
import { OrgId } from '@/auth/auth.guard';
import { AnalyticsService } from './analytics.service';

const usageRangeSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(
    @OrgId() organizationId: string,
    @Query(zodQuery(analyticsRangeSchema)) query: z.infer<typeof analyticsRangeSchema>,
  ) {
    return this.analytics.overview(organizationId, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      campaignId: query.campaignId,
    });
  }

  @Get('campaigns/:id')
  forCampaign(@OrgId() organizationId: string, @Param('id') id: string) {
    return this.analytics.forCampaign(organizationId, id);
  }

  @Get('ai-usage')
  aiUsage(
    @OrgId() organizationId: string,
    @Query(zodQuery(usageRangeSchema)) query: z.infer<typeof usageRangeSchema>,
  ) {
    return this.analytics.aiUsage(organizationId, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  /** Funnel and rates as CSV, for reporting outside the product. */
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(
    @OrgId() organizationId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const overview = await this.analytics.overview(organizationId);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="leadforge-analytics-${new Date().toISOString().slice(0, 10)}.csv"`,
    );

    const lines = [
      'Section,Metric,Value',
      ...overview.funnel.map((point) => `Funnel,${point.stage},${point.count}`),
      ...Object.entries(overview.rates).map(
        ([key, value]) => `Rate,${key},${(value * 100).toFixed(2)}%`,
      ),
      ...Object.entries(overview.totals).map(([key, value]) => `Total,${key},${value}`),
      `Meta,generatedAt,${overview.generatedAt}`,
    ];

    return lines.join('\r\n');
  }
}
