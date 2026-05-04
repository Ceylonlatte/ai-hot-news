import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HotNewsService } from './hot-news.service';
import * as dbModule from '@ai-hot-news/db';

describe('HotNewsService', () => {
  let service: HotNewsService;
  let prismaMock: {
    hotNews: {
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prismaMock = {
      hotNews: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn().mockImplementation(async (calls: Promise<unknown>[]) => {
        return Promise.all(calls);
      }),
    };
    vi.spyOn(dbModule, 'getPrisma').mockReturnValue(
      prismaMock as unknown as ReturnType<typeof dbModule.getPrisma>,
    );
    service = new HotNewsService();
  });

  it('passes where: { status: "VISIBLE" } to findMany by default (SP-4)', async () => {
    await service.list(1, 20);
    expect(prismaMock.hotNews.findMany).toHaveBeenCalledTimes(1);
    const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
    expect(findManyArgs.where).toEqual({ status: 'VISIBLE' });
  });

  it('passes where: { status: "VISIBLE" } to count by default (SP-4)', async () => {
    await service.list(1, 20);
    expect(prismaMock.hotNews.count).toHaveBeenCalledTimes(1);
    const countArgs = prismaMock.hotNews.count.mock.calls[0]![0]!;
    expect(countArgs.where).toEqual({ status: 'VISIBLE' });
  });

  it('does NOT include status / filterReason in the DTO output', async () => {
    prismaMock.hotNews.findMany.mockResolvedValueOnce([
      {
        id: 'a',
        title: 'A',
        sourceUrl: 'https://example.com/a',
        sourcePlatform: 'RSS',
        author: null,
        publishedAt: new Date('2026-05-04T00:00:00Z'),
        crawledAt: new Date('2026-05-04T00:00:00Z'),
      },
    ]);
    prismaMock.hotNews.count.mockResolvedValueOnce(1);

    const result = await service.list(1, 20);

    expect(result.items[0]).not.toHaveProperty('status');
    expect(result.items[0]).not.toHaveProperty('filterReason');
  });
});
