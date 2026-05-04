import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Platform, getPrisma } from '@ai-hot-news/db';
import type { RawCrawledItem } from '@ai-hot-news/types';
import { IngestionService } from './ingestion.service';

const prisma = getPrisma();
const ingestion = new IngestionService();

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
    title: `Item ${n}`,
    contentText: `body ${n}`,
    rawHtml: `<p>body ${n}</p>`,
    sourceUrl: `https://lab.example.com/post/${n}?utm_source=rss`,
    author: 'Alice',
    publishedAt: new Date('2026-05-01T08:00:00.000Z'),
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
  beforeEach(cleanup);

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
          title: 'GPT-5 announced',
          contentText: 'GPT-5 announced',
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
        skipped: 0,
        hidden: 0,
        failed: 0,
      });

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: `${HN_URL_PREFIX}44000001` },
      });
      expect(row.sourcePlatform).toBe(Platform.HACKERNEWS);
      expect(row.title).toBe('GPT-5 announced');
      expect(row.rawHtml).toBeNull();
      expect(row.interactionData).toMatchObject({
        score: 234,
        comments: 45,
        externalUrl: 'https://openai.com/news/gpt-5',
        hnId: 44000001,
      });
    });

    it('does NOT overwrite interactionData on duplicate sourceUrl', async () => {
      const sourceUrl = `${HN_URL_PREFIX}44000002`;

      await ingestion.ingest(
        [
          {
            title: 'First insert',
            contentText: 'First insert',
            rawHtml: null,
            sourceUrl,
            author: 'bob',
            publishedAt: new Date('2026-05-03T01:00:00Z'),
            interactionData: { score: 10, comments: 1, externalUrl: null, hnId: 44000002 },
          },
        ],
        HN_SOURCE,
      );

      const result2 = await ingestion.ingest(
        [
          {
            title: 'First insert',
            contentText: 'First insert',
            rawHtml: null,
            sourceUrl,
            author: 'bob',
            publishedAt: new Date('2026-05-03T01:00:00Z'),
            interactionData: { score: 999, comments: 99, externalUrl: null, hnId: 44000002 },
          },
        ],
        HN_SOURCE,
      );

      expect(result2).toEqual({
        fetched: 1,
        inserted: 0,
        skipped: 1,
        hidden: 0,
        failed: 0,
      });

      const row = await prisma.hotNews.findFirstOrThrow({ where: { sourceUrl } });
      expect(row.interactionData).toMatchObject({ score: 10, comments: 1 });
    });

    it('handles items missing interactionData (omitted, not null)', async () => {
      const sourceUrl = `${HN_URL_PREFIX}44000003`;

      await ingestion.ingest(
        [
          {
            title: 'No interaction data',
            contentText: 'No interaction data',
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
  });

  describe('REDDIT platform', () => {
    it('inserts a REDDIT item with full interactionData (6 fields)', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'GPT-5 announced',
          contentText: 'GPT-5 announced',
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
        skipped: 0,
        hidden: 0,
        failed: 0,
      });

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: `${REDDIT_URL_PREFIX}OpenAI/comments/1k4xz9p` },
      });
      expect(row.sourcePlatform).toBe(Platform.REDDIT);
      expect(row.title).toBe('GPT-5 announced');
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
            title: 'Cold post',
            contentText: 'Cold post',
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

    it('does NOT overwrite interactionData on duplicate sourceUrl (first-write-wins)', async () => {
      const sourceUrl = `${REDDIT_URL_PREFIX}OpenAI/comments/1k4xz9z`;

      await ingestion.ingest(
        [
          {
            title: 'First insert',
            contentText: 'First insert',
            rawHtml: null,
            sourceUrl,
            author: 'user_first',
            publishedAt: new Date('2026-05-03T01:00:00Z'),
            interactionData: {
              score: 10,
              comments: 1,
              externalUrl: null,
              redditId: '1k4xz9z',
              redditSubreddit: 'OpenAI',
              redditUpvoteRatio: 0.5,
            },
          },
        ],
        REDDIT_SOURCE,
      );

      const result2 = await ingestion.ingest(
        [
          {
            title: 'Second insert',
            contentText: 'Second insert',
            rawHtml: null,
            sourceUrl,
            author: 'user_second',
            publishedAt: new Date('2026-05-03T01:00:00Z'),
            interactionData: {
              score: 999,
              comments: 99,
              externalUrl: null,
              redditId: '1k4xz9z',
              redditSubreddit: 'OpenAI',
              redditUpvoteRatio: 0.99,
            },
          },
        ],
        REDDIT_SOURCE,
      );

      expect(result2).toEqual({
        fetched: 1,
        inserted: 0,
        skipped: 1,
        hidden: 0,
        failed: 0,
      });

      const row = await prisma.hotNews.findFirstOrThrow({ where: { sourceUrl } });
      expect(row.interactionData).toMatchObject({
        score: 10,
        comments: 1,
        redditUpvoteRatio: 0.5,
      });
    });
  });

  describe('SP-4 quality + cleaning', () => {
    it('honors raw.filterReason from crawler → status=HIDDEN + filterReason persisted', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'Low ratio reddit post',
          contentText: 'Body',
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
        skipped: 0,
        hidden: 1,
        failed: 0,
      });

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: `${REDDIT_URL_PREFIX}OpenAI/comments/sp4_lowratio` },
      });
      expect(row.status).toBe('HIDDEN');
      expect(row.filterReason).toBe('reddit_low_ratio');
    });

    it('falls back to checkUniversalQuality when crawler did not set filterReason (short title)', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'abc',
          contentText: 'body',
          rawHtml: null,
          sourceUrl: 'https://lab.example.com/post/sp4_short',
          author: null,
          publishedAt: new Date('2026-05-04T00:00:00Z'),
        },
      ];

      const result = await ingestion.ingest(items, RSS_SOURCE);
      expect(result.hidden).toBe(1);
      expect(result.inserted).toBe(0);

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: 'https://lab.example.com/post/sp4_short' },
      });
      expect(row.status).toBe('HIDDEN');
      expect(row.filterReason).toBe('title_too_short');
    });

    it('cleans the title (strips boilerplate suffix) before storing', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'GPT-5 announced - OpenAI Blog',
          contentText: 'body',
          rawHtml: null,
          sourceUrl: 'https://lab.example.com/post/sp4_clean',
          author: null,
          publishedAt: new Date('2026-05-04T00:00:00Z'),
        },
      ];

      const result = await ingestion.ingest(items, RSS_SOURCE);
      expect(result.inserted).toBe(1);

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: 'https://lab.example.com/post/sp4_clean' },
      });
      expect(row.title).toBe('GPT-5 announced');
    });

    it('cleans the content (strips Read more tail + collapses whitespace)', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'A reasonable title',
          contentText: 'a    b\t\tc\n\n\n\nd. Read more →',
          rawHtml: null,
          sourceUrl: 'https://lab.example.com/post/sp4_content',
          author: null,
          publishedAt: new Date('2026-05-04T00:00:00Z'),
        },
      ];

      const result = await ingestion.ingest(items, RSS_SOURCE);
      expect(result.inserted).toBe(1);

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: 'https://lab.example.com/post/sp4_content' },
      });
      expect(row.content).toBe('a b c\n\nd.');
    });
  });
});
