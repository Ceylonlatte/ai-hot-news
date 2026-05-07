import { Prisma, getPrisma } from '@ai-hot-news/db';
import { detectAntiBotPage } from '@ai-hot-news/utils';

/**
 * SP-4.7 v1.1 — clean up rows whose `content` is an anti-bot / login-wall
 * page that was mistakenly persisted by ExtractService.
 *
 * What we do per matched row:
 *   - reset `content = title` (link-post sentinel — same as pre-extract state)
 *   - reset `rawHtml = null`
 *   - reset `summary = null`, `aiTags = []`, `titleZh = null` (force re-summary)
 *   - mark `extractStatus = 'FAILED'`, `extractAttempts = 3` (terminal,
 *     never retry — the target site won't suddenly start serving us)
 *
 * Then the worker boot backstop will re-summarize from `title` only,
 * producing a degraded-but-honest brief instead of "Reddit 平台因网络安全
 * 策略阻止了用户访问..."
 *
 * Single-writer contract: stop the worker before running this script
 * (matches SP-4 §10 decision 11 / SP-4.5 cleanup pattern).
 */

export interface CleanupAntibotResult {
  scanned: number;
  matched: number;
  reset: number;
  byMatchType: {
    content_short_with_signature: number;
  };
}

export async function runCleanupAntibotExtracted(): Promise<CleanupAntibotResult> {
  const prisma = getPrisma();

  // Scan a superset: any EXTRACTED row whose content might be a block page.
  // Use raw SQL with `content ILIKE` for a fast first-pass, then run the
  // full detector on the candidates for false-positive avoidance.
  const candidates = await prisma.$queryRaw<
    Array<{ id: string; title: string; content: string }>
  >(Prisma.sql`
    SELECT id, title, content
    FROM hot_news
    WHERE status = 'VISIBLE'
      AND "extractStatus" = 'EXTRACTED'
      AND LENGTH(content) < 1200
      AND (
        content ILIKE '%blocked by network security%'
        OR content ILIKE '%just a moment%'
        OR content ILIKE '%cloudflare ray id%'
        OR content ILIKE '%verify you%re human%'
        OR content ILIKE '%verify you are human%'
        OR content ILIKE '%enable javascript and cookies%'
        OR content ILIKE '%access denied%'
        OR content ILIKE '%403 forbidden%'
        OR content ILIKE '%checking your browser%'
        OR content ILIKE '%checking if the site connection is secure%'
        OR content ILIKE '%complete the security check%'
        OR content ILIKE '%log in to continue reading%'
        OR content ILIKE '%sign in to continue%'
        OR content ILIKE '%create a free account to read%'
        OR content ILIKE '%create a free account to continue%'
        OR content ILIKE '%rate limit exceeded%'
        OR content ILIKE '%rate limit reached%'
        OR content ILIKE '%too many requests%'
      )
  `);

  const byMatchType = { content_short_with_signature: 0 };
  const idsToReset: Array<{ id: string; title: string }> = [];
  for (const row of candidates) {
    const verdict = detectAntiBotPage(row.content);
    if (verdict.isAntiBot) {
      idsToReset.push({ id: row.id, title: row.title });
      byMatchType.content_short_with_signature += 1;
    }
  }

  let reset = 0;
  for (const { id, title } of idsToReset) {
    await prisma.hotNews.update({
      where: { id },
      data: {
        content: title,
        rawHtml: null,
        summary: null,
        aiTags: [],
        titleZh: null,
        extractStatus: 'FAILED',
        extractAttempts: 3,
      },
    });
    reset += 1;
  }

  return {
    scanned: candidates.length,
    matched: idsToReset.length,
    reset,
    byMatchType,
  };
}

async function main(): Promise<void> {
  const stats = await runCleanupAntibotExtracted();
  console.log(JSON.stringify(stats, null, 2));
}

const isMainEntry = typeof require !== 'undefined' && require.main === module;
const isTsxEntry = process.argv[1]?.endsWith('cleanup-antibot-extracted.ts');

if (isMainEntry || isTsxEntry) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(async () => {
      await getPrisma().$disconnect();
      process.exit(0);
    });
}
