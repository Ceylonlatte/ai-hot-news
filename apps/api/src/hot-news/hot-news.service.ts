import { Injectable } from '@nestjs/common';
import { getPrisma, ContentStatus, Prisma, type Platform } from '@ai-hot-news/db';
import type {
  GroupMemberDto,
  HotNewsListResponseDto,
} from '@ai-hot-news/types';

const PLATFORM_WINDOW_HOURS: Record<Platform, number> = {
  TWITTER: 48,
  HACKERNEWS: 48,
  REDDIT: 48,
  RSS: 24 * 7,
};

const DEFAULT_PLATFORMS: Platform[] = ['HACKERNEWS', 'REDDIT'];

/**
 * SP-7-E (2026-05-16): Pluck `redditSubreddit` out of the JSONB
 * `interactionData` column so the UI can render `r/<sub>` without
 * parsing JSON per row. Defensive against three real-world shapes:
 *   - non-Reddit row → caller passes `platform != 'REDDIT'`, returns null
 *   - legacy Reddit row pre-SP-3 → `interactionData` lacks the field
 *   - corrupt / non-string field → returned as null instead of throwing
 *
 * Note we do NOT trim or validate the value beyond `typeof === 'string'`
 * because Reddit's API is the source of truth for the canonical name
 * and any normalization belongs upstream in the crawler, not here.
 */
function extractSubreddit(
  platform: Platform,
  interactionData: unknown,
): string | null {
  if (platform !== 'REDDIT') return null;
  if (interactionData == null || typeof interactionData !== 'object') return null;
  const sub = (interactionData as { redditSubreddit?: unknown }).redditSubreddit;
  return typeof sub === 'string' && sub.length > 0 ? sub : null;
}

