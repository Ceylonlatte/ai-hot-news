import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { Platform, getPrisma } from '@ai-hot-news/db';
import type { RawCrawledItem } from '@ai-hot-news/types';
import { IngestionService } from './ingestion.service';

const prisma = getPrisma();
let ingestion: IngestionService;
let summaryQueueAdd: ReturnType<typeof vi.fn>;
let extractQueueAdd: ReturnType<typeof vi.fn>;
let heatQueueAdd: ReturnType<typeof vi.fn>;

const RSS_SOURCE = {
  id: 'test-src',
  platform: Platform.RSS,
  url: 'https://lab.example.com/feed.xml',
  identifier: null,
  name: 'Test Source',
};

const HN_SOURCE = {
  id: 'test-hn-src',
  platform: Platform.HACKERNEWS,
  url: null,
  identifier: 'top',
  name: 'Test HN Source',
};

const HN_URL_PREFIX = 'https://news.ycombinator.com/item?id=';

const REDDIT_URL_PREFIX = 'https://www.reddit.com/r/';

const REDDIT_SOURCE = {
  id: 'test-redd-src',
  platform: Platform.REDDIT,
  url: null,
  identifier: 'OpenAI',
  name: 'r/OpenAI Test',
};

function makeItem(n: number): RawCrawledItem {
  return {
    title: `OpenAI launches GPT-5 update ${n}`,
    contentText: `OpenAI launches GPT-5 update ${n}`,
    rawHtml: `<p>OpenAI launches GPT-5 update ${n}</p>`,
    sourceUrl: `https://lab.example.com/post/${n}?utm_source=rss`,
    author: 'Alice',
    // SP-4.5 RSS 7d window — keep fixture relative to "now" so the suite
    // doesn't decay (a fixed date drifts past the window after one week).
    publishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  };
}

async function cleanup() {
  await prisma.hotNews.deleteMany({
    where: {
      OR: [
        { sourceUrl: { startsWith: 'https://lab.example.com/post/' } },
        { sourceUrl: { startsWith: HN_URL_PREFIX } },
        { sourceUrl: { startsWith: REDDIT_URL_PREFIX } },
      ],
    },
  });
}

