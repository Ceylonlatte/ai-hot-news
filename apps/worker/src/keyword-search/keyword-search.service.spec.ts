import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RawCrawledItem } from '@ai-hot-news/types';

const mockPrisma = {
  keywordMonitor: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
};
vi.mock('@ai-hot-news/db', async () => {
  const actual = await vi.importActual<typeof import('@ai-hot-news/db')>(
    '@ai-hot-news/db',
  );
  return { ...actual, getPrisma: () => mockPrisma };
});

const hnMock = vi.fn();
const redditMock = vi.fn();
vi.mock('./platforms/hn-algolia.searcher', () => ({
  searchHnAlgolia: (...args: unknown[]) => hnMock(...args),
}));
vi.mock('./platforms/reddit-search.searcher', () => ({
  searchReddit: (...args: unknown[]) => redditMock(...args),
}));

import {
  KeywordSearchService,
  resolvePlatforms,
  filterExcludeWords,
} from './keyword-search.service';
import type { IngestionService } from '../crawl/ingestion.service';

function makeIngestionMock() {
  return {
    ingest: vi.fn().mockResolvedValue({
      fetched: 0,
      inserted: 0,
      upserted: 0,
      skipped: 0,
      skippedQuality: 0,
      skippedNonAi: 0,
      skippedDedupe: 0,
      hidden: 0,
      failed: 0,
    }),
  } as unknown as IngestionService;
}

function rawItem(title: string, contentText = ''): RawCrawledItem {
  return {
    title,
    contentText,
    rawHtml: null,
    sourceUrl: `https://example.com/${encodeURIComponent(title)}`,
    author: null,
    publishedAt: new Date(),
    interactionData: null,
    trustedSource: true,
  };
}

describe('resolvePlatforms', () => {
  it('empty list defaults to HN + Reddit', () => {
    expect(resolvePlatforms([])).toEqual(['HACKERNEWS', 'REDDIT']);
  });
  it('only HACKERNEWS', () => {
    expect(resolvePlatforms(['HACKERNEWS'])).toEqual(['HACKERNEWS']);
  });
  it('only REDDIT', () => {
    expect(resolvePlatforms(['REDDIT'])).toEqual(['REDDIT']);
  });
  it('TWITTER alone yields empty (SP-22 not implemented)', () => {
    expect(resolvePlatforms(['TWITTER'])).toEqual([]);
  });
  it('RSS dropped (no search API)', () => {
    expect(resolvePlatforms(['RSS', 'HACKERNEWS'])).toEqual(['HACKERNEWS']);
  });
  it('preserves declared order: HACKERNEWS first if listed', () => {
    expect(resolvePlatforms(['HACKERNEWS', 'REDDIT'])).toEqual([
      'HACKERNEWS',
      'REDDIT',
    ]);
  });
});

describe('filterExcludeWords', () => {
  it('returns input untouched when excludeWords empty', () => {
    const input = [rawItem('Claude Code')];
    expect(filterExcludeWords(input, [])).toBe(input);
  });
  it('drops items whose title contains an exclude word (case-insensitive)', () => {
    const items = [
      rawItem('Apple unveils new fruit collection'),
      rawItem('Apple silicon performance'),
    ];
    const out = filterExcludeWords(items, ['fruit']);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('Apple silicon performance');
  });
  it('searches contentText too', () => {
    const items = [
      rawItem('AI news', 'A discussion about politics and elections'),
      rawItem('AI news 2', 'Pure tech content'),
    ];
    const out = filterExcludeWords(items, ['politics']);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('AI news 2');
  });
});

