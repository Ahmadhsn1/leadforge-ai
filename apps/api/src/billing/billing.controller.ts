import { Body, Controller, Get, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { env } from '@leadforge/config';
import { zodBody } from '@/common/http';
import { PrismaService } from '@/common/prisma.service';
import { Auth, OrgId, Public, RequireRole } from '@/auth/auth.guard';
import { AuditService } from '@/organizations/audit.service';
import { logger } from '@/common/logger';
import { BillingService } from './billing.service';
import { isPaddleEvent, verifyPaddleSignature } from './billing.logic';
import type { AuthContext } from '@/auth/auth.types';

const changePlanSchema = z.object({ plan: z.enum(['starter', 'growth', 'agency']) });

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  overview(@OrgId() organizationId: string) {
    return this.billing.overview(organizationId);
  }

  /** Starts a checkout, or switches the plan on an existing subscription. */
  @Post('plan')
  @RequireRole('owner')
  @HttpCode(200)
  async changePlan(
    @Auth() auth: AuthContext,
    @Body(zodBody(changePlanSchema)) body: z.infer<typeof changePlanSchema>,
  ) {
    const result = await this.billing.startPlanChange(auth.organization.id, body.plan, auth.user);
    await this.audit.record({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: result.mode === 'checkout' ? 'start_checkout' : 'change_plan',
      resource: 'subscription',
      metadata: { plan: body.plan },
    });
    return result;
  }

  @Post('portal')
  @RequireRole('owner')
  @HttpCode(200)
  portal(@OrgId() organizationId: string) {
    return this.billing.portalUrl(organizationId);
  }

  /**
   * Paddle's webhook. Same three rules as the channel webhooks: verify the
   * signature, record the delivery so a re-delivery is a no-op, then act.
   *
   * Unlike those, a failure to apply a genuine event answers 500: Paddle
   * retries, and a subscription change that was dropped would leave someone
   * paying for a plan they do not have.
   */
  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: Request,
    @Headers('paddle-signature') signature: string | undefined,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
    const secret = env().PADDLE_WEBHOOK_SECRET;
    if (!secret) {
      logger('billing').warn('billing webhook received but PADDLE_WEBHOOK_SECRET is not set');
      return { received: true };
    }

    // The exact bytes Paddle signed; the parsed body would not hash the same.
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(body);
    const verdict = verifyPaddleSignature(rawBody, signature, secret);
    if (!verdict.valid) {
      logger('billing').warn({ reason: verdict.reason }, 'rejected unverified billing webhook');
      return { received: true };
    }

    if (!isPaddleEvent(body)) return { received: true };

    const delivery = await this.prisma.webhookDelivery
      .create({
        data: {
          provider: 'paddle',
          externalId: body.event_id,
          signatureValid: true,
          payload: body as never,
        },
      })
      .catch(() => null);

    if (!delivery) {
      // Seen before. If that attempt failed part-way, let this one finish it.
      const previous = await this.prisma.webhookDelivery.findUnique({
        where: { provider_externalId: { provider: 'paddle', externalId: body.event_id } },
      });
      if (!previous || previous.processedAt) return { received: true };
    }

    const where = { provider_externalId: { provider: 'paddle', externalId: body.event_id } };
    try {
      const outcome = await this.billing.applyEvent(body);
      await this.prisma.webhookDelivery.update({
        where,
        data: { processedAt: new Date(), error: outcome === 'applied' ? null : outcome },
      });
    } catch (error) {
      await this.prisma.webhookDelivery
        .update({
          where,
          data: { error: error instanceof Error ? error.message.slice(0, 500) : 'unknown error' },
        })
        .catch(() => undefined);
      throw error;
    }

    return { received: true };
  }
}
