import { describe, expect, it } from 'vitest';
import { Platform } from '@ai-hot-news/db';
import { CrawlerFactory } from './crawler.factory';
import { RssCrawler } from './crawlers/rss.crawler';
import { HackerNewsCrawler } from './crawlers/hackernews.crawler';

describe('CrawlerFactory', () => {
  const factory = new CrawlerFactory();

  it('returns an RssCrawler instance for RSS sources', () => {
    const crawler = factory.create({
      id: 'src1',
      platform: Platform.RSS,
      url: 'https://example.com/feed.xml',
      identifier: null,
    });
    expect(crawler).toBeInstanceOf(RssCrawler);
  });

  it('returns a HackerNewsCrawler instance for HACKERNEWS sources', () => {
    const crawler = factory.create({
      id: 'src1',
      platform: Platform.HACKERNEWS,
      url: null,
      identifier: 'top',
    });
    expect(crawler).toBeInstanceOf(HackerNewsCrawler);
  });

  it('throws for unsupported platforms', () => {
    expect(() =>
      factory.create({
        id: 'src1',
        platform: Platform.TWITTER,
        url: null,
        identifier: null,
      }),
    ).toThrow(/Unsupported crawler platform: TWITTER/);
  });
});
