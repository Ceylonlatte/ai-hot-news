import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HotNewsController } from './hot-news.controller';
import { HotNewsService } from './hot-news.service';
import { ListHotNewsQuery } from './dto/list-hot-news.query';

describe('HotNewsController', () => {
  let controller: HotNewsController;
  let serviceMock: { list: ReturnType<typeof vi.fn> };

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
    expect(serviceMock.list).toHaveBeenCalledWith(1, 20, undefined, undefined);
    expect(result.total).toBe(1);
    expect(result.items[0]!.sourcePlatform).toBe('RSS');
  });

  it('passes custom pagination through to the service', async () => {
    const query = new ListHotNewsQuery();
    query.page = 3;
    query.pageSize = 5;
    await controller.list(query);
    expect(serviceMock.list).toHaveBeenCalledWith(3, 5, undefined, undefined);
  });

  it('passes query.platforms to service.list', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    const local = new HotNewsController({ list } as unknown as HotNewsService);
    const query = new ListHotNewsQuery();
    query.page = 1;
    query.pageSize = 20;
    query.platforms = ['RSS'];
    await local.list(query);
    expect(list).toHaveBeenCalledWith(1, 20, ['RSS'], undefined);
  });

  it('passes undefined platforms when query omits it', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    const local = new HotNewsController({ list } as unknown as HotNewsService);
    const query = new ListHotNewsQuery();
    await local.list(query);
    expect(list).toHaveBeenCalledWith(1, 20, undefined, undefined);
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
    expect(list).toHaveBeenCalledWith(1, 20, ['HACKERNEWS'], 'heat');
  });
});
