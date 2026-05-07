import { Injectable } from '@nestjs/common';
import { getPrisma, ContentStatus, type Platform } from '@ai-hot-news/db';
import type { HotNewsListResponseDto } from '@ai-hot-news/types';

const PLATFORM_WINDOW_HOURS: Record<Platform, number> = {
  TWITTER: 48, // unused for now, but typesafe for future
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
  ): Promise<HotNewsListResponseDto> {
    const prisma = getPrisma();
    const skip = (page - 1) * pageSize;
    const effectivePlatforms = platforms?.length ? platforms : DEFAULT_PLATFORMS;
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

    const [rows, total] = await prisma.$transaction([
      prisma.hotNews.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { publishedAt: 'desc' },
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
        },
      }),
      prisma.hotNews.count({ where }),
    ]);
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
      })),
      page,
      pageSize,
      total,
    };
  }
}
