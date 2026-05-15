import { randomBytes } from 'node:crypto';
import { getPrisma, Prisma } from '@ai-hot-news/db';

export interface BackfillStats {
  scanned: number;
  embedded: number;
  groupsFormed: number;
  multiPlatformGroups: number;
  failed: number;
  totalTokens: number;
  costUsd: string;
}

export interface BackfillOpts {
  /**
   * Function that calls the embeddings API for one text input. The default
   * production caller is `apps/worker/src/embed/embed-client.ts::callEmbed`
   * but we never import the worker package directly here (this script lives
   * in `@ai-hot-news/db`) — `mainCli()` inlines a minimal fetch call.
   */
  embedFn: (text: string) => Promise<{ vector: number[]; tokensIn: number; durationMs: number }>;
  /**
   * Function that runs group assignment for one row. Default production
   * caller is the pure `assignGroupCore()` from the embed module (imported
   * dynamically in mainCli to avoid a worker package dependency at type level).
   */
  assignGroupFn: (hotNewsId: string) => Promise<{ groupId: string | null; cosine: number }>;
  batchSize?: number;
}

interface OrphanRow {
  id: string;
  title: string;
  titleZh: string | null;
  summary: string;
}

export async function backfillEmbeddings(opts: BackfillOpts): Promise<BackfillStats> {
  const prisma = getPrisma();
  const batchSize = opts.batchSize ?? 100;
  const stats: BackfillStats = {
    scanned: 0,
    embedded: 0,
    groupsFormed: 0,
    multiPlatformGroups: 0,
    failed: 0,
    totalTokens: 0,
    costUsd: '$0.0000',
  };
  const seenGroups = new Set<string>();

  // pgvector column can't be projected via Prisma findMany — query candidates
  // via raw SQL filtered on `embedding IS NULL`.
  const rows = await prisma.$queryRawUnsafe<OrphanRow[]>(
    `SELECT id, title, "titleZh", summary
       FROM hot_news
      WHERE status='VISIBLE' AND summary IS NOT NULL AND embedding IS NULL
   ORDER BY "publishedAt" DESC`,
  );
  stats.scanned = rows.length;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    for (const r of batch) {
      try {
        const input = `${r.titleZh ?? r.title}\n${r.summary}`;
        const { vector, tokensIn } = await opts.embedFn(input);
        stats.totalTokens += tokensIn;
        const literal = `[${vector.join(',')}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE hot_news SET embedding = $1::vector(1536) WHERE id = $2`,
          literal,
          r.id,
        );
        const { groupId } = await opts.assignGroupFn(r.id);
        if (groupId && !seenGroups.has(groupId)) {
          seenGroups.add(groupId);
          stats.groupsFormed += 1;
        }
        stats.embedded += 1;
      } catch (err) {
        stats.failed += 1;
        console.error(`Row ${r.id} failed: ${(err as Error).message}`);
      }
    }
  }

  // multiPlatformGroups: count groups whose members span > 1 distinct sourcePlatform
  if (seenGroups.size > 0) {
    const result = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM (
         SELECT "groupId" FROM hot_news
            WHERE "groupId" IS NOT NULL AND status='VISIBLE'
            GROUP BY "groupId"
           HAVING COUNT(DISTINCT "sourcePlatform") > 1
       ) sub`,
    );
    stats.multiPlatformGroups = Number(result[0]?.count ?? 0);
  }

  // text-embedding-3-small: $0.02 per 1M tokens
  stats.costUsd = `$${((stats.totalTokens / 1_000_000) * 0.02).toFixed(4)}`;
  return stats;
}

// SP-7 constants — duplicated from apps/worker/src/embed/group.service.ts so
// this script is self-contained (worker image only COPYs apps/worker/dist,
// not src; SP-4 §10 decision 11 requires one-shot scripts to depend solely
// on packages, not on app source). If you tune these values, update both.
const COSINE_THRESHOLD = 0.85;
const TAG_BOOST = 0.07;
const WINDOW_DAYS = 7;
const CANDIDATE_LIMIT = 5;

function makeGroupId(): string {
  return `grp-${randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14)}`;
}

/**
 * Inline copy of `assignGroupCore` so this script doesn't import from the
 * worker package. Algorithm must stay byte-equivalent with the worker
 * version (apps/worker/src/embed/group.service.ts) — they share constants
 * declared above and identical SQL.
 */
async function assignGroupInline(hotNewsId: string): Promise<{ groupId: string | null; cosine: number }> {
  const prisma = getPrisma();
  const target = await prisma.hotNews.findUnique({
    where: { id: hotNewsId },
    select: { aiTags: true },
  });
  if (!target) return { groupId: null, cosine: 0 };

  const windowSql = Prisma.raw(`${WINDOW_DAYS} days`);
  const candidates = await prisma.$queryRaw<Array<{ id: string; groupId: string | null; aiTags: string[]; cosine: number }>>(Prisma.sql`
    SELECT id, "groupId", "aiTags",
           1 - (embedding <=> (SELECT embedding FROM hot_news WHERE id = ${hotNewsId})) AS cosine
      FROM hot_news
     WHERE id <> ${hotNewsId}
       AND embedding IS NOT NULL
       AND status = 'VISIBLE'
       AND "publishedAt" > NOW() - INTERVAL '${windowSql}'
     ORDER BY embedding <=> (SELECT embedding FROM hot_news WHERE id = ${hotNewsId})
     LIMIT ${CANDIDATE_LIMIT}
  `);
  if (candidates.length === 0) return { groupId: null, cosine: 0 };

  const targetTags = new Set(
    (target.aiTags ?? []).filter((t) => t.startsWith('company:') || t.startsWith('model:')),
  );
  const scored = candidates
    .map((c) => ({
      ...c,
      score: c.cosine + (c.aiTags.some((t) => targetTags.has(t)) ? TAG_BOOST : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  if (best.score < COSINE_THRESHOLD) return { groupId: null, cosine: best.cosine };

  const groupId = best.groupId ?? makeGroupId();
  await prisma.$transaction([
    prisma.hotNews.update({ where: { id: hotNewsId }, data: { groupId } }),
    ...(best.groupId ? [] : [prisma.hotNews.update({ where: { id: best.id }, data: { groupId } })]),
  ]);
  return { groupId, cosine: best.cosine };
}

async function callEmbedInline(text: string): Promise<{ vector: number[]; tokensIn: number; durationMs: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  const model = process.env.EMBED_MODEL ?? 'text-embedding-3-small';
  const start = Date.now();
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '<no body>');
    throw new Error(`OpenAI embeddings ${res.status}: ${err.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    data: Array<{ embedding: number[] }>;
    usage: { prompt_tokens: number };
  };
  const vector = json.data[0]?.embedding;
  if (!vector || vector.length !== 1536) {
    throw new Error(`OpenAI returned invalid vector (len=${vector?.length ?? 'undef'})`);
  }
  return { vector, tokensIn: json.usage.prompt_tokens, durationMs: Date.now() - start };
}

async function mainCli(): Promise<void> {
  const stats = await backfillEmbeddings({
    embedFn: callEmbedInline,
    assignGroupFn: assignGroupInline,
    batchSize: 100,
  });
  console.log(JSON.stringify(stats, null, 2));
}

const isMainEntry =
  typeof require !== 'undefined' && require.main === module;
const isTsxEntry = process.argv[1]?.endsWith('backfill-embeddings-sp7.ts');

if (isMainEntry || isTsxEntry) {
  mainCli()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(async () => {
      await getPrisma().$disconnect();
      process.exit(0);
    });
}
