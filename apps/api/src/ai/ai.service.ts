import { Injectable, OnModuleInit } from '@nestjs/common';
import { AiGateway, AiUsageRecord, MODEL_REGISTRY, promptMetadata } from '@leadforge/ai';
import { AppError, PLAN_QUOTAS, AiTaskName, Plan } from '@leadforge/shared';
import { currentPeriod } from '@leadforge/database';
import { capabilities, env } from '@leadforge/config';
import { PrismaService } from '@/common/prisma.service';
import { currentLogContext, logger } from '@/common/logger';
import type { AiCallOptions, TaskInputs } from '@leadforge/ai';
import type { AiOutputOf } from '@leadforge/shared';

/**
 * The application's entry point to AI.
 *
 * Wraps the gateway with the things only the API knows: which tenant is
 * asking, whether they have quota left, and where usage rows are written.
 * No module calls the gateway directly.
 */
@Injectable()
export class AiService implements OnModuleInit {
  private gateway!: AiGateway;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.gateway = new AiGateway({
      onUsage: (record) => this.persistUsage(record),
    });
  }

  isConfigured(): boolean {
    return capabilities().ai;
  }

  /**
   * Runs an AI task for a tenant.
   *
   * @throws AppError QUOTA_EXCEEDED before spending anything when the
   * organisation is out of AI requests for the period.
   */
  async run<T extends AiTaskName>(
    task: T,
    input: TaskInputs[T],
    context: { organizationId: string; campaignId?: string; leadId?: string },
    options: Omit<AiCallOptions, 'organizationId' | 'campaignId' | 'leadId'> = {},
  ): Promise<Awaited<ReturnType<AiGateway['run']>> & { result: AiOutputOf<T> }> {
    await this.assertQuota(context.organizationId);

    const result = await this.gateway.run(task, input, {
      ...options,
      organizationId: context.organizationId,
      campaignId: context.campaignId,
      leadId: context.leadId,
      requestId: options.requestId ?? currentLogContext()?.requestId,
    });

    await this.incrementUsageCounter(context.organizationId, 'ai_requests');
    return result as Awaited<ReturnType<AiGateway['run']>> & { result: AiOutputOf<T> };
  }

  /* --------------------------------------------------------------- quotas */

  /** Blocks the call when the plan's monthly AI budget is exhausted. */
  private async assertQuota(organizationId: string): Promise<void> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { plan: true },
    });

    const quota = PLAN_QUOTAS[organization.plan as Plan];
    const counter = await this.prisma.usageCounter.findUnique({
      where: {
        organizationId_metric_period: {
          organizationId,
          metric: 'ai_requests',
          period: currentPeriod(),
        },
      },
    });

    const used = counter?.value ?? 0;
    if (used >= quota.monthlyAiRequests) {
      throw new AppError(
        'QUOTA_EXCEEDED',
        `This workspace has used all ${quota.monthlyAiRequests.toLocaleString('en-GB')} AI requests included in the ${quota.label} plan this month.`,
        { retryable: false, details: { used, limit: quota.monthlyAiRequests } },
      );
    }
  }

  /** Atomic increment; safe under concurrent workers. */
  async incrementUsageCounter(organizationId: string, metric: string, by = 1): Promise<void> {
    const period = currentPeriod();
    await this.prisma.usageCounter
      .upsert({
        where: { organizationId_metric_period: { organizationId, metric, period } },
        create: { organizationId, metric, period, value: by },
        update: { value: { increment: by } },
      })
      .catch((error) => {
        logger('ai').warn({ err: error, metric }, 'failed to increment usage counter');
      });
  }

  /* ---------------------------------------------------------------- usage */

  private async persistUsage(record: AiUsageRecord): Promise<void> {
    if (!record.organizationId) return;
    try {
      await this.prisma.aiUsage.create({
        data: {
          organizationId: record.organizationId,
          task: record.task,
          provider: record.provider,
          model: record.model,
          promptVersion: record.promptVersion,
          schemaVersion: record.schemaVersion,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          estimatedCostUsd: record.estimatedCostUsd,
          latencyMs: record.latencyMs,
          success: record.success,
          failureReason: record.failureReason ?? null,
          attempts: record.attempts,
          fallbackFrom: [...record.fallbackFrom],
          requestId: record.requestId,
          providerRequestId: record.providerRequestId ?? null,
          campaignId: record.campaignId ?? null,
          leadId: record.leadId ?? null,
        },
      });
    } catch (error) {
      logger('ai').warn({ err: error, model: record.model }, 'failed to persist AI usage row');
    }
  }

  /* ------------------------------------------------------------- settings */

  /** Payload for the AI settings screen. */
  async describeRouting(organizationId: string) {
    const period = currentPeriod();
    const spend = await this.prisma.aiUsage.aggregate({
      where: { organizationId, createdAt: { gte: new Date(`${period}-01T00:00:00Z`) } },
      _sum: { estimatedCostUsd: true },
    });

    const metadata = new Map(promptMetadata().map((entry) => [entry.task, entry]));

    return {
      enabled: this.isConfigured(),
      provider: 'openrouter',
      defaultTier: env().AI_DEFAULT_TIER,
      monthlyBudgetUsd: env().AI_MONTHLY_USD_BUDGET,
      spentThisMonthUsd: spend._sum.estimatedCostUsd ?? 0,
      models: MODEL_REGISTRY.map((model) => ({
        id: model.id,
        label: model.label,
        tier: model.tier,
        supportsStructuredOutput: model.supportsStructuredOutput,
        contextWindow: model.contextWindow,
        inputCostPerMillion: model.inputCostPerMillion,
        outputCostPerMillion: model.outputCostPerMillion,
        free: model.free,
      })),
      routes: this.gateway.describeRouting().map((route) => ({
        ...route,
        promptVersion: metadata.get(route.task)?.version ?? null,
      })),
    };
  }
}
