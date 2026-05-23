import { Injectable, Logger } from '@nestjs/common';
import { getPrisma, Prisma, type Platform } from '@ai-hot-news/db';

/**
 * SP-16 (2026-05-23): keyword detection logic.
 *
 * Per HotNews row, scan all enabled KeywordMonitor rows and:
 *   1. Skip if monitor.platforms is non-empty AND row.sourcePlatform not in it
 *   2. Build haystack = (titleZh || '') + ' ' + (title || '') + ' ' + (summary || '')
 *      (matches SP-12 trigram search expression — keeps semantics aligned)
 *   3. Lowercase the haystack and all candidates (keyword + synonyms)
 *   4. Hit when ANY candidate appears as substring (case-insensitive)
 *   5. Drop if ANY excludeWord appears (post-filter)
 *   6. INSERT KeywordHit (UNIQUE(hotNewsId, keywordId) → P2002 silent skip)
 *   7. Union the matched keyword into HotNews.matchedKeywords[]
 *
 * Idempotent end-to-end — safe to re-enqueue, run on boot backstop, or
 * trigger on row update.
 *
 * Why substring (not word-boundary regex / pg_trgm): V1 single-user; PRD
 * §5.3 examples are product names ("Claude Code", "GPT-5") where substring
 * is what users intuitively want. Word-boundary fails on CJK ("智能体" inside
 * "AI智能体应用" should hit — \b is no help in CJK). Trigram is overkill
 * for sub-millisecond per-row match.
 */
@Injectable()
export class KeywordMatchService {
  private readonly logger = new Logger(KeywordMatchService.name);

  async runForHotNews(hotNewsId: string): Promise<MatchResult> {
    const prisma = getPrisma();
    const row = await prisma.hotNews.findUnique({
      where: { id: hotNewsId },
      select: {
        id: true,
        title: true,
        titleZh: true,
        summary: true,
        sourcePlatform: true,
        matchedKeywords: true,
      },
    });
    if (!row) {
      return { scanned: 0, hits: 0, skipped: 0, notFound: true };
    }

    const enabledKeywords = await prisma.keywordMonitor.findMany({
      where: { enabled: true },
      select: {
        id: true,
        keyword: true,
        synonyms: true,
        excludeWords: true,
        platforms: true,
      },
    });

    if (enabledKeywords.length === 0) {
      return { scanned: 0, hits: 0, skipped: 0, notFound: false };
    }

    const haystackLower = buildHaystack(row).toLowerCase();
    const currentMatched = new Set(row.matchedKeywords);
    let hits = 0;
    let skipped = 0;

    for (const kw of enabledKeywords) {
      // Platform filter — empty means "all platforms"
      if (
        kw.platforms.length > 0 &&
        !kw.platforms.includes(row.sourcePlatform)
      ) {
        skipped += 1;
        continue;
      }

      // OR-match across keyword + synonyms
      const candidates = [kw.keyword, ...kw.synonyms];
      const matched = candidates.some((c) =>
        haystackLower.includes(c.toLowerCase()),
      );
      if (!matched) {
        skipped += 1;
        continue;
      }

      // Exclude-word post-filter
      const excluded = kw.excludeWords.some((e) =>
        haystackLower.includes(e.toLowerCase()),
      );
      if (excluded) {
        skipped += 1;
        continue;
      }

      // INSERT KeywordHit — UNIQUE(hotNewsId, keywordId) makes this idempotent
      try {
        await prisma.keywordHit.create({
          data: { hotNewsId: row.id, keywordId: kw.id },
        });
        hits += 1;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          // Already recorded this hit on a prior run — count as skipped, not
          // hit, so the log accurately reflects "new hits this pass".
          skipped += 1;
        } else {
          throw err;
        }
      }

      // Union keyword into HotNews.matchedKeywords — UI uses this for the
      // "命中" chip on cards. Set ensures de-dup; we write only when
      // something actually changed (rare on re-runs).
      currentMatched.add(kw.keyword);
    }

    if (currentMatched.size > row.matchedKeywords.length) {
      await prisma.hotNews.update({
        where: { id: row.id },
        data: { matchedKeywords: Array.from(currentMatched) },
      });
    }

    return {
      scanned: enabledKeywords.length,
      hits,
      skipped,
      notFound: false,
    };
  }
}

export interface MatchResult {
  scanned: number;
  hits: number;
  skipped: number;
  /** True when hotNewsId no longer exists (row deleted by SP-10.5 TTL). */
  notFound: boolean;
}

interface HotNewsForMatch {
  title: string;
  titleZh: string | null;
  summary: string | null;
  sourcePlatform: Platform;
}

function buildHaystack(row: HotNewsForMatch): string {
  return [row.titleZh ?? '', row.title ?? '', row.summary ?? ''].join(' ');
}
