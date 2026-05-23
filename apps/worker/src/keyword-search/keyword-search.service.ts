import { Injectable, Logger } from '@nestjs/common';
import { getPrisma } from '@ai-hot-news/db';
import type { RawCrawledItem } from '@ai-hot-news/types';
import { IngestionService } from '../crawl/ingestion.service';
import {
  loadKeywordSearchConfig,
  type KeywordSearchConfig,
} from './keyword-search.config';
import { searchHnAlgolia } from './platforms/hn-algolia.searcher';
import { searchReddit } from './platforms/reddit-search.searcher';

/**
 * SP-16.5 (2026-05-23): orchestrates the per-keyword search → ingest flow.
 *
 * For each monitor:
 *   1. Resolve platforms (monitor.platforms or default [HN, Reddit])
 *   2. Hit each platform's search API with the keyword
 *   3. Apply excludeWords substring filter BEFORE handing to ingest
 *      (cheaper than letting full ingest+summary pipeline absorb noise)
 *   4. Feed surviving rows to IngestionService.ingest()  — reuses dedupe,
 *      summary push, heat push, extract push, keyword-match push chains
 *   5. Update monitor.lastSearchedAt = now (success path)
 *
 * Why we do NOT expand synonyms into the search query:
 *   Most platforms treat multi-token OR queries as relevance hints rather
 *   than strict matches, so synonyms tend to flood results with noise
 *   while still missing edge cases. SP-16 detection runs synonym OR on
 *   the local DB anyway — any synonym-only hit ingested by the regular
 *   crawler (top list / RSS) still gets correctly classified.
 *
 * Why we DO apply excludeWords client-side here (not just rely on SP-16):
 *   excludeWords arrive AFTER SP-16 has decided this isn't a hit, which
 *   means the post would never get a KeywordHit row but WOULD be a fully
 *   ingested HotNews (with a paid LLM summary). Cheap pre-filter avoids
 *   that waste.
 */
@Injectable()
export class KeywordSearchService {
  private readonly logger = new Logger(KeywordSearchService.name);
  // Process-level Reddit clock — separate keyword jobs running serially
  // (concurrency=1 in module) still share this so a previous Reddit call
  // gates the next.
  private lastRedditCallAt = 0;

  constructor(private readonly ingestion: IngestionService) {}

  async runForKeyword(monitorId: string): Promise<KeywordSearchResult> {
    const prisma = getPrisma();
    const monitor = await prisma.keywordMonitor.findUnique({
      where: { id: monitorId },
      select: {
        id: true,
        keyword: true,
        excludeWords: true,
        platforms: true,
        enabled: true,
      },
    });

    if (!monitor) {
      return {
        notFound: true,
        platforms: [],
        fetched: 0,
        inserted: 0,
        skippedExcluded: 0,
      };
    }
    if (!monitor.enabled) {
      // Cron should have filtered enabled=false already; still be safe in
      // case a user toggled it off between cron enqueue and processor run.
      return {
        notFound: false,
        platforms: [],
        fetched: 0,
        inserted: 0,
        skippedExcluded: 0,
        disabled: true,
      };
    }

    const config = loadKeywordSearchConfig();
    const platforms = resolvePlatforms(monitor.platforms);
    const result: KeywordSearchResult = {
      notFound: false,
      platforms,
      fetched: 0,
      inserted: 0,
      skippedExcluded: 0,
    };

    for (const platform of platforms) {
      try {
        const rawItems = await this.searchPlatform(
          platform,
          monitor.keyword,
          config,
        );
        result.fetched += rawItems.length;

        const filtered = filterExcludeWords(rawItems, monitor.excludeWords);
        result.skippedExcluded += rawItems.length - filtered.length;

        if (filtered.length === 0) continue;

        const ingestResult = await this.ingestion.ingest(filtered, {
          // Synthetic SourceConfig-shaped payload — IngestionService only
          // reads { platform, name, id?, url?, identifier? } so a stable
          // synthetic id (`keyword-search:<keyword>:<platform>`) is enough
          // to make logs / metrics readable + group by platform.
          id: `keyword-search:${monitor.id}:${platform}`,
          platform,
          url: null,
          identifier: null,
          name: `keyword-search:${monitor.keyword}`,
        });
        result.inserted += ingestResult.inserted;
      } catch (err) {
        // Don't fail the whole job for one platform — log + continue so
        // the other platform still runs and lastSearchedAt updates.
        this.logger.warn(
          `platform=${platform} keyword="${monitor.keyword}" failed: ${(err as Error).message}`,
        );
      }
    }

    // Always advance lastSearchedAt on a "we attempted" basis. Even if
    // all platforms errored, we don't want a hot retry loop hammering the
    // platforms — the next cron tick can take another shot.
    await prisma.keywordMonitor.update({
      where: { id: monitorId },
      data: { lastSearchedAt: new Date() },
    });

    return result;
  }

  private async searchPlatform(
    platform: 'HACKERNEWS' | 'REDDIT',
    query: string,
    config: KeywordSearchConfig,
  ): Promise<RawCrawledItem[]> {
    if (platform === 'HACKERNEWS') {
      return searchHnAlgolia({
        query,
        maxHits: config.maxHitsPerPlatform,
        userAgent: config.userAgent,
      });
    }
    if (platform === 'REDDIT') {
      // Cheap rate-limit guard: enforce min gap between consecutive
      // Reddit calls across this service instance.
      await this.throttleReddit(config.redditMinSleepMs);
      return searchReddit({
        query,
        maxHits: config.maxHitsPerPlatform,
        userAgent: config.userAgent,
      });
    }
    return [];
  }

  private async throttleReddit(minGapMs: number): Promise<void> {
    const now = Date.now();
    const gap = now - this.lastRedditCallAt;
    if (this.lastRedditCallAt !== 0 && gap < minGapMs) {
      await new Promise((r) => setTimeout(r, minGapMs - gap));
    }
    this.lastRedditCallAt = Date.now();
  }
}

export interface KeywordSearchResult {
  notFound: boolean;
  /** Platforms actually attempted (post-resolvePlatforms). */
  platforms: Array<'HACKERNEWS' | 'REDDIT'>;
  /** Total raw items returned by all platform searches combined. */
  fetched: number;
  /** New HotNews rows actually inserted (excludes dedupe / quality skips). */
  inserted: number;
  /** Items dropped because they matched an excludeWord. */
  skippedExcluded: number;
  /** Set if the monitor row was deleted/disabled between cron enqueue and run. */
  disabled?: boolean;
}

/**
 * Map KeywordMonitor.platforms → effective set this feeder supports.
 *   - empty → default both supported platforms
 *   - TWITTER / RSS / unknown → silently dropped (RSS has no search API;
 *     Twitter waits for SP-22 with paid API)
 */
export function resolvePlatforms(
  configured: string[],
): Array<'HACKERNEWS' | 'REDDIT'> {
  if (!configured || configured.length === 0) {
    return ['HACKERNEWS', 'REDDIT'];
  }
  const out: Array<'HACKERNEWS' | 'REDDIT'> = [];
  if (configured.includes('HACKERNEWS')) out.push('HACKERNEWS');
  if (configured.includes('REDDIT')) out.push('REDDIT');
  return out;
}

export function filterExcludeWords(
  items: RawCrawledItem[],
  excludeWords: string[],
): RawCrawledItem[] {
  if (excludeWords.length === 0) return items;
  const lowered = excludeWords.map((w) => w.toLowerCase());
  return items.filter((item) => {
    const haystack = `${item.title} ${item.contentText}`.toLowerCase();
    return !lowered.some((ex) => haystack.includes(ex));
  });
}
