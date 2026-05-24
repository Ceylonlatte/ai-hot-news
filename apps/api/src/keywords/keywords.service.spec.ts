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
      delete: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    keywordHit: {
      findMany: ReturnType<typeof vi.fn>;
    };
    $executeRaw: ReturnType<typeof vi.fn>;
    $transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prismaMock = {
      keywordMonitor: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      keywordHit: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $executeRaw: vi.fn().mockResolvedValue(0),
      // Default impl runs callback inline with the prismaMock as tx —
      // matches Prisma's $transaction(callback) interactive contract well
      // enough for unit tests that don't care about isolation levels.
      $transaction: vi.fn(async (cb: (tx: typeof prismaMock) => unknown) =>
        cb(prismaMock),
      ),
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
    // SP-15: Prisma include _count returns this shape; defaults to 0
    // so tests that don't care about hit count still pass.
    _count: { hits: 0 },
    // SP-16.5: new keyword starts unsearched; SP-16.5 cron will pick it
    // up on next tick. Tests that care about this set it explicitly.
    lastSearchedAt: null,
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

    it('SP-15: includes _count.hits AND maps to hitCount in DTO', async () => {
      prismaMock.keywordMonitor.findMany.mockResolvedValue([
        rowFactory({ id: 'a', _count: { hits: 42 } }),
        rowFactory({ id: 'b', _count: { hits: 0 } }),
      ]);
      const result = await service.list();
      const args = prismaMock.keywordMonitor.findMany.mock.calls[0]![0]!;
      expect(args.include).toEqual({ _count: { select: { hits: true } } });
      expect(result.items[0]!.hitCount).toBe(42);
      expect(result.items[1]!.hitCount).toBe(0);
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

    it('SP-15: returns hitCount via _count.hits include', async () => {
      prismaMock.keywordMonitor.findFirst.mockResolvedValue(
        rowFactory({ id: 'kw_99', _count: { hits: 17 } }),
      );
      const result = await service.get('kw_99');
      expect(result.hitCount).toBe(17);
      const args = prismaMock.keywordMonitor.findFirst.mock.calls[0]![0]!;
      expect(args.include).toEqual({ _count: { select: { hits: true } } });
    });

    it('SP-16.5: serializes lastSearchedAt to ISO string (null safe)', async () => {
      prismaMock.keywordMonitor.findFirst.mockResolvedValue(
        rowFactory({
          id: 'kw_99',
          lastSearchedAt: new Date('2026-05-23T14:30:00Z'),
        }),
      );
      const result = await service.get('kw_99');
      expect(result.lastSearchedAt).toBe('2026-05-23T14:30:00.000Z');

      prismaMock.keywordMonitor.findFirst.mockResolvedValue(
        rowFactory({ id: 'kw_100', lastSearchedAt: null }),
      );
      const result2 = await service.get('kw_100');
      expect(result2.lastSearchedAt).toBeNull();
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

    it('SP-15: update DTO carries fresh hitCount via _count.hits', async () => {
      prismaMock.keywordMonitor.findFirst.mockResolvedValue({ id: 'kw_1' });
      prismaMock.keywordMonitor.update.mockResolvedValue(
        rowFactory({ enabled: false, _count: { hits: 99 } }),
      );
      const result = await service.update('kw_1', { enabled: false });
      expect(result.hitCount).toBe(99);
      expect(result.enabled).toBe(false);
      const args = prismaMock.keywordMonitor.update.mock.calls[0]![0]!;
      expect(args.include).toEqual({ _count: { select: { hits: true } } });
    });
  });

  describe('hits (SP-15 PR-B)', () => {
    it('404 when monitor not found', async () => {
      prismaMock.keywordMonitor.findFirst.mockResolvedValue(null);
      await expect(service.hits('ghost', 20, 0)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prismaMock.keywordHit.findMany).not.toHaveBeenCalled();
    });

    it('returns monitor + items + total + pagination echo', async () => {
      prismaMock.keywordMonitor.findFirst.mockResolvedValue(
        rowFactory({ id: 'kw_1', keyword: 'Claude', _count: { hits: 7 } }),
      );
      prismaMock.keywordHit.findMany.mockResolvedValue([
        {
          hitAt: new Date('2026-05-23T15:00:00Z'),
          hotNews: {
            id: 'hn_1',
            title: 'Claude releases new SDK',
            titleZh: 'Claude 发布新 SDK',
            summary: '摘要',
            sourceUrl: 'https://example.com/x',
            sourcePlatform: 'HACKERNEWS',
            author: 'pg',
            publishedAt: new Date('2026-05-23T14:55:00Z'),
            crawledAt: new Date('2026-05-23T14:56:00Z'),
            aiTags: ['company:Anthropic'],
            matchedKeywords: ['Claude'],
            heatScore: 50,
            heatLevel: 'NORMAL',
            groupId: null,
          },
        },
      ]);
      const result = await service.hits('kw_1', 20, 0);
      expect(result.monitor.keyword).toBe('Claude');
      expect(result.monitor.hitCount).toBe(7);
      expect(result.total).toBe(7);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.title).toBe('Claude releases new SDK');
      expect(result.items[0]!.hitAt).toBe('2026-05-23T15:00:00.000Z');
      // Group-fields zero-stubbed for per-keyword view
      expect(result.items[0]!.groupSize).toBe(1);
      expect(result.items[0]!.groupMembers).toEqual([]);
    });

    it('orders by hitAt desc + filters to VISIBLE rows + paginates', async () => {
      prismaMock.keywordMonitor.findFirst.mockResolvedValue(
        rowFactory({ id: 'kw_1', _count: { hits: 50 } }),
      );
      await service.hits('kw_1', 10, 20);
      const args = prismaMock.keywordHit.findMany.mock.calls[0]![0]!;
      expect(args.where.keywordId).toBe('kw_1');
      expect(args.where.hotNews.status).toBe('VISIBLE');
      expect(args.orderBy).toEqual({ hitAt: 'desc' });
      expect(args.take).toBe(10);
      expect(args.skip).toBe(20);
    });

    it('returns empty items when no hits yet (new monitor)', async () => {
      prismaMock.keywordMonitor.findFirst.mockResolvedValue(
        rowFactory({ id: 'kw_1', _count: { hits: 0 } }),
      );
      prismaMock.keywordHit.findMany.mockResolvedValue([]);
      const result = await service.hits('kw_1', 20, 0);
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('remove', () => {
    it('404 when monitor not found (scoped by userId)', async () => {
      prismaMock.keywordMonitor.findFirst.mockResolvedValue(null);
      await expect(service.remove('ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // No mutation should fire when row missing
      expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
      expect(prismaMock.keywordMonitor.delete).not.toHaveBeenCalled();
    });

    it('returns { deleted: true, cleanedKeyword } on success', async () => {
      prismaMock.keywordMonitor.findFirst.mockResolvedValue({
        keyword: 'Claude',
      });
      prismaMock.$executeRaw.mockResolvedValue(343);
      prismaMock.keywordMonitor.delete.mockResolvedValue({});

      const result = await service.remove('kw_1');
      expect(result).toEqual({ deleted: true, cleanedKeyword: 'Claude' });

      // findFirst scoped to userId
      const findArgs = prismaMock.keywordMonitor.findFirst.mock.calls[0]![0]!;
      expect(findArgs.where).toEqual({ id: 'kw_1', userId: 'usr-admin' });

      // Delete then runs (cascade kicks in for KeywordHit)
      const delArgs = prismaMock.keywordMonitor.delete.mock.calls[0]![0]!;
      expect(delArgs.where).toEqual({ id: 'kw_1' });
    });

    it('SP-15 PR-B follow-up: cleans matchedKeywords[] arrays before delete', async () => {
      prismaMock.keywordMonitor.findFirst.mockResolvedValue({
        keyword: 'Claude',
      });
      prismaMock.$executeRaw.mockResolvedValue(42);
      prismaMock.keywordMonitor.delete.mockResolvedValue({});

      await service.remove('kw_1');

      // $executeRaw fires once with the keyword as a parameter
      expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
      const sqlCall = prismaMock.$executeRaw.mock.calls[0]!;
      // Prisma tagged template: first arg is TemplateStringsArray, then values
      const sqlText = (sqlCall[0] as TemplateStringsArray).join('');
      expect(sqlText).toMatch(/UPDATE\s+"hot_news"/i);
      expect(sqlText).toMatch(/array_remove\("matchedKeywords"/);
      // Bound values include the keyword string twice (SET + WHERE)
      expect(sqlCall[1]).toBe('Claude');
      expect(sqlCall[2]).toBe('Claude');
    });

    it('runs cleanup + delete inside a single $transaction (atomicity)', async () => {
      prismaMock.keywordMonitor.findFirst.mockResolvedValue({
        keyword: 'Claude',
      });
      prismaMock.$executeRaw.mockResolvedValue(0);
      prismaMock.keywordMonitor.delete.mockResolvedValue({});

      await service.remove('kw_1');

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      const cb = prismaMock.$transaction.mock.calls[0]![0]!;
      expect(typeof cb).toBe('function');
    });
  });
});