describe('KeywordSearchService.runForKeyword', () => {
  let service: KeywordSearchService;
  let ingestion: IngestionService;

  beforeEach(() => {
    mockPrisma.keywordMonitor.findUnique.mockReset();
    mockPrisma.keywordMonitor.update.mockReset().mockResolvedValue({});
    hnMock.mockReset().mockResolvedValue([]);
    redditMock.mockReset().mockResolvedValue([]);
    ingestion = makeIngestionMock();
    service = new KeywordSearchService(ingestion);
  });

  it('returns notFound when monitor row missing', async () => {
    mockPrisma.keywordMonitor.findUnique.mockResolvedValue(null);
    const result = await service.runForKeyword('ghost');
    expect(result.notFound).toBe(true);
    expect(hnMock).not.toHaveBeenCalled();
    expect(mockPrisma.keywordMonitor.update).not.toHaveBeenCalled();
  });

  it('returns disabled flag when enabled=false (race after cron enqueue)', async () => {
    mockPrisma.keywordMonitor.findUnique.mockResolvedValue({
      id: 'k1',
      keyword: 'X',
      excludeWords: [],
      platforms: [],
      enabled: false,
    });
    const result = await service.runForKeyword('k1');
    expect(result.disabled).toBe(true);
    expect(hnMock).not.toHaveBeenCalled();
  });

  it('searches HN + Reddit by default (empty platforms) and feeds ingest', async () => {
    mockPrisma.keywordMonitor.findUnique.mockResolvedValue({
      id: 'k1',
      keyword: 'Claude Code',
      excludeWords: [],
      platforms: [],
      enabled: true,
    });
    hnMock.mockResolvedValue([rawItem('hn-1'), rawItem('hn-2')]);
    redditMock.mockResolvedValue([rawItem('reddit-1')]);

    const result = await service.runForKeyword('k1');

    expect(hnMock).toHaveBeenCalledTimes(1);
    expect(redditMock).toHaveBeenCalledTimes(1);
    expect(ingestion.ingest).toHaveBeenCalledTimes(2);
    expect(result.fetched).toBe(3);
  });

  it('skips disabled platforms (only HACKERNEWS)', async () => {
    mockPrisma.keywordMonitor.findUnique.mockResolvedValue({
      id: 'k1',
      keyword: 'X',
      excludeWords: [],
      platforms: ['HACKERNEWS'],
      enabled: true,
    });
    hnMock.mockResolvedValue([rawItem('hn-1')]);

    await service.runForKeyword('k1');
    expect(hnMock).toHaveBeenCalledTimes(1);
    expect(redditMock).not.toHaveBeenCalled();
  });

  it('applies excludeWords BEFORE ingest (skipExcluded counter advances)', async () => {
    mockPrisma.keywordMonitor.findUnique.mockResolvedValue({
      id: 'k1',
      keyword: 'Apple',
      excludeWords: ['fruit'],
      platforms: ['HACKERNEWS'],
      enabled: true,
    });
    hnMock.mockResolvedValue([
      rawItem('Apple silicon roadmap'),
      rawItem('Apple fruit harvest in Washington'),
    ]);

    const result = await service.runForKeyword('k1');
    expect(result.fetched).toBe(2);
    expect(result.skippedExcluded).toBe(1);
    const ingestArg = (ingestion.ingest as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0]! as RawCrawledItem[];
    expect(ingestArg).toHaveLength(1);
    expect(ingestArg[0]!.title).toBe('Apple silicon roadmap');
  });

  it('always updates lastSearchedAt even if all platforms throw', async () => {
    mockPrisma.keywordMonitor.findUnique.mockResolvedValue({
      id: 'k1',
      keyword: 'X',
      excludeWords: [],
      platforms: [],
      enabled: true,
    });
    hnMock.mockRejectedValue(new Error('hn down'));
    redditMock.mockRejectedValue(new Error('reddit down'));

    const result = await service.runForKeyword('k1');
    expect(result.fetched).toBe(0);
    expect(mockPrisma.keywordMonitor.update).toHaveBeenCalledWith({
      where: { id: 'k1' },
      data: { lastSearchedAt: expect.any(Date) },
    });
  });

  it('one platform failing does not block the other', async () => {
    mockPrisma.keywordMonitor.findUnique.mockResolvedValue({
      id: 'k1',
      keyword: 'X',
      excludeWords: [],
      platforms: [],
      enabled: true,
    });
    hnMock.mockRejectedValue(new Error('hn down'));
    redditMock.mockResolvedValue([rawItem('reddit-survivor')]);

    const result = await service.runForKeyword('k1');
    expect(result.fetched).toBe(1);
    expect(ingestion.ingest).toHaveBeenCalledTimes(1);
  });
});