describe('IngestionService (integration)', () => {
  beforeEach(async () => {
    summaryQueueAdd = vi.fn().mockResolvedValue(undefined);
    extractQueueAdd = vi.fn().mockResolvedValue(undefined);
    heatQueueAdd = vi.fn().mockResolvedValue(undefined);
    ingestion = new IngestionService(
      { add: summaryQueueAdd } as unknown as Queue,
      { add: extractQueueAdd } as unknown as Queue,
      { add: heatQueueAdd } as unknown as Queue,
    );
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('inserts new items and dedupes repeated ingests', async () => {
    const batch = Array.from({ length: 12 }, (_, i) => makeItem(i + 1));
    const first = await ingestion.ingest(batch, RSS_SOURCE);
    expect(first.fetched).toBe(12);
    expect(first.inserted).toBe(12);
    expect(first.failed).toBe(0);

    const second = await ingestion.ingest(batch, RSS_SOURCE);
    expect(second.fetched).toBe(12);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(12);
  });

  it('skips items missing sourceUrl without failing the batch', async () => {
    const result = await ingestion.ingest(
      [{ ...makeItem(99), sourceUrl: '' }, makeItem(100)],
      RSS_SOURCE,
    );
    expect(result.fetched).toBe(2);
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('normalizes the sourceUrl before storing (utm stripped)', async () => {
    await ingestion.ingest([makeItem(101)], RSS_SOURCE);
    const row = await prisma.hotNews.findFirst({
      where: { sourceUrl: 'https://lab.example.com/post/101' },
    });
    expect(row).not.toBeNull();
    expect(row!.dedupeHash).toMatch(/^[0-9a-f]{32}$/);
  });

  describe('HACKERNEWS platform', () => {
    it('inserts HN items with sourcePlatform=HACKERNEWS and interactionData', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'OpenAI launches GPT-5',
          contentText: 'OpenAI launches GPT-5',
          rawHtml: null,
          sourceUrl: `${HN_URL_PREFIX}44000001`,
          author: 'alice',
          publishedAt: new Date('2026-05-03T00:00:00Z'),
          interactionData: {
            score: 234,
            comments: 45,
            externalUrl: 'https://openai.com/news/gpt-5',
            hnId: 44000001,
          },
        },
      ];

      const result = await ingestion.ingest(items, HN_SOURCE);

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

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: `${HN_URL_PREFIX}44000001` },
      });
      expect(row.sourcePlatform).toBe(Platform.HACKERNEWS);
      expect(row.title).toBe('OpenAI launches GPT-5');
      expect(row.rawHtml).toBeNull();
      expect(row.interactionData).toMatchObject({
        score: 234,
        comments: 45,
        externalUrl: 'https://openai.com/news/gpt-5',
        hnId: 44000001,
      });
    });

    it('DOES upsert interactionData on duplicate sourceUrl, preserves other fields (SP-6)', async () => {
      const sourceUrl = `${HN_URL_PREFIX}44000002`;

      await ingestion.ingest(
        [
          {
            title: 'OpenAI releases a new LLM',
            contentText: 'OpenAI releases a new LLM',
            rawHtml: null,
            sourceUrl,
            author: 'first-author',
            publishedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
            interactionData: { score: 50, comments: 5, externalUrl: null, hnId: 44000002 },
          },
        ],
        HN_SOURCE,
      );

      const result2 = await ingestion.ingest(
        [
          {
            title: 'OpenAI releases a new LLM',
            contentText: 'OpenAI releases a new LLM',
            rawHtml: '<p>STALE HTML</p>',
            sourceUrl,
            author: 'STALE-AUTHOR',
            publishedAt: new Date('2025-01-01T00:00:00Z'),
            interactionData: { score: 250, comments: 80, externalUrl: null, hnId: 44000002 },
          },
        ],
        HN_SOURCE,
      );

      expect(result2).toMatchObject({
        fetched: 1,
        inserted: 0,
        upserted: 1,
        skipped: 0,
        skippedDedupe: 0,
        failed: 0,
      });

      const row = await prisma.hotNews.findFirstOrThrow({ where: { sourceUrl } });
      expect(row.interactionData).toMatchObject({ score: 250, comments: 80 });
      expect(row.author).toBe('first-author');
      expect(row.publishedAt.getTime()).toBeLessThan(Date.now());
      expect(row.publishedAt.getTime()).toBeGreaterThan(Date.now() - 24 * 60 * 60 * 1000);

      expect(heatQueueAdd).toHaveBeenCalledWith(
        'heat',
        { hotNewsId: row.id },
        expect.objectContaining({ jobId: `heat-${row.id}` }),
      );
    });

    it('handles items missing interactionData (omitted, not null)', async () => {
      const sourceUrl = `${HN_URL_PREFIX}44000003`;

      await ingestion.ingest(
        [
          {
            title: 'OpenAI releases a new LLM',
            contentText: 'OpenAI releases a new LLM',
            rawHtml: null,
            sourceUrl,
            author: 'carol',
            publishedAt: new Date('2026-05-03T02:00:00Z'),
          },
        ],
        HN_SOURCE,
      );

      const row = await prisma.hotNews.findFirstOrThrow({ where: { sourceUrl } });
      expect(row.interactionData).toBeNull();
    });

    it('skips non-AI HN rows before insert', async () => {
      const sourceUrl = `${HN_URL_PREFIX}44000901`;

      const result = await ingestion.ingest(
        [
          {
            title: 'Cricket India vs Pakistan score',
            contentText: 'Cricket India vs Pakistan score',
            rawHtml: null,
            sourceUrl,
            author: 'sports',
            publishedAt: new Date('2026-05-03T00:00:00Z'),
            interactionData: { score: 100, comments: 40, externalUrl: null, hnId: 44000901 },
          },
        ],
        HN_SOURCE,
      );

      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.skippedNonAi).toBe(1);
      expect(await prisma.hotNews.findUnique({ where: { sourceUrl } })).toBeNull();
    });

    it('skips low-quality HN rows before insert even when AI-related', async () => {
      const sourceUrl = `${HN_URL_PREFIX}44000902`;

      const result = await ingestion.ingest(
        [
          {
            title: 'OpenAI releases a small LLM update',
            contentText: 'OpenAI releases a small LLM update',
            rawHtml: null,
            sourceUrl,
            author: 'alice',
            publishedAt: new Date('2026-05-03T00:00:00Z'),
            filterReason: 'hn_low_engagement',
            interactionData: { score: 2, comments: 0, externalUrl: null, hnId: 44000902 },
          },
        ],
        HN_SOURCE,
      );

      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.skippedQuality).toBe(1);
      expect(await prisma.hotNews.findUnique({ where: { sourceUrl } })).toBeNull();
    });
  });

  describe('REDDIT platform', () => {
    it('inserts a REDDIT item with full interactionData (6 fields)', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'OpenAI launches GPT-5',
          contentText: 'OpenAI launches GPT-5',
          rawHtml: null,
          sourceUrl: `${REDDIT_URL_PREFIX}OpenAI/comments/1k4xz9p`,
          author: 'user_alice',
          publishedAt: new Date('2026-05-03T00:00:00Z'),
          interactionData: {
            score: 1234,
            comments: 56,
            externalUrl: 'https://openai.com/news/gpt-5',
            redditId: '1k4xz9p',
            redditSubreddit: 'OpenAI',
            redditUpvoteRatio: 0.95,
          },
        },
      ];

      const result = await ingestion.ingest(items, REDDIT_SOURCE);
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

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: `${REDDIT_URL_PREFIX}OpenAI/comments/1k4xz9p` },
      });
      expect(row.sourcePlatform).toBe(Platform.REDDIT);
      expect(row.title).toBe('OpenAI launches GPT-5');
      expect(row.author).toBe('user_alice');
      expect(row.interactionData).toMatchObject({
        score: 1234,
        comments: 56,
        externalUrl: 'https://openai.com/news/gpt-5',
        redditId: '1k4xz9p',
        redditSubreddit: 'OpenAI',
        redditUpvoteRatio: 0.95,
      });
    });

    it('persists redditUpvoteRatio: null verbatim (cold post)', async () => {
      const sourceUrl = `${REDDIT_URL_PREFIX}OpenAI/comments/1k4xz9t`;
      await ingestion.ingest(
        [
          {
            title: 'OpenAI launches GPT-5',
            contentText: 'OpenAI launches GPT-5',
            rawHtml: null,
            sourceUrl,
            author: null,
            publishedAt: new Date('2026-05-03T00:30:00Z'),
            interactionData: {
              score: 2,
              comments: 0,
              externalUrl: null,
              redditId: '1k4xz9t',
              redditSubreddit: 'OpenAI',
              redditUpvoteRatio: null,
            },
          },
        ],
        REDDIT_SOURCE,
      );

      const row = await prisma.hotNews.findFirstOrThrow({ where: { sourceUrl } });
      expect(row.interactionData).toMatchObject({
        redditUpvoteRatio: null,
        redditId: '1k4xz9t',
        redditSubreddit: 'OpenAI',
      });
    });

    it('DOES upsert interactionData on duplicate sourceUrl, preserves other fields (SP-6)', async () => {
      const sourceUrl = `${REDDIT_URL_PREFIX}OpenAI/comments/1k4xz9z`;

      await ingestion.ingest(
        [
          {
            title: 'OpenAI releases a new LLM',
            contentText: 'OpenAI releases a new LLM',
            rawHtml: null,
            sourceUrl,
            author: 'user_first',
            publishedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
            interactionData: {
              score: 100,
              comments: 10,
              externalUrl: null,
              redditId: '1k4xz9z',
              redditSubreddit: 'OpenAI',
              redditUpvoteRatio: 0.85,
            },
          },
        ],
        REDDIT_SOURCE,
      );

      const result2 = await ingestion.ingest(
        [
          {
            title: 'OpenAI releases a new LLM',
            contentText: 'OpenAI releases a new LLM',
            rawHtml: null,
            sourceUrl,
            author: 'STALE',
            publishedAt: new Date('2025-01-01T00:00:00Z'),
            interactionData: {
              score: 1500,
              comments: 230,
              externalUrl: null,
              redditId: '1k4xz9z',
              redditSubreddit: 'OpenAI',
              redditUpvoteRatio: 0.96,
            },
          },
        ],
        REDDIT_SOURCE,
      );

      expect(result2).toMatchObject({
        fetched: 1,
        inserted: 0,
        upserted: 1,
        skipped: 0,
        skippedDedupe: 0,
        failed: 0,
      });

      const row = await prisma.hotNews.findFirstOrThrow({ where: { sourceUrl } });
      expect(row.interactionData).toMatchObject({
        score: 1500,
        comments: 230,
        redditUpvoteRatio: 0.96,
      });
      expect(row.author).toBe('user_first');

      expect(heatQueueAdd).toHaveBeenCalledWith(
        'heat',
        { hotNewsId: row.id },
        expect.objectContaining({ jobId: `heat-${row.id}` }),
      );
    });
  });

  describe('SP-4 quality + cleaning', () => {
    it('honors raw.filterReason from crawler → skipped as quality, no row written', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'OpenAI releases a new LLM',
          contentText: 'OpenAI releases a new LLM',
          rawHtml: null,
          sourceUrl: `${REDDIT_URL_PREFIX}OpenAI/comments/sp4_lowratio`,
          author: 'alice',
          publishedAt: new Date('2026-05-04T00:00:00Z'),
          interactionData: {
            score: 100,
            comments: 50,
            externalUrl: null,
            redditId: 'sp4_lowratio',
            redditSubreddit: 'OpenAI',
            redditUpvoteRatio: 0.4,
          },
          filterReason: 'reddit_low_ratio',
        },
      ];

      const result = await ingestion.ingest(items, REDDIT_SOURCE);
      expect(result).toEqual({
        fetched: 1,
        inserted: 0,
        upserted: 0,
        skipped: 1,
        skippedQuality: 1,
        skippedNonAi: 0,
        skippedDedupe: 0,
        hidden: 0,
        failed: 0,
      });

      const row = await prisma.hotNews.findUnique({
        where: { sourceUrl: `${REDDIT_URL_PREFIX}OpenAI/comments/sp4_lowratio` },
      });
      expect(row).toBeNull();
    });

    it('falls back to checkUniversalQuality when crawler did not set filterReason (short title) → skipped as quality', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'abc',
          contentText: 'body',
          rawHtml: null,
          sourceUrl: 'https://lab.example.com/post/sp4_short',
          author: null,
          // SP-4.5 RSS 7d window — same fix as commit 269dfda for makeItem().
          // A fixed publishedAt drifts past the cutoff once we're more than
          // 7 days after the literal date, breaking the suite on a schedule.
          publishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      ];

      const result = await ingestion.ingest(items, RSS_SOURCE);
      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.skippedQuality).toBe(1);
      expect(result.hidden).toBe(0);

      const row = await prisma.hotNews.findUnique({
        where: { sourceUrl: 'https://lab.example.com/post/sp4_short' },
      });
      expect(row).toBeNull();
    });

    it('cleans the title (strips boilerplate suffix) before storing', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'OpenAI launches GPT-5 - OpenAI Blog',
          contentText: 'OpenAI launches GPT-5',
          rawHtml: null,
          sourceUrl: 'https://lab.example.com/post/sp4_clean',
          author: null,
          publishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      ];

      const result = await ingestion.ingest(items, RSS_SOURCE);
      expect(result.inserted).toBe(1);

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: 'https://lab.example.com/post/sp4_clean' },
      });
      expect(row.title).toBe('OpenAI launches GPT-5');
    });

    it('cleans the content (strips Read more tail + collapses whitespace)', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'OpenAI launches GPT-5',
          contentText: 'OpenAI    LLM\t\tagent\n\n\n\nrelease. Read more →',
          rawHtml: null,
          sourceUrl: 'https://lab.example.com/post/sp4_content',
          author: null,
          publishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      ];

      const result = await ingestion.ingest(items, RSS_SOURCE);
      expect(result.inserted).toBe(1);

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: 'https://lab.example.com/post/sp4_content' },
      });
      expect(row.content).toBe('OpenAI LLM agent\n\nrelease.');
    });
  });

  describe('SP-4.7 enqueue contract', () => {
    it('VISIBLE link-post (HN externalUrl present, content==title) enqueues both extract and summary, sets extractStatus=PENDING', async () => {
      const linkPostItem: RawCrawledItem = {
        title: 'OpenAI launches GPT-5',
        contentText: 'OpenAI launches GPT-5',
        rawHtml: null,
        sourceUrl: `${HN_URL_PREFIX}sp47_linkpost`,
        author: 'someone',
        publishedAt: new Date('2026-05-05T00:00:00Z'),
        filterReason: null,
        interactionData: { externalUrl: 'https://blog.example.com/post' },
      };

      await ingestion.ingest([linkPostItem], HN_SOURCE);

      expect(extractQueueAdd).toHaveBeenCalledWith(
        'extract',
        expect.objectContaining({ hotNewsId: expect.any(String) }),
        expect.objectContaining({ jobId: expect.stringMatching(/^extract-/) }),
      );
      expect(summaryQueueAdd).toHaveBeenCalledWith(
        'summarize',
        expect.objectContaining({ hotNewsId: expect.any(String) }),
        expect.objectContaining({ jobId: expect.stringMatching(/^summarize-/) }),
      );

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: `${HN_URL_PREFIX}sp47_linkpost` },
      });
      expect(row.extractStatus).toBe('PENDING');
    });

    it('VISIBLE self-post (no externalUrl) enqueues only summary, leaves extractStatus=null', async () => {
      const selfPostItem: RawCrawledItem = {
        title: 'Ask HN: how do you ship LLM agents',
        contentText: 'I have been wondering how teams ship LLM agents reliably.',
        rawHtml: null,
        sourceUrl: `${HN_URL_PREFIX}sp47_selfpost`,
        author: 'someone',
        publishedAt: new Date('2026-05-05T00:00:00Z'),
        filterReason: null,
        interactionData: { externalUrl: null },
      };

      await ingestion.ingest([selfPostItem], HN_SOURCE);

      expect(extractQueueAdd).not.toHaveBeenCalled();
      expect(summaryQueueAdd).toHaveBeenCalledTimes(1);

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: `${HN_URL_PREFIX}sp47_selfpost` },
      });
      expect(row.extractStatus).toBeNull();
    });

    it('row skipped by filterReason enqueues neither queue', async () => {
      const lowQuality: RawCrawledItem = {
        title: 'OpenAI launches GPT-5',
        contentText: 'OpenAI launches GPT-5',
        rawHtml: null,
        sourceUrl: `${HN_URL_PREFIX}sp47_hidden`,
        author: null,
        publishedAt: new Date('2026-05-05T00:00:00Z'),
        filterReason: 'reddit_low_ratio',
        interactionData: { externalUrl: 'https://example.com/hidden' },
      };

      await ingestion.ingest([lowQuality], HN_SOURCE);

      expect(extractQueueAdd).not.toHaveBeenCalled();
      expect(summaryQueueAdd).not.toHaveBeenCalled();
    });
  });
});
