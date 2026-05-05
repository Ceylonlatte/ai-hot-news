import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { Platform } from '@ai-hot-news/db';
import * as dbModule from '@ai-hot-news/db';
import { IngestionService } from './ingestion.service';

describe('IngestionService', () => {
  let service: IngestionService;
  let prismaMock: {
    hotNews: {
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prismaMock = {
      hotNews: {
        create: vi.fn().mockResolvedValue({ id: 'mock-id' }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    vi.spyOn(dbModule, 'getPrisma').mockReturnValue(
      prismaMock as unknown as ReturnType<typeof dbModule.getPrisma>,
    );
    service = new IngestionService(
      { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue,
      { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue,
    );
  });

  describe('SP-4.5 RSS ingest window', () => {
    const NOW = new Date('2026-05-10T12:00:00Z');
    const cutoff = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000); // 2026-05-03T12:00:00Z

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });
    afterEach(() => vi.useRealTimers());

    it('drops RSS item with publishedAt outside the 7d window (counted as skipped)', async () => {
      const result = await service.ingest(
        [
          {
            title: 'Old RSS post that should be dropped',
            contentText: 'body',
            rawHtml: null,
            sourceUrl: 'https://openai.com/blog/old-2015',
            author: null,
            publishedAt: new Date('2025-01-01T00:00:00Z'),
            filterReason: null,
          },
        ],
        { id: 's1', platform: Platform.RSS, url: '...', identifier: null, name: 'OpenAI' },
      );
      expect(result.skipped).toBe(1);
      expect(result.inserted).toBe(0);
      expect(prismaMock.hotNews.create).not.toHaveBeenCalled();
    });

    it('drops RSS item with null publishedAt (cannot prove it is fresh)', async () => {
      const result = await service.ingest(
        [
          {
            title: 'No date title here',
            contentText: 'body',
            rawHtml: null,
            sourceUrl: 'https://openai.com/blog/no-date',
            author: null,
            publishedAt: null,
            filterReason: null,
          },
        ],
        { id: 's1', platform: Platform.RSS, url: '...', identifier: null, name: 'OpenAI' },
      );
      expect(result.skipped).toBe(1);
      expect(prismaMock.hotNews.create).not.toHaveBeenCalled();
    });

    it('keeps RSS item with publishedAt exactly at the cutoff boundary (>=)', async () => {
      await service.ingest(
        [
          {
            title: 'Edge case at the boundary',
            contentText: 'body',
            rawHtml: null,
            sourceUrl: 'https://openai.com/blog/edge',
            author: null,
            publishedAt: cutoff,
            filterReason: null,
          },
        ],
        { id: 's1', platform: Platform.RSS, url: '...', identifier: null, name: 'OpenAI' },
      );
      expect(prismaMock.hotNews.create).toHaveBeenCalledTimes(1);
    });

    it('does NOT apply window cutoff to HN or Reddit (publishedAt: null still gets crawledAt fallback)', async () => {
      const veryOld = new Date('2024-01-01T00:00:00Z');
      await service.ingest(
        [
          {
            title: 'HN old item should still be ingested',
            contentText: 'body',
            rawHtml: null,
            sourceUrl: 'https://news.ycombinator.com/item?id=1',
            author: null,
            publishedAt: veryOld,
            filterReason: null,
          },
        ],
        { id: 's2', platform: Platform.HACKERNEWS, url: null, identifier: 'hn', name: 'HN' },
      );
      expect(prismaMock.hotNews.create).toHaveBeenCalledTimes(1);
    });
  });
});
