import { Injectable } from '@nestjs/common';
import { getPrisma, ContentStatus, type Platform } from '@ai-hot-news/db';
import type { HotNewsListResponseDto } from '@ai-hot-news/types';

const PLATFORM_WINDOW_HOURS: Record<Platform, number> = {
  TWITTER: 48,
  HACKERNEWS: 48,
  REDDIT: 48,
  RSS: 24 * 7,
};

const DEFAULT_PLATFORMS: Platform[] = ['HACKERNEWS', 'REDDIT'];

@Injectable()
export class HotNewsService {
  async list(
    page: number,
    pageSize: number,
    platforms?: Platform[],
    sort: 'time' | 'heat' = 'time',
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
    const orClauses = effectivePlatforms.map((p) => ({
      sourcePlatform: p,
      publishedAt: {
        gte: new Date(now.getTime() - PLATFORM_WINDOW_HOURS[p] * 60 * 60 * 1000),
      },
    }));

    const where = {
      status: ContentStatus.VISIBLE,
      OR: orClauses,
    };

    const orderBy =
      sort === 'heat'
        ? [{ heatScore: 'desc' as const }, { publishedAt: 'desc' as const }]
        : [{ publishedAt: 'desc' as const }];

    const [rows, total] = await prisma.$transaction([
      prisma.hotNews.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        select: {
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
        },
      }),
      prisma.hotNews.count({ where }),
    ]);

    // SP-7: aggregate groupSize via one groupBy query for all non-null
    // groupIds on this page. Counts every VISIBLE member across all
    // platforms (not just members within the current window/platform
    // filter), so "🔗 N 个平台报道" reflects the true cross-platform reach.
    const groupIds = Array.from(
      new Set(rows.map((r) => r.groupId).filter((g): g is string => g !== null)),
    );
    const sizeMap = new Map<string, number>();
    if (groupIds.length > 0) {
      const counts = await prisma.hotNews.groupBy({
        by: ['groupId'],
        where: { groupId: { in: groupIds }, status: ContentStatus.VISIBLE },
        _count: { _all: true },
      });
      for (const c of counts) {
        if (c.groupId) sizeMap.set(c.groupId, c._count._all);
      }
    }

    return {
      items: rows.map((r) => ({
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
      })),
      page,
      pageSize,
      total,
    };
  }
}
