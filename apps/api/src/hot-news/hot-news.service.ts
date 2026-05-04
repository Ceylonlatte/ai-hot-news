import { Injectable } from '@nestjs/common';
import { getPrisma, ContentStatus } from '@ai-hot-news/db';
import type { HotNewsListResponseDto } from '@ai-hot-news/types';

@Injectable()
export class HotNewsService {
  async list(page: number, pageSize: number): Promise<HotNewsListResponseDto> {
    const prisma = getPrisma();
    const skip = (page - 1) * pageSize;
    const where = { status: ContentStatus.VISIBLE };
    const [rows, total] = await prisma.$transaction([
      prisma.hotNews.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { publishedAt: 'desc' },
        select: {
          id: true,
          title: true,
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
