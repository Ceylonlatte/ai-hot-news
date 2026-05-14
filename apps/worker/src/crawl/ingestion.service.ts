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
import { HEAT_QUEUE } from '../heat/heat.queue';

export interface IngestResult {
  fetched: number;
  inserted: number;
  /**
   * SP-6: rows whose `interactionData` was refreshed on duplicate sourceUrl
   * (P2002 → UPDATE). Distinct from `skippedDedupe`, which now only counts
   * the case where there's nothing to refresh (raw.interactionData == null)
   * or the existing row vanished mid-flight.
   */
  upserted: number;
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
    @Inject(HEAT_QUEUE) private readonly heatQueue: Queue,
  ) {}

  async ingest(items: RawCrawledItem[], source: SourceLike): Promise<IngestResult> {
    const prisma = getPrisma();
    const result: IngestResult = {
      fetched: items.length,
      inserted: 0,
      upserted: 0,
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

        // SP-5.5 (2026-05-09): crawler-set positive content-value signal. When
        // the platform-specific crawler has already classified the item as
        // substantive (e.g. Reddit link-post to arxiv.org / huggingface.co /
        // openai.com / major press), bypass the AI-keyword gate. This admits
        // model releases / papers / lab blogs whose Reddit titles use bare
        // model-version names ("DS4", "Qwen 35B-A3B") that don't hit the
        // keyword regex but are objectively in-scope.
        if (!raw.trustedSource) {
          const aiTopicProbe = `${cleanTitle}\n${cleanContent.slice(0, 500)}`;
          if (!matchesAiTopic(aiTopicProbe)) {
            result.skipped += 1;
            result.skippedNonAi += 1;
            continue;
          }
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

          // SP-6: push heat:<id> for every successful INSERT so the new
          // row picks up a real score before the next 30-min cron tick.
          await this.heatQueue.add(
            'heat',
            { hotNewsId: created.id },
            {
              jobId: `heat-${created.id}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 10_000 },
              removeOnComplete: { count: 100 },
              removeOnFail: { count: 100 },
            },
          );

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
            // SP-6: upsert interactionData on duplicate sourceUrl so the heat
            // formula sees fresh engagement numbers. Title/content/publishedAt
            // are intentionally preserved — they were good enough on first
            // ingest, downstream summary/extract jobs may already reference
            // them, and rewriting them invites churn for zero benefit.
            // When raw.interactionData is null there's nothing to refresh,
            // so we fall back to the legacy "skip dedupe" path.
            if (raw.interactionData != null) {
              const existing = await prisma.hotNews.findFirst({
                where: { sourceUrl },
                select: { id: true },
              });
              if (existing) {
                await prisma.hotNews.update({
                  where: { id: existing.id },
                  data: {
                    interactionData: raw.interactionData as Prisma.InputJsonValue,
                  },
                });
                result.upserted += 1;
                await this.heatQueue.add(
                  'heat',
                  { hotNewsId: existing.id },
                  {
                    jobId: `heat-${existing.id}`,
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 10_000 },
                    removeOnComplete: { count: 100 },
                    removeOnFail: { count: 100 },
                  },
                );
              } else {
                // Race: P2002 fired but findFirst missed (rare; usually means
                // a concurrent writer deleted the row). Treat as legacy skip.
                result.skipped += 1;
                result.skippedDedupe += 1;
              }
            } else {
              result.skipped += 1;
              result.skippedDedupe += 1;
            }
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
        `fetched=${result.fetched} inserted=${result.inserted} upserted=${result.upserted} ` +
        `skipped=${result.skipped} (quality=${result.skippedQuality} ` +
        `nonAi=${result.skippedNonAi} dedupe=${result.skippedDedupe}) ` +
        `failed=${result.failed}`,
    );
    return result;
  }
}
