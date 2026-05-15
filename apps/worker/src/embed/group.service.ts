import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { getPrisma, Prisma } from '@ai-hot-news/db';

// SP-7 tuning constants. Centralized so a future PR can env-override these
// at module load (right now they're hard-coded because V1 has only 1k rows
// of prod data and we want stable behavior before opening knobs).
export const COSINE_THRESHOLD = 0.85;
export const TAG_BOOST = 0.07;
export const WINDOW_DAYS = 7;
export const CANDIDATE_LIMIT = 5;

interface Candidate {
  id: string;
  groupId: string | null;
  aiTags: string[];
  cosine: number;
}

export type PrismaClientLike = ReturnType<typeof getPrisma>;

/**
 * Generate a SP-7 group id. Form: `grp-<14-char-lowercase-base36>` —
 * visually distinct from the cuid `HotNews.id` (`cm...` prefix) and short
 * enough to read in logs. ~70 bits of entropy is plenty for our scale.
 */
function makeGroupId(): string {
  return `grp-${randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14)}`;
}

/**
 * Pure (DI-free) variant of GroupService.assignGroup. Used by both the
 * NestJS-managed `GroupService` and the one-shot backfill script which
 * does not bootstrap a Nest container.
 */
export async function assignGroupCore(
  prisma: PrismaClientLike,
  hotNewsId: string,
  log: (msg: string) => void = () => {},
): Promise<{ groupId: string | null; cosine: number }> {
  const target = await prisma.hotNews.findUnique({
    where: { id: hotNewsId },
    select: { aiTags: true },
  });
  if (!target) return { groupId: null, cosine: 0 };

  // INTERVAL '<N> days' must be a SQL literal — pass via Prisma.raw with a
  // strictly bounded integer to avoid injection. WINDOW_DAYS is a module
  // constant set above, never a runtime input.
  const windowSql = Prisma.raw(`${WINDOW_DAYS} days`);
  const candidates = await prisma.$queryRaw<Candidate[]>(Prisma.sql`
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

  if (candidates.length === 0) {
    return { groupId: null, cosine: 0 };
  }

  const targetTags = new Set(
    (target.aiTags ?? []).filter(
      (t) => t.startsWith('company:') || t.startsWith('model:'),
    ),
  );
  const scored = candidates
    .map((c) => ({
      ...c,
      score:
        c.cosine + (c.aiTags.some((t) => targetTags.has(t)) ? TAG_BOOST : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]!;

  if (best.score < COSINE_THRESHOLD) {
    log(
      `assignGroup ${hotNewsId} → singleton (best=${best.score.toFixed(3)} < ${COSINE_THRESHOLD})`,
    );
    return { groupId: null, cosine: best.cosine };
  }

  const groupId = best.groupId ?? makeGroupId();
  await prisma.$transaction([
    prisma.hotNews.update({ where: { id: hotNewsId }, data: { groupId } }),
    ...(best.groupId
      ? []
      : [prisma.hotNews.update({ where: { id: best.id }, data: { groupId } })]),
  ]);
  log(
    `assignGroup ${hotNewsId} → ${groupId} (score=${best.score.toFixed(3)}, cosine=${best.cosine.toFixed(3)}, reused=${best.groupId !== null})`,
  );
  return { groupId, cosine: best.cosine };
}

@Injectable()
export class GroupService {
  private readonly logger = new Logger(GroupService.name);

  /**
   * Assign `hotNewsId` to a groupId based on nearest-neighbor cosine
   * similarity within a 7d publishedAt window. Idempotent.
   */
  async assignGroup(hotNewsId: string): Promise<{ groupId: string | null; cosine: number }> {
    return assignGroupCore(getPrisma(), hotNewsId, (msg) => this.logger.log(msg));
  }
}