@Injectable()
export class HotNewsService {
  async list(
    page: number,
    pageSize: number,
    platforms?: Platform[],
    sort: 'time' | 'heat' = 'time',
    groupMode: 'fold' | 'expand' = 'fold',
  ): Promise<HotNewsListResponseDto> {
    const prisma = getPrisma();
    const skip = (page - 1) * pageSize;
    const requested = platforms?.length ? platforms : DEFAULT_PLATFORMS;

    // SP-6 §0 Q1/Q2: heat sort excludes RSS by contract (RSS goes to its own
    // tab `?tab=media` and is not part of the trending ranking).
    const effectivePlatforms =
      sort === 'heat' ? requested.filter((p) => p !== 'RSS') : requested;

    if (effectivePlatforms.length === 0) {
      return { items: [], page, pageSize, total: 0 };
    }

    const now = new Date();

    // Per-platform OR clause: each platform gets its own publishedAt window
    // (HN/Reddit 48h, RSS 7d). Used by both the Prisma findMany path
    // (groupMode=expand) and the raw SQL path (groupMode=fold).
    const orClauses = effectivePlatforms.map((p) => ({
      sourcePlatform: p,
      publishedAt: {
        gte: new Date(now.getTime() - PLATFORM_WINDOW_HOURS[p] * 60 * 60 * 1000),
      },
    }));

    const where: Prisma.HotNewsWhereInput = {
      status: ContentStatus.VISIBLE,
      OR: orClauses,
    };

    const orderBy: Prisma.HotNewsOrderByWithRelationInput[] =
      sort === 'heat'
        ? [{ heatScore: 'desc' }, { publishedAt: 'desc' }]
        : [{ publishedAt: 'desc' }];

    // ───────────────────────────────────────────────────────────────────
    // Step 1 — pick the page's representative row ids.
    //
    // groupMode=expand: every row is its own list entry (legacy behavior).
    //   findMany with skip/take is enough; we even fetch the full select
    //   list here so Step 2's hydration query is a no-op.
    //
    // groupMode=fold: rows that share a `groupId` collapse to a single
    //   representative; the representative is chosen by the active sort
    //   (heat sort → MAX heatScore in the group, time sort → MAX
    //   publishedAt). Singletons (groupId IS NULL) keep their own slot.
    //   We use Postgres `DISTINCT ON (COALESCE("groupId", id))` so each
    //   bucket emits exactly one row, then ORDER BY the same expression
    //   that drives sort. Doing it in raw SQL keeps pagination LIMIT/OFFSET
    //   exact — application-layer fold cannot do that without over-fetching.
    // ───────────────────────────────────────────────────────────────────
    const fullSelect = {
      id: true,
      title: true,
      titleZh: true,
      summary: true,
      aiTags: true,
      sourceUrl: true,
      sourcePlatform: true,
      author: true,
      publishedAt: true,
      crawledAt: true,
      heatScore: true,
      heatLevel: true,
      groupId: true,
      // SP-7-E: pulled in for `extractSubreddit()`. We do NOT widen the
      // DTO surface to include the full JSONB blob — only the derived
      // `subreddit` field is exposed.
      interactionData: true,
    } as const;

    type HydratedRep = Prisma.HotNewsGetPayload<{ select: typeof fullSelect }>;

    let orderedReps: HydratedRep[];
    let total: number;
    if (groupMode === 'expand') {
      const [rows, count] = await prisma.$transaction([
        prisma.hotNews.findMany({
          where,
          skip,
          take: pageSize,
          orderBy,
          select: fullSelect,
        }),
        prisma.hotNews.count({ where }),
      ]);
      orderedReps = rows;
      total = count;
    } else {
      // Build the WHERE fragment manually so we can plug it into raw SQL
      // alongside the DISTINCT-ON. Identical semantics to `where` above.
      const platformWindowFragments = effectivePlatforms.map(
        (p) => Prisma.sql`(
          "sourcePlatform" = ${Prisma.raw(`'${p}'`)}::"Platform"
          AND "publishedAt" >= ${new Date(
            now.getTime() - PLATFORM_WINDOW_HOURS[p] * 60 * 60 * 1000,
          )}
        )`,
      );
      const whereSql = Prisma.sql`
        status = 'VISIBLE'::"ContentStatus"
        AND (${Prisma.join(platformWindowFragments, ' OR ')})
      `;

      // Order expression. For heat sort: heatScore desc, publishedAt desc.
      // For time sort: publishedAt desc.
      const orderSql =
        sort === 'heat'
          ? Prisma.sql`ORDER BY COALESCE("groupId", id), "heatScore" DESC, "publishedAt" DESC`
          : Prisma.sql`ORDER BY COALESCE("groupId", id), "publishedAt" DESC`;
      const finalOrderSql =
        sort === 'heat'
          ? Prisma.sql`ORDER BY rep_heat DESC, rep_published DESC`
          : Prisma.sql`ORDER BY rep_published DESC`;

      // The CTE picks one representative per bucket via DISTINCT ON + the
      // sort-aware tiebreaker; the outer query re-orders the representatives
      // among themselves and applies LIMIT/OFFSET for accurate pagination.
      const repsResult = await prisma.$queryRaw<
        Array<{ id: string }>
      >(Prisma.sql`
        WITH reps AS (
          SELECT DISTINCT ON (COALESCE("groupId", id))
            id,
            "heatScore" AS rep_heat,
            "publishedAt" AS rep_published
          FROM hot_news
          WHERE ${whereSql}
          ${orderSql}
        )
        SELECT id FROM reps
        ${finalOrderSql}
        LIMIT ${pageSize}
        OFFSET ${skip}
      `);
      const representativeIds = repsResult.map((r) => r.id);

      // total = number of buckets, i.e. distinct (groupId | id) under the
      // same WHERE. One round trip; result is the only thing the API needs
      // to compute page count.
      const totalResult = await prisma.$queryRaw<
        Array<{ total: bigint }>
      >(Prisma.sql`
        SELECT COUNT(DISTINCT COALESCE("groupId", id))::bigint AS total
        FROM hot_news
        WHERE ${whereSql}
      `);
      total = Number(totalResult[0]?.total ?? 0n);

      if (representativeIds.length === 0) {
        return { items: [], page, pageSize, total };
      }

      // Hydrate the representative rows. Re-sort by representativeIds so
      // that the order produced by Step 1's pagination CTE is preserved
      // (Prisma's `IN` query is not order-preserving).
      const repRows = await prisma.hotNews.findMany({
        where: { id: { in: representativeIds } },
        select: fullSelect,
      });
      const repById = new Map(repRows.map((r) => [r.id, r]));
      orderedReps = representativeIds
        .map((id) => repById.get(id))
        .filter((r): r is HydratedRep => r != null);
    }

    if (orderedReps.length === 0) {
      return { items: [], page, pageSize, total };
    }

    // ───────────────────────────────────────────────────────────────────
    // Step 3 — aggregate groupSize + per-platform breakdown (SP-7-C).
    // ───────────────────────────────────────────────────────────────────
    const groupIds = Array.from(
      new Set(
        orderedReps.map((r) => r.groupId).filter((g): g is string => g !== null),
      ),
    );
    const breakdownMap = new Map<string, Partial<Record<Platform, number>>>();
    const sizeMap = new Map<string, number>();
    if (groupIds.length > 0) {
      const counts = await prisma.hotNews.groupBy({
        by: ['groupId', 'sourcePlatform'],
        where: { groupId: { in: groupIds }, status: ContentStatus.VISIBLE },
        _count: { _all: true },
      });
      for (const c of counts) {
        if (!c.groupId) continue;
        const n = c._count._all;
        sizeMap.set(c.groupId, (sizeMap.get(c.groupId) ?? 0) + n);
        const bd = breakdownMap.get(c.groupId) ?? {};
        bd[c.sourcePlatform as Platform] = n;
        breakdownMap.set(c.groupId, bd);
      }
    }

    // ───────────────────────────────────────────────────────────────────
    // Step 4 — fetch the non-representative members of each group on this
    // page (SP-7-D). Eager-loaded for zero-latency UI disclosure. We pull
    // a slim shape (`GroupMemberDto`) so list response stays compact even
    // for an 87-row megagroup.
    // ───────────────────────────────────────────────────────────────────
    const membersByGroup = new Map<string, GroupMemberDto[]>();
    if (groupMode === 'fold' && groupIds.length > 0) {
      const repIdsOnPage = orderedReps.map((r) => r.id);
      const memberRows = await prisma.hotNews.findMany({
        where: {
          groupId: { in: groupIds },
          status: ContentStatus.VISIBLE,
          NOT: { id: { in: repIdsOnPage } },
        },
        orderBy: [{ publishedAt: 'asc' }],
        select: {
          id: true,
          title: true,
          titleZh: true,
          sourceUrl: true,
          sourcePlatform: true,
          author: true,
          publishedAt: true,
          groupId: true,
          // SP-7-E: same reason as fullSelect — only `subreddit` is
          // forwarded out, never the raw JSONB.
          interactionData: true,
        },
      });
      for (const m of memberRows) {
        if (!m.groupId) continue;
        const arr = membersByGroup.get(m.groupId) ?? [];
        arr.push({
          id: m.id,
          title: m.title,
          titleZh: m.titleZh,
          sourceUrl: m.sourceUrl,
          sourcePlatform: m.sourcePlatform,
          author: m.author,
          publishedAt: m.publishedAt.toISOString(),
          subreddit: extractSubreddit(m.sourcePlatform, m.interactionData),
        });
        membersByGroup.set(m.groupId, arr);
      }
    }

    return {
      items: orderedReps.map((r) => ({
        id: r.id,
        title: r.title,
        titleZh: r.titleZh,
        summary: r.summary,
        aiTags: r.aiTags,
        sourceUrl: r.sourceUrl,
        sourcePlatform: r.sourcePlatform,
        author: r.author,
        publishedAt: r.publishedAt.toISOString(),
        crawledAt: r.crawledAt.toISOString(),
        heatScore: r.heatScore,
        heatLevel: r.heatLevel,
        groupId: r.groupId,
        groupSize: r.groupId ? (sizeMap.get(r.groupId) ?? 1) : 1,
        groupPlatforms: r.groupId ? (breakdownMap.get(r.groupId) ?? {}) : {},
        groupMembers: r.groupId ? (membersByGroup.get(r.groupId) ?? []) : [],
        subreddit: extractSubreddit(r.sourcePlatform, r.interactionData),
      })),
      page,
      pageSize,
      total,
    };
  }
}
