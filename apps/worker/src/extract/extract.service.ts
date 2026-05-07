import { Injectable, Logger, Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { getPrisma } from '@ai-hot-news/db';
import { detectAntiBotPage } from '@ai-hot-news/utils';
import { ExtractChain } from './providers/chain';
import { PermanentFetchError } from './providers/provider.interface';
import { SUMMARY_QUEUE } from '../summarize/summarize.queue';

const MAX_ATTEMPTS = 3;
const MAX_CONTENT_CHARS = 50_000;

@Injectable()
export class ExtractService {
  private readonly logger = new Logger(ExtractService.name);

  constructor(
    private readonly chain: ExtractChain,
    @Inject(SUMMARY_QUEUE) private readonly summaryQueue: Queue,
  ) {}

  async run(hotNewsId: string): Promise<void> {
    const prisma = getPrisma();
    const row = await prisma.hotNews.findUnique({
      where: { id: hotNewsId },
      select: {
        id: true,
        title: true,
        content: true,
        extractStatus: true,
        extractAttempts: true,
        interactionData: true,
      },
    });
    if (!row) {
      this.logger.warn(`Row ${hotNewsId} not found, skip`);
      return;
    }
    if (row.extractStatus === 'EXTRACTED') return;
    if (row.extractStatus === 'FAILED') return;

    const url = (row.interactionData as { externalUrl?: string } | null)?.externalUrl;
    if (!url || typeof url !== 'string' || !/^https?:/.test(url)) {
      await prisma.hotNews.update({
        where: { id: hotNewsId },
        data: { extractStatus: null },
      });
      return;
    }

    try {
      const { result, usedProvider } = await this.chain.extract(url);
      const cleanText = result.contentText
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, MAX_CONTENT_CHARS);

      // SP-4.7 v1.1: detect anti-bot / login-wall pages that providers
      // happily return as "successful" extractions. Treat as PERMANENT
      // failure: keep the original content (== title sentinel) so SP-5
      // falls back to a title-only summary instead of summarizing the
      // block notice. See packages/utils/src/antibot.ts for signatures.
      const antibot = detectAntiBotPage(cleanText);
      if (antibot.isAntiBot) {
        const attempts = row.extractAttempts + 1;
        await prisma.hotNews.update({
          where: { id: hotNewsId },
          data: { extractStatus: 'FAILED', extractAttempts: attempts },
        });
        this.logger.warn(
          `Anti-bot/blocked page detected for ${url} via ${usedProvider} (matched: ${antibot.reason}, ${cleanText.length} chars), marking FAILED to preserve title-only summary path`,
        );
        return;
      }

      await prisma.hotNews.update({
        where: { id: hotNewsId },
        data: {
          content: cleanText,
          rawHtml: result.rawHtml,
          summary: null,
          aiTags: [],
          extractStatus: 'EXTRACTED',
          extractAttempts: row.extractAttempts + 1,
        },
      });

      await this.summaryQueue.add(
        'summarize',
        { hotNewsId },
        {
          jobId: `summarize-${hotNewsId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );

      this.logger.log(
        `Extracted ${url} via ${usedProvider} (${cleanText.length} chars), re-summarize queued`,
      );
    } catch (err) {
      const attempts = row.extractAttempts + 1;
      const isPermanent = err instanceof PermanentFetchError;
      const reachedLimit = attempts >= MAX_ATTEMPTS;
      const finalStatus = isPermanent || reachedLimit ? 'FAILED' : 'PENDING';

      await prisma.hotNews.update({
        where: { id: hotNewsId },
        data: { extractStatus: finalStatus, extractAttempts: attempts },
      });

      const msg = (err as Error).message;
      if (finalStatus === 'PENDING') {
        this.logger.warn(
          `Extract attempt ${attempts}/${MAX_ATTEMPTS} failed for ${url}: ${msg}, will retry`,
        );
        throw err;
      }
      this.logger.warn(
        `Extract permanently failed for ${url} (${attempts}/${MAX_ATTEMPTS}): ${msg}`,
      );
    }
  }
}
