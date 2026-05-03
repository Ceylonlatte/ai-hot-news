import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HotNewsController } from './hot-news.controller';
import { HotNewsService } from './hot-news.service';

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
    const result = await controller.list({ page: 1, pageSize: 20 });
    expect(serviceMock.list).toHaveBeenCalledWith(1, 20);
    expect(result.total).toBe(1);
    expect(result.items[0]!.sourcePlatform).toBe('RSS');
  });

  it('passes custom pagination through to the service', async () => {
    await controller.list({ page: 3, pageSize: 5 });
    expect(serviceMock.list).toHaveBeenCalledWith(3, 5);
  });
});
