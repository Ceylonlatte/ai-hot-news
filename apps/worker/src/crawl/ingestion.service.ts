import { Injectable, Logger } from '@nestjs/common';
import { getPrisma, Prisma, type Platform } from '@ai-hot-news/db';
import { computeDedupeHash, normalizeUrl } from '@ai-hot-news/utils';
import type { RawCrawledItem } from '@ai-hot-news/types';

export interface IngestResult {
  fetched: number;
  inserted: number;
  skipped: number;
  failed: number;
}

interface SourceLike {
  id: string;
  platform: Platform;
  url: string | null;
  identifier: string | null;
  name: string;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  async ingest(items: RawCrawledItem[], source: SourceLike): Promise<IngestResult> {
    const prisma = getPrisma();
    const result: IngestResult = {
      fetched: items.length,
      inserted: 0,
      skipped: 0,
      failed: 0,
    };

    for (const raw of items) {
      try {
        if (!raw.sourceUrl) {
          result.skipped += 1;
          continue;
        }
        const sourceUrl = normalizeUrl(raw.sourceUrl);
        const dedupeHash = computeDedupeHash(sourceUrl, raw.title);
        try {
          await prisma.hotNews.create({
            data: {
              title: raw.title,
              content: raw.contentText,
              rawHtml: raw.rawHtml,
              sourcePlatform: source.platform,
              sourceUrl,
              author: raw.author,
              publishedAt: raw.publishedAt ?? new Date(),
              dedupeHash,
              ...(raw.interactionData != null
                ? { interactionData: raw.interactionData as Prisma.InputJsonValue }
                : {}),
            },
          });
          result.inserted += 1;
        } catch (createErr) {
          // P2002 = unique constraint violation → duplicate, skip
          if ((createErr as { code?: string }).code === 'P2002') {
            result.skipped += 1;
          } else {
            throw createErr;
          }
        }
      } catch (err) {
        this.logger.warn(`Ingest item failed: ${raw.sourceUrl} → ${(err as Error).message}`);
        result.failed += 1;
      }
    }
    return result;
  }
}
