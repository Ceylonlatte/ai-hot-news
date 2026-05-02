import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RssCrawler } from './rss.crawler';

const FIXTURE = readFileSync(join(__dirname, '../fixtures/sample-rss-feed.xml'), 'utf-8');

const fakeSource = {
  id: 'src-1',
  url: 'https://lab.example.com/feed.xml',
  name: 'Sample',
  platform: 'RSS' as const,
  enabled: true,
  crawlInterval: 1800,
} as const;

function patchParser(crawler: RssCrawler) {
  // bypass the real network: feed parseString with the fixture body
  // RssCrawler.fetch should call parser.parseURL; we monkey-patch that to parseString.
  // @ts-expect-error - reaching into the underlying parser for tests
  vi.spyOn(crawler['parser'], 'parseURL').mockImplementation(async () => {
    // @ts-expect-error - parseString is a public method on Parser
    return crawler['parser'].parseString(FIXTURE);
  });
}

describe('RssCrawler', () => {
  it('parses 3 items including author / no-author / no-pubDate cases', async () => {
    const crawler = new RssCrawler(fakeSource);
    patchParser(crawler);
    const items = await crawler.fetch();
    expect(items).toHaveLength(3);

    const [first, second, third] = items;
    expect(first.title).toBe('Hello world');
    expect(first.author).toBe('Alice');
    expect(first.publishedAt).toBeInstanceOf(Date);
    expect(first.rawHtml).toContain('<b>world</b>');
    expect(first.contentText).toContain('Hello');
    expect(first.contentText).not.toContain('<');

    expect(second.author).toBeNull();
    expect(second.rawHtml).toBeNull();
    expect(second.contentText).toContain('only description');

    expect(third.publishedAt).toBeNull();
  });

  it('throws when source has no url', async () => {
    const crawler = new RssCrawler({ ...fakeSource, url: null } as unknown as typeof fakeSource);
    await expect(crawler.fetch()).rejects.toThrow(/missing url/);
  });
});
