import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { Platform, getPrisma } from '@ai-hot-news/db';
import { CrawlScheduler } from './crawl.scheduler';

vi.mock('@ai-hot-news/db', async () => {
  const actual = await vi.importActual<typeof import('@ai-hot-news/db')>('@ai-hot-news/db');
  return { ...actual, getPrisma: vi.fn() };
});

vi.mock('bullmq', async () => {
  const actual = await vi.importActual<typeof import('bullmq')>('bullmq');
  return { ...actual, Queue: vi.fn() };
});

describe('CrawlScheduler', () => {
  let mainQueueAdd: ReturnType<typeof vi.fn>;
  let mainQueue: Queue;
  let oldQueueObliterate: ReturnType<typeof vi.fn>;
  let oldQueueClose: ReturnType<typeof vi.fn>;
  let connection: IORedis;
  let prismaFindMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mainQueueAdd = vi.fn().mockResolvedValue(undefined);
    mainQueue = { add: mainQueueAdd } as unknown as Queue;
    oldQueueObliterate = vi.fn().mockResolvedValue(undefined);
    oldQueueClose = vi.fn().mockResolvedValue(undefined);
    vi.mocked(Queue).mockImplementation((name: unknown) => {
      if (name === 'rss-crawl') {
        return {
          obliterate: oldQueueObliterate,
          close: oldQueueClose,
        } as unknown as Queue;
      }
      throw new Error(`Unexpected Queue construction with name=${String(name)}`);
    });
    connection = {} as IORedis;
    prismaFindMany = vi.fn();
    vi.mocked(getPrisma).mockReturnValue({
      sourceConfig: { findMany: prismaFindMany },
    } as unknown as ReturnType<typeof getPrisma>);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("obliterates the legacy 'rss-crawl' queue at startup", async () => {
    prismaFindMany.mockResolvedValue([]);
    const scheduler = new CrawlScheduler(mainQueue, connection);
    await scheduler.onModuleInit();
    expect(oldQueueObliterate).toHaveBeenCalledWith({ force: true });
    expect(oldQueueClose).toHaveBeenCalled();
  });

  it('survives obliterate failure (logs warning, still proceeds)', async () => {
    prismaFindMany.mockResolvedValue([]);
    oldQueueObliterate.mockRejectedValueOnce(new Error('boom'));
    const scheduler = new CrawlScheduler(mainQueue, connection);
    await expect(scheduler.onModuleInit()).resolves.toBeUndefined();
    expect(oldQueueClose).toHaveBeenCalled();
    expect(mainQueueAdd).not.toHaveBeenCalled();
  });

  it('queries enabled sources where platform IN (RSS, HACKERNEWS)', async () => {
    prismaFindMany.mockResolvedValue([]);
    const scheduler = new CrawlScheduler(mainQueue, connection);
    await scheduler.onModuleInit();
    expect(prismaFindMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        platform: { in: [Platform.RSS, Platform.HACKERNEWS] },
      },
    });
  });

  it('registers each source with crawl-repeat-* and crawl-boot-* job IDs', async () => {
    prismaFindMany.mockResolvedValue([
      { id: 'rss1', platform: Platform.RSS, crawlInterval: 1800 },
      { id: 'hn1', platform: Platform.HACKERNEWS, crawlInterval: 900 },
    ]);
    const scheduler = new CrawlScheduler(mainQueue, connection);
    await scheduler.onModuleInit();
    expect(mainQueueAdd).toHaveBeenCalledTimes(4);
    expect(mainQueueAdd).toHaveBeenNthCalledWith(
      1,
      'crawl',
      { sourceConfigId: 'rss1' },
      expect.objectContaining({
        jobId: 'crawl-repeat-rss1',
        repeat: { every: 1_800_000 },
      }),
    );
    expect(mainQueueAdd).toHaveBeenNthCalledWith(
      2,
      'crawl',
      { sourceConfigId: 'rss1' },
      expect.objectContaining({
        jobId: expect.stringMatching(/^crawl-boot-rss1-\d+$/),
      }),
    );
    expect(mainQueueAdd).toHaveBeenNthCalledWith(
      3,
      'crawl',
      { sourceConfigId: 'hn1' },
      expect.objectContaining({
        jobId: 'crawl-repeat-hn1',
        repeat: { every: 900_000 },
      }),
    );
    expect(mainQueueAdd).toHaveBeenNthCalledWith(
      4,
      'crawl',
      { sourceConfigId: 'hn1' },
      expect.objectContaining({
        jobId: expect.stringMatching(/^crawl-boot-hn1-\d+$/),
      }),
    );
  });
});
