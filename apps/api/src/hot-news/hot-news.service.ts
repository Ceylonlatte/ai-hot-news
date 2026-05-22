import { Injectable } from '@nestjs/common';
import { getPrisma, ContentStatus, Prisma, type Platform } from '@ai-hot-news/db';
import type {
  GroupMemberDto,
  HeatHistoryDto,
  HotNewsDetailDto,
  HotNewsListResponseDto,
  HotNewsRelatedDto,
} from '@ai-hot-news/types';
import { RANGE_HOURS_MAP, type AllowedRange } from './dto/list-hot-news.query';

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

/**
 * SP-12 (2026-05-22): inlined Prisma.sql fragment used by both fold + expand
 * paths to compute the trigram-searchable text. Must exactly match the
 * functional GIN index expression in migration
 * `20260522134034_add_search_text_column` or the planner won't use the index.
 */
const SEARCH_TEXT_SQL = Prisma.sql`(
  COALESCE("titleZh", '')
    || ' '
    || COALESCE(title, '')
    || ' '
    || COALESCE(summary, '')
    || ' '
    || array_to_string("aiTags", ' ')
    || ' '
    || array_to_string("matchedKeywords", ' ')
)`;

@Injectable()
export class HotNewsService {
  async list(
    page: number,
    pageSize: number,
    platforms?: Platform[],
    sort: 'time' | 'heat' = 'time',
    groupMode: 'fold' | 'expand' = 'fold',
    range?: AllowedRange,
    tags?: string[],
    query?: string,
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

    // SP-10: user-explicit `?range=` overrides PLATFORM_WINDOW_HOURS. When set,
    // ALL selected platforms use the SAME window (vs per-platform defaults).
    // When undefined, per-platform defaults preserved → SP-4.5 / SP-9 / SP-11
    // callers unaffected.
    const userHours = range ? RANGE_HOURS_MAP[range] : null;

    // Per-platform OR clause: each platform gets its publishedAt window —
    // user-explicit `?range=` if set, otherwise PLATFORM_WINDOW_HOURS default
    // (HN/Reddit 48h, RSS 7d). Used by both the Prisma findMany path
    // (groupMode=expand) and the raw SQL path (groupMode=fold).
    const orClauses = effectivePlatforms.map((p) => ({
      sourcePlatform: p,
      publishedAt: {
        gte: new Date(
          now.getTime() - (userHours ?? PLATFORM_WINDOW_HOURS[p]) * 60 * 60 * 1000,
        ),
      },
    }));

    // SP-10: `?tags=` multi-tag AND filter. Prisma `hasEvery` = Postgres `@>`
    // operator on text[]. Empty array short-circuits to "no filter" so SP-9/SP-11
    // callers (passing undefined / no tags) stay byte-identical.
    const hasTagFilter = tags != null && tags.length > 0;

    // SP-12: trigram search overlay. Trim happens in DTO; defensively skip
    // empty string here so legacy / non-search paths stay byte-identical.
    const hasQuery = query != null && query.length > 0;

    const where: Prisma.HotNewsWhereInput = {
      status: ContentStatus.VISIBLE,
      OR: orClauses,
      ...(hasTagFilter ? { aiTags: { hasEvery: tags } } : {}),
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
    if (groupMode === 'expand' && !hasQuery) {
      // Legacy expand path — no trigram search. Prisma findMany is fastest
      // and keeps SP-9 / SP-11 callers byte-identical to pre-SP-12 behavior.
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
    } else if (groupMode === 'expand' && hasQuery) {
      // SP-12 expand + search: Prisma doesn't natively support pg_trgm `%`
      // or `similarity()` — fall through to raw SQL. No DISTINCT-ON (each
      // row is its own bucket) but search clause + similarity ORDER BY
      // are applied. Hydration uses findMany WHERE id IN [...].
      const platformWindowFragments = effectivePlatforms.map(
        (p) => Prisma.sql`(
          "sourcePlatform" = ${Prisma.raw(`'${p}'`)}::"Platform"
          AND "publishedAt" >= ${new Date(
            now.getTime() - (userHours ?? PLATFORM_WINDOW_HOURS[p]) * 60 * 60 * 1000,
          )}
        )`,
      );
      const tagFragment = hasTagFilter
        ? Prisma.sql`AND "aiTags" @> ${tags}::text[]`
        : Prisma.empty;
      // SP-12 (2026-05-22 hot-patch): use ILIKE for the WHERE clause instead
      // of the `%` operator. Reason: prod default `pg_trgm.similarity_threshold`
      // is 0.3, but `OpenAI` against a long row (titleZh+title+summary+aiTags+
      // matchedKeywords) only scores ~0.29 — false negative. ILIKE is
      // substring-match (what users intuitively want); the GIN trgm index
      // can still accelerate it (planner picks seq-scan at 1377 rows because
      // cost is low, but the index is ready as the table grows). The
      // similarity() ORDER BY below is kept so the most-relevant hit still
      // surfaces first — similarity ranking is a pure function, doesn't
      // depend on the % threshold.
      const searchFragment = Prisma.sql`AND ${SEARCH_TEXT_SQL} ILIKE ${'%' + query + '%'}`;
      const whereSql = Prisma.sql`
        status = 'VISIBLE'::"ContentStatus"
        AND (${Prisma.join(platformWindowFragments, ' OR ')})
        ${tagFragment}
        ${searchFragment}
      `;
      // Similarity-first ordering. heat sort still kicks in as a secondary
      // (rare combination — power users with ?sort=heat&q=...).
      const searchOrderSql =
        sort === 'heat'
          ? Prisma.sql`ORDER BY similarity(${SEARCH_TEXT_SQL}, ${query}::text) DESC, "heatScore" DESC, "publishedAt" DESC`
          : Prisma.sql`ORDER BY similarity(${SEARCH_TEXT_SQL}, ${query}::text) DESC, "publishedAt" DESC`;

      const repsResult = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM hot_news
        WHERE ${whereSql}
        ${searchOrderSql}
        LIMIT ${pageSize}
        OFFSET ${skip}
      `);
      const totalResult = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS total FROM hot_news WHERE ${whereSql}
      `);
      total = Number(totalResult[0]?.total ?? 0n);

      if (repsResult.length === 0) {
        return { items: [], page, pageSize, total };
      }
      const ids = repsResult.map((r) => r.id);
      const rows = await prisma.hotNews.findMany({
        where: { id: { in: ids } },
        select: fullSelect,
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      orderedReps = ids
        .map((id) => byId.get(id))
        .filter((r): r is HydratedRep => r != null);
    } else {
      // Build the WHERE fragment manually so we can plug it into raw SQL
      // alongside the DISTINCT-ON. Identical semantics to `where` above
      // (including SP-10 user-range override + tag AND filter).
      const platformWindowFragments = effectivePlatforms.map(
        (p) => Prisma.sql`(
          "sourcePlatform" = ${Prisma.raw(`'${p}'`)}::"Platform"
          AND "publishedAt" >= ${new Date(
            now.getTime() - (userHours ?? PLATFORM_WINDOW_HOURS[p]) * 60 * 60 * 1000,
          )}
        )`,
      );
      // SP-10: tag filter on fold path uses Postgres `@>` (array contains).
      // Prisma.sql parameterizes the tag array; cast as text[] for the column.
      const tagFragment = hasTagFilter
        ? Prisma.sql`AND "aiTags" @> ${tags}::text[]`
        : Prisma.empty;
      // SP-12 (2026-05-22 hot-patch): see comment in the expand+q branch
      // above — using ILIKE instead of `%` to avoid the 0.3 similarity
      // threshold rejection on short queries (e.g. "OpenAI" scores 0.29).
      // similarity() in ORDER BY below still drives "most relevant first".
      const searchFragment = hasQuery
        ? Prisma.sql`AND ${SEARCH_TEXT_SQL} ILIKE ${'%' + query + '%'}`
        : Prisma.empty;
      const whereSql = Prisma.sql`
        status = 'VISIBLE'::"ContentStatus"
        AND (${Prisma.join(platformWindowFragments, ' OR ')})
        ${tagFragment}
        ${searchFragment}
      `;

      // Order expression. For heat sort: heatScore desc, publishedAt desc.
      // For time sort: publishedAt desc.
      // SP-12: when ?q= is set, similarity becomes the PRIMARY sort key —
      // we want "most relevant" first, then heat/time as tiebreaker. The
      // DISTINCT ON still needs COALESCE("groupId", id) FIRST inside its
      // ORDER BY (Postgres rule), so similarity is appended after it; the
      // outer query re-sorts representatives by `rep_sim` which is the
      // similarity score carried up from the CTE.
      const orderSql = hasQuery
        ? sort === 'heat'
          ? Prisma.sql`ORDER BY COALESCE("groupId", id), similarity(${SEARCH_TEXT_SQL}, ${query}::text) DESC, "heatScore" DESC, "publishedAt" DESC`
          : Prisma.sql`ORDER BY COALESCE("groupId", id), similarity(${SEARCH_TEXT_SQL}, ${query}::text) DESC, "publishedAt" DESC`
        : sort === 'heat'
          ? Prisma.sql`ORDER BY COALESCE("groupId", id), "heatScore" DESC, "publishedAt" DESC`
          : Prisma.sql`ORDER BY COALESCE("groupId", id), "publishedAt" DESC`;
      const finalOrderSql = hasQuery
        ? Prisma.sql`ORDER BY rep_sim DESC, rep_published DESC`
        : sort === 'heat'
          ? Prisma.sql`ORDER BY rep_heat DESC, rep_published DESC`
          : Prisma.sql`ORDER BY rep_published DESC`;

      // The CTE picks one representative per bucket via DISTINCT ON + the
      // sort-aware tiebreaker; the outer query re-orders the representatives
      // among themselves and applies LIMIT/OFFSET for accurate pagination.
      // SP-12: when q is set, additionally carry the per-rep similarity
      // score (`rep_sim`) into the outer query for final ordering.
      const repSimColumn = hasQuery
        ? Prisma.sql`, similarity(${SEARCH_TEXT_SQL}, ${query}::text) AS rep_sim`
        : Prisma.empty;
      const repsResult = await prisma.$queryRaw<
        Array<{ id: string }>
      >(Prisma.sql`
        WITH reps AS (
          SELECT DISTINCT ON (COALESCE("groupId", id))
            id,
            "heatScore" AS rep_heat,
            "publishedAt" AS rep_published
            ${repSimColumn}
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

  // ──────────────────────────────────────────────────────────────────────
  // SP-11: detail page (/hot-news/:id)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Returns the full row payload for a single hot_news id, or null if the
   * row doesn't exist (controller turns null into 404).
   *
   * `relatedItems` selection rules (SP-11 spec §0 Q11):
   *   1. If the row has a `groupId`, look up VISIBLE siblings in the same
   *      group, exclude self, take top 5 by heatScore DESC.
   *   2. If step 1 yields 0 rows (singleton or empty group on this page)
   *      AND the row has at least one `aiTags`, fall back to any VISIBLE
   *      row with `aiTags hasSome [...self.aiTags]`, exclude self, take
   *      top 5 by heatScore DESC.
   *   3. Otherwise return an empty array.
   *
   * The fallback chain matches the spec — singletons with tags get a
   * "related by topic" surface, fully-orphaned rows get nothing rather
   * than misleading random suggestions.
   */
  async detail(id: string): Promise<HotNewsDetailDto | null> {
    const prisma = getPrisma();
    const row = await prisma.hotNews.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        titleZh: true,
        summary: true,
        content: true,
        sourcePlatform: true,
        sourceUrl: true,
        author: true,
        publishedAt: true,
        crawledAt: true,
        aiTags: true,
        matchedKeywords: true,
        heatScore: true,
        heatLevel: true,
        groupId: true,
        extractStatus: true,
      },
    });
    if (!row) return null;

    let related: HotNewsRelatedDto[] = [];
    const relatedSelect = {
      id: true,
      title: true,
      titleZh: true,
      sourcePlatform: true,
      heatScore: true,
      heatLevel: true,
      publishedAt: true,
    } as const;

    if (row.groupId) {
      const siblings = await prisma.hotNews.findMany({
        where: {
          groupId: row.groupId,
          id: { not: id },
          status: ContentStatus.VISIBLE,
        },
        orderBy: { heatScore: 'desc' },
        take: 5,
        select: relatedSelect,
      });
      related = siblings.map(toRelated);
    }

    if (related.length === 0 && row.aiTags.length > 0) {
      const tagMatches = await prisma.hotNews.findMany({
        where: {
          aiTags: { hasSome: row.aiTags },
          id: { not: id },
          status: ContentStatus.VISIBLE,
        },
        orderBy: { heatScore: 'desc' },
        take: 5,
        select: relatedSelect,
      });
      related = tagMatches.map(toRelated);
    }

    return {
      id: row.id,
      title: row.title,
      titleZh: row.titleZh,
      summary: row.summary,
      content: row.content,
      sourcePlatform: row.sourcePlatform,
      sourceUrl: row.sourceUrl,
      author: row.author,
      publishedAt: row.publishedAt.toISOString(),
      crawledAt: row.crawledAt.toISOString(),
      aiTags: row.aiTags,
      matchedKeywords: row.matchedKeywords,
      heatScore: row.heatScore,
      heatLevel: row.heatLevel,
      groupId: row.groupId,
      extractStatus: row.extractStatus,
      relatedItems: related,
    };
  }

  /**
   * Returns the 30-min heat snapshot series for the past `hours` window
   * (SP-11 spec §4.2). `hours` is restricted to 24 | 48 | 72 by the
   * controller's pipe; bad values fall back to 48 there so this method
   * trusts its input.
   *
   * No row-existence check: if the id is bogus, the caller still gets a
   * well-formed empty series (200 OK with `items: []`) — matches the
   * detail page's behavior of rendering "暂无数据" rather than 404 when
   * heat history is missing.
   */
  async heatHistory(id: string, hours: 24 | 48 | 72): Promise<HeatHistoryDto> {
    const prisma = getPrisma();
    const now = new Date();
    const windowStart = new Date(now.getTime() - hours * 60 * 60 * 1000);

    const rows = await prisma.heatHistory.findMany({
      where: {
        hotNewsId: id,
        bucketAt: { gte: windowStart },
      },
      orderBy: { bucketAt: 'asc' },
      select: { bucketAt: true, heatScore: true, heatLevel: true },
    });

    return {
      items: rows.map((r) => ({
        bucketAt: r.bucketAt.toISOString(),
        heatScore: r.heatScore,
        heatLevel: r.heatLevel,
      })),
      windowStart: windowStart.toISOString(),
      windowEnd: now.toISOString(),
      hours,
    };
  }
}

function toRelated(r: {
  id: string;
  title: string;
  titleZh: string | null;
  sourcePlatform: Platform;
  heatScore: number;
  heatLevel: 'BURST' | 'HOT' | 'NORMAL' | 'LOW';
  publishedAt: Date;
}): HotNewsRelatedDto {
  return {
    id: r.id,
    title: r.title,
    titleZh: r.titleZh,
    sourcePlatform: r.sourcePlatform,
    heatScore: r.heatScore,
    heatLevel: r.heatLevel,
    publishedAt: r.publishedAt.toISOString(),
  };
}
