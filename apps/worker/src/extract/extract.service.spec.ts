import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { ExtractService } from './extract.service';
import {
  PermanentFetchError,
  TransientFetchError,
} from './providers/provider.interface';

const mockPrisma = {
  hotNews: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};
vi.mock('@ai-hot-news/db', () => ({
  getPrisma: () => mockPrisma,
}));

describe('ExtractService', () => {
  let chain: { extract: ReturnType<typeof vi.fn> };
  let summaryQueue: { add: ReturnType<typeof vi.fn> };
  let service: ExtractService;

  beforeEach(() => {
    chain = { extract: vi.fn() };
    summaryQueue = { add: vi.fn().mockResolvedValue(undefined) };
    service = new ExtractService(
      chain as unknown as import('./providers/chain').ExtractChain,
      summaryQueue as unknown as Queue,
    );
    mockPrisma.hotNews.findUnique.mockReset();
    mockPrisma.hotNews.update.mockReset();
  });

  afterEach(() => vi.resetAllMocks());

  const baseRow = {
    id: 'hn-1',
    title: 'A',
    content: 'A',
    extractStatus: 'PENDING',
    extractAttempts: 0,
    interactionData: { externalUrl: 'https://example.com/post' },
  };

  it('updates content + rawHtml + summary=null + aiTags=[] + extractStatus=EXTRACTED on success, then enqueues summary', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(baseRow);
    chain.extract.mockResolvedValue({
      result: { contentText: 'real article body', rawHtml: '<p>x</p>', title: 'A' },
      usedProvider: 'firecrawl',
    });

    await service.run('hn-1');

    expect(mockPrisma.hotNews.update).toHaveBeenCalledWith({
      where: { id: 'hn-1' },
      data: expect.objectContaining({
        content: 'real article body',
        rawHtml: '<p>x</p>',
        summary: null,
        aiTags: [],
        extractStatus: 'EXTRACTED',
        extractAttempts: 1,
      }),
    });
    expect(summaryQueue.add).toHaveBeenCalledWith(
      'summarize',
      { hotNewsId: 'hn-1' },
      expect.objectContaining({ jobId: 'summarize-hn-1' }),
    );
  });

  it('marks FAILED on PermanentFetchError without throwing (no BullMQ retry)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(baseRow);
    chain.extract.mockRejectedValue(new PermanentFetchError('404'));

    await expect(service.run('hn-1')).resolves.toBeUndefined();

    expect(mockPrisma.hotNews.update).toHaveBeenCalledWith({
      where: { id: 'hn-1' },
      data: { extractStatus: 'FAILED', extractAttempts: 1 },
    });
    expect(summaryQueue.add).not.toHaveBeenCalled();
  });

  it('throws to let BullMQ retry on first TransientFetchError (attempts < 3)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({ ...baseRow, extractAttempts: 0 });
    chain.extract.mockRejectedValue(new TransientFetchError('boom'));

    await expect(service.run('hn-1')).rejects.toBeInstanceOf(TransientFetchError);

    expect(mockPrisma.hotNews.update).toHaveBeenCalledWith({
      where: { id: 'hn-1' },
      data: { extractStatus: 'PENDING', extractAttempts: 1 },
    });
  });

  it('marks FAILED when TransientFetchError reaches attempts >= 3 (no rethrow)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({ ...baseRow, extractAttempts: 2 });
    chain.extract.mockRejectedValue(new TransientFetchError('still boom'));

    await expect(service.run('hn-1')).resolves.toBeUndefined();

    expect(mockPrisma.hotNews.update).toHaveBeenCalledWith({
      where: { id: 'hn-1' },
      data: { extractStatus: 'FAILED', extractAttempts: 3 },
    });
  });

  it('skips when row.extractStatus is already EXTRACTED', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({
      ...baseRow,
      extractStatus: 'EXTRACTED',
    });

    await service.run('hn-1');

    expect(chain.extract).not.toHaveBeenCalled();
    expect(mockPrisma.hotNews.update).not.toHaveBeenCalled();
  });

  it('skips when row.extractStatus is FAILED (terminal)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({ ...baseRow, extractStatus: 'FAILED' });
    await service.run('hn-1');
    expect(chain.extract).not.toHaveBeenCalled();
  });

  it('clears extractStatus when externalUrl is missing/invalid (sentinel broken)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({
      ...baseRow,
      interactionData: { externalUrl: 'mailto:nope' },
    });

    await service.run('hn-1');

    expect(chain.extract).not.toHaveBeenCalled();
    expect(mockPrisma.hotNews.update).toHaveBeenCalledWith({
      where: { id: 'hn-1' },
      data: { extractStatus: null },
    });
  });

  it('skips when row not found', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(null);
    await service.run('missing');
    expect(chain.extract).not.toHaveBeenCalled();
  });
});
