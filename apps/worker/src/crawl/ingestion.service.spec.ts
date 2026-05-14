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
      findFirst: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prismaMock = {
      hotNews: {
        create: vi.fn().mockResolvedValue({ id: 'mock-id' }),
        update: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    vi.spyOn(dbModule, 'getPrisma').mockReturnValue(
      prismaMock as unknown as ReturnType<typeof dbModule.getPrisma>,
    );
    service = new IngestionService(
      { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue,
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
            title: 'OpenAI releases a new LLM',
            contentText: 'OpenAI releases a new LLM',
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
            title: 'OpenAI releases a new LLM',
            contentText: 'OpenAI releases a new LLM',
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

  describe('SP-5 v3.2 L0-skip AI topic filter', () => {
    it('inserts AI topic items as VISIBLE and enqueues summary', async () => {
      const summaryQueueAdd = vi.fn().mockResolvedValue(undefined);
      const summaryQueue = { add: summaryQueueAdd } as unknown as Queue;
      const extractQueue = { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue;
      const heatQueue = { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue;
      service = new IngestionService(summaryQueue, extractQueue, heatQueue);

      const result = await service.ingest(
        [
          {
            title: 'Show HN: AI Agent for code review',
            contentText: 'AI Agent for code review',
            rawHtml: null,
            sourceUrl: 'https://news.ycombinator.com/item?id=50000001',
            author: 'alice',
            publishedAt: new Date('2026-05-06T00:00:00Z'),
            filterReason: null,
          },
        ],
        { id: 's2', platform: Platform.HACKERNEWS, url: null, identifier: 'top', name: 'HN' },
      );

      expect(result).toEqual({
        fetched: 1,
        inserted: 1,
        upserted: 0,
        skipped: 0,
        skippedQuality: 0,
        skippedNonAi: 0,
        skippedDedupe: 0,
        hidden: 0,
        failed: 0,
      });
      expect(prismaMock.hotNews.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'VISIBLE',
            filterReason: null,
          }),
        }),
      );
      expect(summaryQueueAdd).toHaveBeenCalledTimes(1);
    });

    it('skips quality-failed items without inserting HIDDEN rows', async () => {
      const result = await service.ingest(
        [
          {
            title: 'AI',
            contentText: 'AI',
            rawHtml: null,
            sourceUrl: 'https://news.ycombinator.com/item?id=50000002',
            author: null,
            publishedAt: new Date('2026-05-06T00:00:00Z'),
            filterReason: 'title_too_short',
          },
        ],
        { id: 's2', platform: Platform.HACKERNEWS, url: null, identifier: 'top', name: 'HN' },
      );

      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.skippedQuality).toBe(1);
      expect(result.skippedNonAi).toBe(0);
      expect(prismaMock.hotNews.create).not.toHaveBeenCalled();
    });

    it('skips non-AI items without inserting HIDDEN rows', async () => {
      const result = await service.ingest(
        [
          {
            title: 'Cricket India vs Pakistan score',
            contentText: 'Cricket India vs Pakistan score',
            rawHtml: null,
            sourceUrl: 'https://news.ycombinator.com/item?id=50000003',
            author: null,
            publishedAt: new Date('2026-05-06T00:00:00Z'),
            filterReason: null,
          },
        ],
        { id: 's2', platform: Platform.HACKERNEWS, url: null, identifier: 'top', name: 'HN' },
      );

      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.skippedQuality).toBe(0);
      expect(result.skippedNonAi).toBe(1);
      expect(prismaMock.hotNews.create).not.toHaveBeenCalled();
    });

    it('increments skippedDedupe on P2002 after passing L0 checks', async () => {
      prismaMock.hotNews.create.mockRejectedValueOnce({ code: 'P2002' });

      const result = await service.ingest(
        [
          {
            title: 'OpenAI releases a new LLM',
            contentText: 'OpenAI releases a new LLM',
            rawHtml: null,
            sourceUrl: 'https://news.ycombinator.com/item?id=50000004',
            author: null,
            publishedAt: new Date('2026-05-06T00:00:00Z'),
            filterReason: null,
          },
        ],
        { id: 's2', platform: Platform.HACKERNEWS, url: null, identifier: 'top', name: 'HN' },
      );

      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.skippedDedupe).toBe(1);
      expect(result.failed).toBe(0);
    });
  });

  describe('SP-5.5 trustedSource bypass', () => {
    it('admits a non-AI-keyword title when trustedSource=true (Reddit HIGH-domain link)', async () => {
      // Title alone would fail matchesAiTopic — "DS4" / "MacBooks" don't
      // hit any keyword. But the crawler set trustedSource=true (link is
      // github.com → HIGH), so IngestionService bypasses the keyword gate.
      const result = await service.ingest(
        [
          {
            title: 'DS4: a flash specific inference engine for 128gb MacBooks',
            contentText: 'DS4: a flash specific inference engine for 128gb MacBooks',
            rawHtml: null,
            sourceUrl: 'https://www.reddit.com/r/LocalLLaMA/comments/sp5-5-trust',
            author: 'researcher',
            publishedAt: new Date('2026-05-06T00:00:00Z'),
            filterReason: null,
            trustedSource: true,
          },
        ],
        { id: 's3', platform: Platform.REDDIT, url: null, identifier: 'LocalLLaMA', name: 'r/LocalLLaMA' },
      );

      expect(result.inserted).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.skippedNonAi).toBe(0);
      expect(prismaMock.hotNews.create).toHaveBeenCalledTimes(1);
    });

    it('still drops on quality failure even when trustedSource=true (quality is checked first)', async () => {
      const result = await service.ingest(
        [
          {
            title: 'a',
            contentText: 'a',
            rawHtml: null,
            sourceUrl: 'https://www.reddit.com/r/LocalLLaMA/comments/sp5-5-trust-q',
            author: null,
            publishedAt: new Date('2026-05-06T00:00:00Z'),
            filterReason: 'title_too_short',
            trustedSource: true,
          },
        ],
        { id: 's3', platform: Platform.REDDIT, url: null, identifier: 'LocalLLaMA', name: 'r/LocalLLaMA' },
      );

      expect(result.inserted).toBe(0);
      expect(result.skippedQuality).toBe(1);
    });

    it('falls back to nonAi check when trustedSource is undefined (backwards compat)', async () => {
      const result = await service.ingest(
        [
          {
            title: 'Cricket India vs Pakistan score',
            contentText: 'Cricket India vs Pakistan score',
            rawHtml: null,
            sourceUrl: 'https://news.ycombinator.com/item?id=50000099',
            author: null,
            publishedAt: new Date('2026-05-06T00:00:00Z'),
            filterReason: null,
            // trustedSource intentionally undefined
          },
        ],
        { id: 's2', platform: Platform.HACKERNEWS, url: null, identifier: 'top', name: 'HN' },
      );

      expect(result.skippedNonAi).toBe(1);
    });
  });

  describe('SP-6 upsert + heat queue push', () => {
    let heatQueueAdd: ReturnType<typeof vi.fn>;
    let summaryQueueAdd: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      heatQueueAdd = vi.fn().mockResolvedValue(undefined);
      summaryQueueAdd = vi.fn().mockResolvedValue(undefined);
      const summaryQueue = { add: summaryQueueAdd } as unknown as Queue;
      const extractQueue = {
        add: vi.fn().mockResolvedValue(undefined),
      } as unknown as Queue;
      const heatQueue = { add: heatQueueAdd } as unknown as Queue;
      service = new IngestionService(summaryQueue, extractQueue, heatQueue);
    });

    it('pushes heat:<id> after a successful INSERT', async () => {
      prismaMock.hotNews.create.mockResolvedValue({ id: 'h-new' });
      await service.ingest(
        [
          {
            title: 'A new HN post about GPT-5',
            contentText: 'A new HN post about GPT-5',
            rawHtml: null,
            sourceUrl: 'https://news.ycombinator.com/item?id=99001',
            author: 'researcher',
            publishedAt: new Date('2026-05-09T12:00:00Z'),
            interactionData: { score: 100, comments: 20 },
          },
        ],
        {
          id: 's1',
          platform: Platform.HACKERNEWS,
          url: null,
          identifier: 'top',
          name: 'HN Top',
        },
      );
      expect(heatQueueAdd).toHaveBeenCalledWith(
        'heat',
        { hotNewsId: 'h-new' },
        expect.objectContaining({ jobId: 'heat-h-new' }),
      );
    });

    it('on duplicate sourceUrl: UPDATEs interactionData (preserves title/content) and pushes heat:<id>', async () => {
      prismaMock.hotNews.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
      );
      prismaMock.hotNews.findFirst.mockResolvedValue({ id: 'h-existing' });
      prismaMock.hotNews.update.mockResolvedValue({ id: 'h-existing' });

      const result = await service.ingest(
        [
          {
            title: 'Stale GPT-5 title — should NOT overwrite existing',
            contentText: 'Stale GPT-5 body — should NOT overwrite existing',
            rawHtml: null,
            sourceUrl: 'https://news.ycombinator.com/item?id=99002',
            author: 'researcher',
            publishedAt: new Date('2026-05-09T12:00:00Z'),
            interactionData: { score: 250, comments: 50 },
          },
        ],
        {
          id: 's1',
          platform: Platform.HACKERNEWS,
          url: null,
          identifier: 'top',
          name: 'HN Top',
        },
      );

      expect(result.skippedDedupe).toBe(0);
      expect(result.upserted).toBe(1);

      const updateArgs = prismaMock.hotNews.update.mock.calls[0]![0]!;
      expect(updateArgs.where).toEqual({ id: 'h-existing' });
      expect(updateArgs.data).toEqual({
        interactionData: { score: 250, comments: 50 },
      });

      expect(heatQueueAdd).toHaveBeenCalledWith(
        'heat',
        { hotNewsId: 'h-existing' },
        expect.objectContaining({ jobId: 'heat-h-existing' }),
      );

      expect(summaryQueueAdd).not.toHaveBeenCalled();
    });

    it('upsert with raw.interactionData=null is a no-op for that field (does NOT clobber existing data)', async () => {
      prismaMock.hotNews.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
      );
      prismaMock.hotNews.findFirst.mockResolvedValue({ id: 'h-existing' });

      const result = await service.ingest(
        [
          {
            title: 'Claude 4 launches new agentic abilities',
            contentText: 'Claude 4 launches new agentic abilities',
            rawHtml: null,
            sourceUrl: 'https://news.ycombinator.com/item?id=99003',
            author: null,
            publishedAt: new Date('2026-05-09T12:00:00Z'),
            interactionData: null,
          },
        ],
        {
          id: 's1',
          platform: Platform.HACKERNEWS,
          url: null,
          identifier: 'top',
          name: 'HN Top',
        },
      );

      expect(prismaMock.hotNews.update).not.toHaveBeenCalled();
      expect(result.upserted).toBe(0);
      expect(result.skippedDedupe).toBe(1);
    });
  });
});
