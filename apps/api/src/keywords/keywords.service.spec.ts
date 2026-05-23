import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { KeywordsService } from './keywords.service';
import * as dbModule from '@ai-hot-news/db';

describe('KeywordsService', () => {
  let service: KeywordsService;
  let prismaMock: {
    keywordMonitor: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prismaMock = {
      keywordMonitor: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    vi.spyOn(dbModule, 'getPrisma').mockReturnValue(
      prismaMock as unknown as ReturnType<typeof dbModule.getPrisma>,
    );
    service = new KeywordsService();
  });

  const rowFactory = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'kw_1',
    keyword: 'Claude',
    synonyms: [],
    excludeWords: [],
    platforms: [],
    monitorFrequency: 'H1',
    triggerRules: null,
    notifyChannels: ['site'],
    enabled: true,
    createdAt: new Date('2026-05-23T10:00:00Z'),
    updatedAt: new Date('2026-05-23T10:00:00Z'),
    ...overrides,
  });

  describe('list', () => {
    it('scopes to userId=usr-admin and orders by createdAt desc', async () => {
      prismaMock.keywordMonitor.findMany.mockResolvedValue([
        rowFactory({ id: 'a' }),
        rowFactory({ id: 'b' }),
      ]);
      const result = await service.list();
      expect(result.total).toBe(2);
      expect(result.items.map((i) => i.id)).toEqual(['a', 'b']);
      const args = prismaMock.keywordMonitor.findMany.mock.calls[0]![0]!;
      expect(args.where).toEqual({ userId: 'usr-admin' });
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('serializes createdAt + updatedAt to ISO strings', async () => {
      prismaMock.keywordMonitor.findMany.mockResolvedValue([rowFactory()]);
      const result = await service.list();
      expect(typeof result.items[0]!.createdAt).toBe('string');
      expect(result.items[0]!.createdAt).toBe('2026-05-23T10:00:00.000Z');
    });
  });

  describe('get', () => {
    it('404 when not found', async () => {
      prismaMock.keywordMonitor.findFirst.mockResolvedValue(null);
      await expect(service.get('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the row', async () => {
      prismaMock.keywordMonitor.findFirst.mockResolvedValue(rowFactory({ id: 'kw_99' }));
      const result = await service.get('kw_99');
      expect(result.id).toBe('kw_99');
      const args = prismaMock.keywordMonitor.findFirst.mock.calls[0]![0]!;
      expect(args.where).toEqual({ id: 'kw_99', userId: 'usr-admin' });
    });
  });

  describe('create', () => {
    it('applies defaults (enabled=true, frequency=H1, notifyChannels=[site])', async () => {
      prismaMock.keywordMonitor.create.mockResolvedValue(rowFactory());
      await service.create({ keyword: 'Claude' });
      const args = prismaMock.keywordMonitor.create.mock.calls[0]![0]!;
      expect(args.data.userId).toBe('usr-admin');
      expect(args.data.enabled).toBe(true);
      expect(args.data.monitorFrequency).toBe('H1');
      expect(args.data.notifyChannels).toEqual(['site']);
      expect(args.data.synonyms).toEqual([]);
    });

    it('normalizes synonyms: trim + drop empty + case-insensitive de-dup', async () => {
      prismaMock.keywordMonitor.create.mockResolvedValue(rowFactory());
      await service.create({
        keyword: 'Claude',
        synonyms: [' Claude Code ', 'claude code', '  ', 'Anthropic'],
      });
      const args = prismaMock.keywordMonitor.create.mock.calls[0]![0]!;
      expect(args.data.synonyms).toEqual(['Claude Code', 'Anthropic']);
    });

    it('normalizes empty triggerRules object to null', async () => {
      prismaMock.keywordMonitor.create.mockResolvedValue(rowFactory());
      await service.create({ keyword: 'k', triggerRules: {} });
      const args = prismaMock.keywordMonitor.create.mock.calls[0]![0]!;
      expect(args.data.triggerRules).toBeNull();
    });

    it('keeps populated triggerRules', async () => {
      prismaMock.keywordMonitor.create.mockResolvedValue(rowFactory());
      await service.create({
        keyword: 'k',
        triggerRules: { minCount: 5 },
      });
      const args = prismaMock.keywordMonitor.create.mock.calls[0]![0]!;
      expect(args.data.triggerRules).toEqual({ minCount: 5 });
    });

    it('throws ConflictException on Prisma P2002', async () => {
      const { Prisma } = await import('@ai-hot-news/db');
      prismaMock.keywordMonitor.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );
      await expect(service.create({ keyword: 'dup' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    it('404 when row not found (no update issued)', async () => {
      prismaMock.keywordMonitor.findFirst.mockResolvedValue(null);
      await expect(service.update('ghost', { enabled: false })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prismaMock.keywordMonitor.update).not.toHaveBeenCalled();
    });

    it('only sets fields that are present in DTO (sparse update)', async () => {
      prismaMock.keywordMonitor.findFirst.mockResolvedValue({ id: 'kw_1' });
      prismaMock.keywordMonitor.update.mockResolvedValue(rowFactory({ enabled: false }));

      await service.update('kw_1', { enabled: false });

      const args = prismaMock.keywordMonitor.update.mock.calls[0]![0]!;
      expect(args.data).toEqual({ enabled: false });
      // explicit assert: no other field accidentally overwritten
      expect(args.data.keyword).toBeUndefined();
      expect(args.data.synonyms).toBeUndefined();
    });

    it('normalizes synonyms on update too', async () => {
      prismaMock.keywordMonitor.findFirst.mockResolvedValue({ id: 'kw_1' });
      prismaMock.keywordMonitor.update.mockResolvedValue(rowFactory());
      await service.update('kw_1', { synonyms: ['  a  ', 'A', ''] });
      const args = prismaMock.keywordMonitor.update.mock.calls[0]![0]!;
      expect(args.data.synonyms).toEqual(['a']);
    });

    it('409 on rename to existing keyword (P2002)', async () => {
      const { Prisma } = await import('@ai-hot-news/db');
      prismaMock.keywordMonitor.findFirst.mockResolvedValue({ id: 'kw_1' });
      prismaMock.keywordMonitor.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );
      await expect(
        service.update('kw_1', { keyword: 'taken' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('remove', () => {
    it('404 when no row deleted (scoped by userId)', async () => {
      prismaMock.keywordMonitor.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.remove('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns { deleted: true } on success', async () => {
      prismaMock.keywordMonitor.deleteMany.mockResolvedValue({ count: 1 });
      const result = await service.remove('kw_1');
      expect(result).toEqual({ deleted: true });
      const args = prismaMock.keywordMonitor.deleteMany.mock.calls[0]![0]!;
      expect(args.where).toEqual({ id: 'kw_1', userId: 'usr-admin' });
    });
  });
});
