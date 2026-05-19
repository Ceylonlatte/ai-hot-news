import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HotNewsController } from './hot-news.controller';
import { HotNewsService } from './hot-news.service';
import { ListHotNewsQuery } from './dto/list-hot-news.query';

describe('HotNewsController', () => {
  let controller: HotNewsController;
  let serviceMock: {
    list: ReturnType<typeof vi.fn>;
    detail: ReturnType<typeof vi.fn>;
    heatHistory: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    serviceMock = {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'a',
            title: 't',
            sourceUrl: 'https://example.com/a',
            sourcePlatform: 'RSS',
            author: null,
            publishedAt: '2026-05-01T00:00:00.000Z',
            crawledAt: '2026-05-01T00:00:00.000Z',
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      }),
      detail: vi.fn(),
      heatHistory: vi.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HotNewsController],
      providers: [{ provide: HotNewsService, useValue: serviceMock }],
    }).compile();
    controller = module.get<HotNewsController>(HotNewsController);
  });

  it('GET /hot-news passes default pagination to the service', async () => {
    const query = new ListHotNewsQuery();
    query.page = 1;
    query.pageSize = 20;
    const result = await controller.list(query);
    expect(serviceMock.list).toHaveBeenCalledWith(1, 20, undefined, undefined, 'fold');
    expect(result.total).toBe(1);
    expect(result.items[0]!.sourcePlatform).toBe('RSS');
  });

  it('passes custom pagination through to the service', async () => {
    const query = new ListHotNewsQuery();
    query.page = 3;
    query.pageSize = 5;
    await controller.list(query);
    expect(serviceMock.list).toHaveBeenCalledWith(3, 5, undefined, undefined, 'fold');
  });

  it('passes query.platforms to service.list', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    const local = new HotNewsController({ list } as unknown as HotNewsService);
    const query = new ListHotNewsQuery();
    query.page = 1;
    query.pageSize = 20;
    query.platforms = ['RSS'];
    await local.list(query);
    expect(list).toHaveBeenCalledWith(1, 20, ['RSS'], undefined, 'fold');
  });

  it('passes undefined platforms when query omits it', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    const local = new HotNewsController({ list } as unknown as HotNewsService);
    const query = new ListHotNewsQuery();
    await local.list(query);
    expect(list).toHaveBeenCalledWith(1, 20, undefined, undefined, 'fold');
  });

  it('passes query.sort through to service.list (SP-6)', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    const local = new HotNewsController({ list } as unknown as HotNewsService);
    const query = new ListHotNewsQuery();
    query.page = 1;
    query.pageSize = 20;
    query.platforms = ['HACKERNEWS'];
    query.sort = 'heat';
    await local.list(query);
    expect(list).toHaveBeenCalledWith(1, 20, ['HACKERNEWS'], 'heat', 'fold');
  });

  it('passes query.groupMode through to service.list (SP-7-D)', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    const local = new HotNewsController({ list } as unknown as HotNewsService);
    const query = new ListHotNewsQuery();
    query.page = 1;
    query.pageSize = 20;
    query.groupMode = 'expand';
    await local.list(query);
    expect(list).toHaveBeenCalledWith(1, 20, undefined, undefined, 'expand');
  });

  // ─── SP-11: GET /hot-news/:id ──────────────────────────────────────────
  describe('GET /hot-news/:id', () => {
    it('returns the row when the service finds it', async () => {
      serviceMock.detail.mockResolvedValueOnce({
        id: 'rep1',
        title: 'Title',
        relatedItems: [],
      });
      const result = await controller.detail('rep1');
      expect(serviceMock.detail).toHaveBeenCalledWith('rep1');
      expect(result.id).toBe('rep1');
    });

    it('throws NotFoundException when the service returns null', async () => {
      serviceMock.detail.mockResolvedValueOnce(null);
      await expect(controller.detail('ghost-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ─── SP-11: GET /hot-news/:id/heat-history ─────────────────────────────
  describe('GET /hot-news/:id/heat-history', () => {
    it('passes hours=48 by default', async () => {
      serviceMock.heatHistory.mockResolvedValueOnce({
        items: [],
        windowStart: '',
        windowEnd: '',
        hours: 48,
      });
      await controller.heatHistory('rep1', 48);
      expect(serviceMock.heatHistory).toHaveBeenCalledWith('rep1', 48);
    });

    it('passes hours=24 when caller requests it', async () => {
      serviceMock.heatHistory.mockResolvedValueOnce({
        items: [],
        windowStart: '',
        windowEnd: '',
        hours: 24,
      });
      await controller.heatHistory('rep1', 24);
      expect(serviceMock.heatHistory).toHaveBeenCalledWith('rep1', 24);
    });

    it('passes hours=72 when caller requests it', async () => {
      serviceMock.heatHistory.mockResolvedValueOnce({
        items: [],
        windowStart: '',
        windowEnd: '',
        hours: 72,
      });
      await controller.heatHistory('rep1', 72);
      expect(serviceMock.heatHistory).toHaveBeenCalledWith('rep1', 72);
    });

    it('clamps out-of-range hours back to 48', async () => {
      serviceMock.heatHistory.mockResolvedValueOnce({
        items: [],
        windowStart: '',
        windowEnd: '',
        hours: 48,
      });
      // Out-of-range numeric input: controller pipe falls back to 48.
      await controller.heatHistory('rep1', 100);
      expect(serviceMock.heatHistory).toHaveBeenCalledWith('rep1', 48);
    });
  });
});
