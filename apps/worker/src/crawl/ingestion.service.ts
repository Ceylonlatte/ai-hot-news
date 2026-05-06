/// <reference path="../../../../packages/prompts/src/keywords-md.d.ts" />

import { Injectable, Logger, Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { getPrisma, Prisma, ContentStatus, type Platform } from '@ai-hot-news/db';
import { matchesAiTopic } from '@ai-hot-news/prompts';
import {
  computeDedupeHash,
  normalizeUrl,
  stripTitleBoilerplate,
  stripContentBoilerplate,
  checkUniversalQuality,
} from '@ai-hot-news/utils';
import type { RawCrawledItem } from '@ai-hot-news/types';
import { SUMMARY_QUEUE } from '../summarize/summarize.queue';
import { EXTRACT_QUEUE } from '../extract/extract.queue';

export interface IngestResult {
  fetched: number;
  inserted: number;
  skipped: number;
  skippedQuality: number;
  skippedNonAi: number;
  skippedDedupe: number;
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

  constructor(
    @Inject(SUMMARY_QUEUE) private readonly summaryQueue: Queue,
    @Inject(EXTRACT_QUEUE) private readonly extractQueue: Queue,
  ) {}

  async ingest(items: RawCrawledItem[], source: SourceLike): Promise<IngestResult> {
    const prisma = getPrisma();
    const result: IngestResult = {
      fetched: items.length,
      inserted: 0,
      skipped: 0,
      skippedQuality: 0,
      skippedNonAi: 0,
      skippedDedupe: 0,
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

        // SP-5: skip low-quality and non-AI items before DB insert.
        const qualityReason =
          raw.filterReason ?? checkUniversalQuality({ title: cleanTitle });
        if (qualityReason) {
          result.skipped += 1;
          result.skippedQuality += 1;
          continue;
        }

        const aiTopicProbe = `${cleanTitle}\n${cleanContent.slice(0, 500)}`;
        if (!matchesAiTopic(aiTopicProbe)) {
          result.skipped += 1;
          result.skippedNonAi += 1;
          continue;
        }

        try {
          const created = await prisma.hotNews.create({
            data: {
              title: cleanTitle,
              content: cleanContent,
              rawHtml: raw.rawHtml,
              sourcePlatform: source.platform,
              sourceUrl,
              author: raw.author,
              publishedAt: raw.publishedAt ?? new Date(),
              dedupeHash,
              status: ContentStatus.VISIBLE,
              filterReason: null,
              ...(raw.interactionData != null
                ? { interactionData: raw.interactionData as Prisma.InputJsonValue }
                : {}),
            },
          });
          result.inserted += 1;
          await this.summaryQueue.add(
            'summarize',
            { hotNewsId: created.id },
            {
              jobId: `summarize-${created.id}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 30_000 },
              removeOnComplete: { count: 100 },
              removeOnFail: { count: 100 },
            },
          );

          const extUrl = (raw.interactionData as { externalUrl?: string } | null)
            ?.externalUrl;
          const isLinkPost =
            typeof extUrl === 'string' &&
            /^https?:/.test(extUrl) &&
            cleanContent === cleanTitle;
          if (isLinkPost) {
            await prisma.hotNews.update({
              where: { id: created.id },
              data: { extractStatus: 'PENDING' },
            });
            await this.extractQueue.add(
              'extract',
              { hotNewsId: created.id },
              {
                jobId: `extract-${created.id}`,
                attempts: 3,
                backoff: { type: 'exponential', delay: 60_000 },
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 100 },
              },
            );
          }
        } catch (createErr) {
          if ((createErr as { code?: string }).code === 'P2002') {
            result.skipped += 1;
            result.skippedDedupe += 1;
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
    this.logger.log(
      `[Ingest] ${source.platform} ${source.name}: ` +
        `fetched=${result.fetched} inserted=${result.inserted} ` +
        `skipped=${result.skipped} (quality=${result.skippedQuality} ` +
        `nonAi=${result.skippedNonAi} dedupe=${result.skippedDedupe}) ` +
        `failed=${result.failed}`,
    );
    return result;
  }
}
