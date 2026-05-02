import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma } from '@ai-hot-news/db';
import { Logger } from '@nestjs/common';
import type { RawCrawledItem } from '@ai-hot-news/types';
import { IngestionService } from './ingestion.service';

const prisma = getPrisma();
const ingestion = new IngestionService(new Logger('IngestionTest'));
const SOURCE = {
  id: 'test-src',
  platform: 'RSS' as const,
  url: 'https://lab.example.com/feed.xml',
  name: 'Test Source',
  enabled: true,
  crawlInterval: 1800,
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

describe('IngestionService (integration)', () => {
  beforeEach(async () => {
    await prisma.hotNews.deleteMany({
      where: { sourceUrl: { startsWith: 'https://lab.example.com/post/' } },
    });
  });

  afterAll(async () => {
    await prisma.hotNews.deleteMany({
      where: { sourceUrl: { startsWith: 'https://lab.example.com/post/' } },
    });
    await prisma.$disconnect();
  });

  it('inserts new items and dedupes repeated ingests', async () => {
    const batch = Array.from({ length: 12 }, (_, i) => makeItem(i + 1));
    const first = await ingestion.ingest(batch, SOURCE);
    expect(first.fetched).toBe(12);
    expect(first.inserted).toBe(12);
    expect(first.failed).toBe(0);

    const second = await ingestion.ingest(batch, SOURCE);
    expect(second.fetched).toBe(12);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(12);
  });

  it('skips items missing sourceUrl without failing the batch', async () => {
    const result = await ingestion.ingest(
      [{ ...makeItem(99), sourceUrl: '' }, makeItem(100)],
      SOURCE,
    );
    expect(result.fetched).toBe(2);
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('normalizes the sourceUrl before storing (utm stripped)', async () => {
    await ingestion.ingest([makeItem(101)], SOURCE);
    const row = await prisma.hotNews.findFirst({
      where: { sourceUrl: 'https://lab.example.com/post/101' },
    });
    expect(row).not.toBeNull();
    expect(row!.dedupeHash).toMatch(/^[0-9a-f]{32}$/);
  });
});
