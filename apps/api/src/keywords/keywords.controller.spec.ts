import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { KeywordsController } from './keywords.controller';
import { KeywordsService } from './keywords.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

describe('KeywordsController', () => {
  let controller: KeywordsController;
  let serviceMock: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    hits: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    serviceMock = {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      hits: vi.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KeywordsController],
      providers: [{ provide: KeywordsService, useValue: serviceMock }],
    })
      // Override the JwtAuthGuard so controller-spec doesn't need a real JWT;
      // we trust SP-13's auth.controller.spec / jwt-auth.guard.spec for the
      // auth behavior. Here we just verify the routing + delegation.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(KeywordsController);
  });

  it('GET /keywords delegates to service.list()', async () => {
    serviceMock.list.mockResolvedValue({ items: [], total: 0 });
    await expect(controller.list()).resolves.toEqual({ items: [], total: 0 });
    expect(serviceMock.list).toHaveBeenCalledTimes(1);
  });

  it('GET /keywords/:id delegates with id', async () => {
    const row = { id: 'kw_1', keyword: 'Claude' };
    serviceMock.get.mockResolvedValue(row);
    await expect(controller.get('kw_1')).resolves.toBe(row);
    expect(serviceMock.get).toHaveBeenCalledWith('kw_1');
  });

  it('POST /keywords delegates with body', async () => {
    const row = { id: 'kw_new', keyword: 'GPT-5' };
    serviceMock.create.mockResolvedValue(row);
    await expect(controller.create({ keyword: 'GPT-5' })).resolves.toBe(row);
    expect(serviceMock.create).toHaveBeenCalledWith({ keyword: 'GPT-5' });
  });

  it('PATCH /keywords/:id delegates with id + body', async () => {
    const row = { id: 'kw_1', enabled: false };
    serviceMock.update.mockResolvedValue(row);
    await expect(controller.update('kw_1', { enabled: false })).resolves.toBe(row);
    expect(serviceMock.update).toHaveBeenCalledWith('kw_1', { enabled: false });
  });

  it('DELETE /keywords/:id delegates and returns { deleted: true }', async () => {
    serviceMock.remove.mockResolvedValue({ deleted: true });
    await expect(controller.remove('kw_1')).resolves.toEqual({ deleted: true });
    expect(serviceMock.remove).toHaveBeenCalledWith('kw_1');
  });

  describe('GET /keywords/:id/hits (SP-15 PR-B)', () => {
    it('defaults to limit=20 offset=0 when query params missing', async () => {
      serviceMock.hits.mockResolvedValue({ items: [], total: 0 });
      await controller.hits('kw_1', undefined, undefined);
      expect(serviceMock.hits).toHaveBeenCalledWith('kw_1', 20, 0);
    });

    it('honors explicit limit + offset', async () => {
      serviceMock.hits.mockResolvedValue({ items: [], total: 0 });
      await controller.hits('kw_1', '50', '100');
      expect(serviceMock.hits).toHaveBeenCalledWith('kw_1', 50, 100);
    });

    it('clamps limit to 100 (server-side guard)', async () => {
      serviceMock.hits.mockResolvedValue({ items: [], total: 0 });
      await controller.hits('kw_1', '5000', '0');
      expect(serviceMock.hits).toHaveBeenCalledWith('kw_1', 100, 0);
    });

    it('400 on non-numeric limit', async () => {
      await expect(
        controller.hits('kw_1', 'abc', '0'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400 on negative offset', async () => {
      await expect(
        controller.hits('kw_1', '20', '-5'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
