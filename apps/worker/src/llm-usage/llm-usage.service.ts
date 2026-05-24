import { Injectable, Logger } from '@nestjs/common';
import { getPrisma } from '@ai-hot-news/db';
import { computeCostUsd } from './pricing';

export interface RecordUsageInput {
  operation: 'summarize' | 'embed' | 'extract' | 'daily-report';
  model: string;
  hotNewsId?: string | null;
  tokensIn: number;
  tokensOut?: number;
  durationMs: number;
}

/**
 * SP-19 PR-A (2026-05-24): persist one llm_usage row per LLM call.
 *
 * Fire-and-forget contract: callers should NOT await on the persistence
 * happy path — `record()` swallows internal errors and logs them at warn
 * level so an LlmUsage write outage cannot bring down summarize/embed.
 *
 * Cost is pre-computed at write-time using `pricing.ts`, decoupling the
 * read path (admin views) from a recompute on every page load.
 */
@Injectable()
export class LlmUsageService {
  private readonly logger = new Logger(LlmUsageService.name);

  async record(input: RecordUsageInput): Promise<void> {
    try {
      const tokensOut = input.tokensOut ?? 0;
      const costUsd = computeCostUsd(input.model, input.tokensIn, tokensOut);
      await getPrisma().llmUsage.create({
        data: {
          operation: input.operation,
          model: input.model,
          hotNewsId: input.hotNewsId ?? null,
          tokensIn: input.tokensIn,
          tokensOut,
          durationMs: input.durationMs,
          // Prisma Decimal accepts string | number — pass number direct.
          costUsd: costUsd ?? null,
        },
      });
    } catch (err) {
      // Fire-and-forget: never throw from this method. The LLM call already
      // succeeded; failing to record cost is an ops-visibility regression,
      // not a functional one.
      this.logger.warn(
        `record(${input.operation}/${input.model}) failed: ${(err as Error).message}`,
      );
    }
  }
}
