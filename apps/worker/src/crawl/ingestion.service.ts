import { Injectable, Logger } from '@nestjs/common';
import { getPrisma, Prisma, ContentStatus, type Platform } from '@ai-hot-news/db';
import {
  computeDedupeHash,
  normalizeUrl,
  stripTitleBoilerplate,
  stripContentBoilerplate,
  checkUniversalQuality,
} from '@ai-hot-news/utils';
import type { RawCrawledItem } from '@ai-hot-news/types';

export interface IngestResult {
  fetched: number;
  inserted: number;
  skipped: number;
  hidden: number;
  failed: number;
}

interface SourceLike {
  id: string;
  platform: Platform;
  url: string | null;
  identifier: string | null;
  name: string;
}

// SP-4.5: RSS feeds frequently re-emit their entire backlog. Drop anything
// older than this window (or with no publishedAt — we can't prove freshness).
// HN/Reddit are unaffected; engagement gates handle their freshness.
const RSS_INGEST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isWithinIngestWindow(
  raw: RawCrawledItem,
  source: SourceLike,
  now: Date,
): boolean {
  if (source.platform !== 'RSS') return true;
  if (!raw.publishedAt) return false;
  return raw.publishedAt.getTime() >= now.getTime() - RSS_INGEST_WINDOW_MS;
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
      hidden: 0,
      failed: 0,
    };

    for (const raw of items) {
      try {
        if (!isWithinIngestWindow(raw, source, new Date())) {
          result.skipped += 1;
          continue;
        }
        if (!raw.sourceUrl) {
          result.skipped += 1;
          continue;
        }
        const sourceUrl = normalizeUrl(raw.sourceUrl);

        // SP-4: pre-ingest cleaning
        const cleanTitle = stripTitleBoilerplate(raw.title);
        const cleanContent = stripContentBoilerplate(raw.contentText);

        // SP-4: dedupeHash uses cleaned title (input is more stable across feed variations)
        const dedupeHash = computeDedupeHash(sourceUrl, cleanTitle);

        // SP-4: filterReason — prefer crawler's verdict; otherwise run universal fallback
        const finalReason =
          raw.filterReason ?? checkUniversalQuality({ title: cleanTitle });

        const status: ContentStatus = finalReason
          ? ContentStatus.HIDDEN
          : ContentStatus.VISIBLE;

        try {
          await prisma.hotNews.create({
            data: {
              title: cleanTitle,
              content: cleanContent,
              rawHtml: raw.rawHtml,
              sourcePlatform: source.platform,
              sourceUrl,
              author: raw.author,
              publishedAt: raw.publishedAt ?? new Date(),
              dedupeHash,
              status,
              filterReason: finalReason ?? null,
              ...(raw.interactionData != null
                ? { interactionData: raw.interactionData as Prisma.InputJsonValue }
                : {}),
            },
          });
          if (status === ContentStatus.HIDDEN) {
            result.hidden += 1;
          } else {
            result.inserted += 1;
          }
        } catch (createErr) {
          if ((createErr as { code?: string }).code === 'P2002') {
            result.skipped += 1;
          } else {
            throw createErr;
          }
        }
      } catch (err) {
        this.logger.warn(
          `Ingest item failed: ${raw.sourceUrl} → ${(err as Error).message}`,
        );
        result.failed += 1;
      }
    }
    return result;
  }
}
