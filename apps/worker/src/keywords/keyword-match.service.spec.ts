import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPrisma = {
  hotNews: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  keywordMonitor: {
    findMany: vi.fn(),
  },
  keywordHit: {
    create: vi.fn(),
  },
};

vi.mock('@ai-hot-news/db', async () => {
  const actual = await vi.importActual<typeof import('@ai-hot-news/db')>(
    '@ai-hot-news/db',
  );
  return {
    ...actual,
    getPrisma: () => mockPrisma,
  };
});

import { KeywordMatchService } from './keyword-match.service';

describe('KeywordMatchService.runForHotNews', () => {
  let service: KeywordMatchService;

  const baseRow = {
    id: 'h1',
    title: 'OpenAI releases Claude killer',
    titleZh: 'OpenAI 发布新模型挑战 Claude',
    summary: '面向开发者的新 API，定价更低，文档质量提升。',
    sourcePlatform: 'HACKERNEWS' as const,
    matchedKeywords: [],
  };

  beforeEach(() => {
    mockPrisma.hotNews.findUnique.mockReset();
    mockPrisma.hotNews.update.mockReset();
    mockPrisma.keywordMonitor.findMany.mockReset().mockResolvedValue([]);
    mockPrisma.keywordHit.create.mockReset().mockResolvedValue({});
    service = new KeywordMatchService();
  });

  it('returns notFound when HotNews row is missing', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(null);
    const result = await service.runForHotNews('ghost');
    expect(result).toEqual({ scanned: 0, hits: 0, skipped: 0, notFound: true });
    expect(mockPrisma.keywordMonitor.findMany).not.toHaveBeenCalled();
  });

  it('returns zeroes when no enabled keywords', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(baseRow);
    mockPrisma.keywordMonitor.findMany.mockResolvedValue([]);
    const result = await service.runForHotNews('h1');
    expect(result).toEqual({ scanned: 0, hits: 0, skipped: 0, notFound: false });
    expect(mockPrisma.keywordHit.create).not.toHaveBeenCalled();
  });

  it('matches keyword case-insensitively + writes hit + reflects into matchedKeywords', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(baseRow);
    mockPrisma.keywordMonitor.findMany.mockResolvedValue([
      {
        id: 'kw1',
        keyword: 'Claude',
        synonyms: [],
        excludeWords: [],
        platforms: [],
      },
    ]);
    const result = await service.runForHotNews('h1');
    expect(result.hits).toBe(1);
    expect(mockPrisma.keywordHit.create).toHaveBeenCalledWith({
      data: { hotNewsId: 'h1', keywordId: 'kw1' },
    });
    expect(mockPrisma.hotNews.update).toHaveBeenCalledWith({
      where: { id: 'h1' },
      data: { matchedKeywords: ['Claude'] },
    });
  });

  it('matches CJK substring (中文命中)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({
      ...baseRow,
      titleZh: 'AI 智能体应用爆发',
    });
    mockPrisma.keywordMonitor.findMany.mockResolvedValue([
      { id: 'kw1', keyword: '智能体', synonyms: [], excludeWords: [], platforms: [] },
    ]);
    const result = await service.runForHotNews('h1');
    expect(result.hits).toBe(1);
  });

  it('matches via synonym when keyword itself does not appear', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({
      ...baseRow,
      title: 'Anthropic Code is great',
      titleZh: null,
      summary: null,
    });
    mockPrisma.keywordMonitor.findMany.mockResolvedValue([
      {
        id: 'kw1',
        keyword: 'Claude Code',
        synonyms: ['Anthropic Code', 'claude-code'],
        excludeWords: [],
        platforms: [],
      },
    ]);
    const result = await service.runForHotNews('h1');
    expect(result.hits).toBe(1);
  });

  it('skips when ALL platform filter mismatches', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(baseRow);
    mockPrisma.keywordMonitor.findMany.mockResolvedValue([
      {
        id: 'kw1',
        keyword: 'Claude',
        synonyms: [],
        excludeWords: [],
        platforms: ['REDDIT'],
      },
    ]);
    const result = await service.runForHotNews('h1');
    expect(result.hits).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockPrisma.keywordHit.create).not.toHaveBeenCalled();
  });

  it('drops hit when an excludeWord is present (post-filter)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({
      ...baseRow,
      summary: 'Apple unveils new fruit collection at WWDC',
      titleZh: '苹果公司新品',
    });
    mockPrisma.keywordMonitor.findMany.mockResolvedValue([
      {
        id: 'kw1',
        keyword: 'Apple',
        synonyms: [],
        excludeWords: ['fruit'],
        platforms: [],
      },
    ]);
    const result = await service.runForHotNews('h1');
    expect(result.hits).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('silently skips on P2002 unique-constraint (idempotent re-run)', async () => {
    const { Prisma } = await import('@ai-hot-news/db');
    mockPrisma.hotNews.findUnique.mockResolvedValue(baseRow);
    mockPrisma.keywordMonitor.findMany.mockResolvedValue([
      { id: 'kw1', keyword: 'Claude', synonyms: [], excludeWords: [], platforms: [] },
    ]);
    mockPrisma.keywordHit.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    const result = await service.runForHotNews('h1');
    expect(result.hits).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('does NOT re-write matchedKeywords when nothing changed', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({
      ...baseRow,
      matchedKeywords: ['Claude'], // already recorded
    });
    mockPrisma.keywordMonitor.findMany.mockResolvedValue([
      { id: 'kw1', keyword: 'Claude', synonyms: [], excludeWords: [], platforms: [] },
    ]);
    const result = await service.runForHotNews('h1');
    expect(result.hits).toBeGreaterThanOrEqual(0);
    expect(mockPrisma.hotNews.update).not.toHaveBeenCalled();
  });

  it('aggregates multiple keyword hits into matchedKeywords union', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({
      ...baseRow,
      title: 'OpenAI Claude DeepSeek roundup',
    });
    mockPrisma.keywordMonitor.findMany.mockResolvedValue([
      { id: 'kw1', keyword: 'OpenAI', synonyms: [], excludeWords: [], platforms: [] },
      { id: 'kw2', keyword: 'Claude', synonyms: [], excludeWords: [], platforms: [] },
      { id: 'kw3', keyword: 'Nothing', synonyms: [], excludeWords: [], platforms: [] },
    ]);
    const result = await service.runForHotNews('h1');
    expect(result.hits).toBe(2);
    expect(result.skipped).toBe(1);
    const updateArg = mockPrisma.hotNews.update.mock.calls[0]![0]!;
    expect(updateArg.data.matchedKeywords.sort()).toEqual(['Claude', 'OpenAI']);
  });
});
