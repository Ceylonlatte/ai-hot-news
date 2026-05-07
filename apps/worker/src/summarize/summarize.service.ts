import { Injectable, Logger } from '@nestjs/common';
import { getPrisma } from '@ai-hot-news/db';
import {
  buildSystemPrompt,
  buildUserPrompt,
  parseSummarizeResponse,
} from '@ai-hot-news/prompts';
import { callLlm } from './llm-client';
import { SummarizationStrategy } from './strategies/strategy.interface';

@Injectable()
export class SummarizeService {
  private readonly logger = new Logger(SummarizeService.name);

  constructor(private readonly strategy: SummarizationStrategy) {}

  async run(hotNewsId: string): Promise<void> {
    const prisma = getPrisma();
    const row = await prisma.hotNews.findUnique({
      where: { id: hotNewsId },
      select: {
        id: true,
        title: true,
        content: true,
        sourcePlatform: true,
        publishedAt: true,
        status: true,
        interactionData: true,
        heatScore: true,
      },
    });
    if (!row) {
      this.logger.warn(`Row ${hotNewsId} not found, skip`);
      return;
    }

    const verdict = this.strategy.shouldSummarize({
      id: row.id,
      sourcePlatform: row.sourcePlatform as 'TWITTER' | 'RSS' | 'HACKERNEWS' | 'REDDIT',
      publishedAt: row.publishedAt,
      status: row.status as 'VISIBLE' | 'HIDDEN' | 'PENDING',
      interactionData: row.interactionData as Record<string, unknown> | null,
      heatScore: row.heatScore,
    });
    if (verdict !== 'allow') {
      this.logger.log(`hotNewsId=${hotNewsId} → ${verdict}`);
      return;
    }

    const result = await callLlm(
      buildSystemPrompt(),
      buildUserPrompt({
        title: row.title,
        content: row.content,
        sourcePlatform: row.sourcePlatform,
      }),
    );

    const parsed = parseSummarizeResponse(result.text);
    if (!parsed) {
      this.logger.warn(
        `Failed to parse LLM response for ${hotNewsId} (${result.durationMs}ms, in=${result.tokensIn} out=${result.tokensOut}), raw text first 200 chars: ${result.text.slice(0, 200)}`,
      );
      return;
    }

    try {
      await prisma.hotNews.update({
        where: { id: hotNewsId },
        data: {
          titleZh: parsed.titleZh,
          summary: parsed.summary,
          aiTags: parsed.aiTags,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2025') return;
      throw err;
    }

    this.logger.log(
      `hotNewsId=${hotNewsId} → done (${result.durationMs}ms, in=${result.tokensIn}, out=${result.tokensOut}, summary=${parsed.summary.length}c, titleZh=${parsed.titleZh ? parsed.titleZh.length + 'c' : 'null'}, tags=${parsed.aiTags.length})`,
    );
  }
}
