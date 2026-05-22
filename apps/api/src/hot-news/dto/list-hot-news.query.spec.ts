import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, it, expect } from 'vitest';
import { ListHotNewsQuery } from './list-hot-news.query';

async function validateRaw(raw: Record<string, unknown>) {
  const dto = plainToInstance(ListHotNewsQuery, raw);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('ListHotNewsQuery', () => {
  it('accepts no platforms (default undefined)', async () => {
    const { dto, errors } = await validateRaw({});
    expect(errors).toEqual([]);
    expect(dto.platforms).toBeUndefined();
  });

  it('parses single platform from comma-string', async () => {
    const { dto, errors } = await validateRaw({ platforms: 'RSS' });
    expect(errors).toEqual([]);
    expect(dto.platforms).toEqual(['RSS']);
  });

  it('parses multiple platforms', async () => {
    const { dto, errors } = await validateRaw({ platforms: 'HACKERNEWS,REDDIT' });
    expect(errors).toEqual([]);
    expect(dto.platforms).toEqual(['HACKERNEWS', 'REDDIT']);
  });

  it('uppercases lowercase input', async () => {
    const { dto, errors } = await validateRaw({ platforms: 'rss' });
    expect(errors).toEqual([]);
    expect(dto.platforms).toEqual(['RSS']);
  });

  it('rejects unknown platform value', async () => {
    const { errors } = await validateRaw({ platforms: 'TIKTOK' });
    expect(errors.length).toBeGreaterThan(0);
  });

  describe('sort field (SP-6)', () => {
    it('defaults to undefined when sort is omitted', async () => {
      const { dto, errors } = await validateRaw({});
      expect(errors).toEqual([]);
      expect(dto.sort).toBeUndefined();
    });

    it('accepts "time" lowercased', async () => {
      const { dto, errors } = await validateRaw({ sort: 'time' });
      expect(errors).toEqual([]);
      expect(dto.sort).toBe('time');
    });

    it('accepts "heat" lowercased', async () => {
      const { dto, errors } = await validateRaw({ sort: 'heat' });
      expect(errors).toEqual([]);
      expect(dto.sort).toBe('heat');
    });

    it('lowercases " HEAT " (mixed case + whitespace)', async () => {
      const { dto, errors } = await validateRaw({ sort: ' HEAT ' });
      expect(errors).toEqual([]);
      expect(dto.sort).toBe('heat');
    });

    it('rejects "popularity" (not in allowlist)', async () => {
      const { errors } = await validateRaw({ sort: 'popularity' });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('range field (SP-10)', () => {
    it('defaults to undefined when omitted (service falls back to platform window)', async () => {
      const { dto, errors } = await validateRaw({});
      expect(errors).toEqual([]);
      expect(dto.range).toBeUndefined();
    });

    it('accepts "1d"', async () => {
      const { dto, errors } = await validateRaw({ range: '1d' });
      expect(errors).toEqual([]);
      expect(dto.range).toBe('1d');
    });

    it('accepts "7d"', async () => {
      const { dto, errors } = await validateRaw({ range: '7d' });
      expect(errors).toEqual([]);
      expect(dto.range).toBe('7d');
    });

    it('accepts "30d"', async () => {
      const { dto, errors } = await validateRaw({ range: '30d' });
      expect(errors).toEqual([]);
      expect(dto.range).toBe('30d');
    });

    it('lowercases " 7D " (mixed case + whitespace)', async () => {
      const { dto, errors } = await validateRaw({ range: ' 7D ' });
      expect(errors).toEqual([]);
      expect(dto.range).toBe('7d');
    });

    it('rejects "1h" (sub-day granularity intentionally not supported)', async () => {
      const { errors } = await validateRaw({ range: '1h' });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects "all" (use ?range=30d which equals TTL upper bound)', async () => {
      const { errors } = await validateRaw({ range: 'all' });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('tags field (SP-10)', () => {
    it('defaults to undefined when omitted', async () => {
      const { dto, errors } = await validateRaw({});
      expect(errors).toEqual([]);
      expect(dto.tags).toBeUndefined();
    });

    it('parses single tag', async () => {
      const { dto, errors } = await validateRaw({ tags: 'category:OpenSource' });
      expect(errors).toEqual([]);
      expect(dto.tags).toEqual(['category:OpenSource']);
    });

    it('parses multiple comma-separated tags (AND semantics applied in service)', async () => {
      const { dto, errors } = await validateRaw({
        tags: 'category:Opinion,company:OpenAI',
      });
      expect(errors).toEqual([]);
      expect(dto.tags).toEqual(['category:Opinion', 'company:OpenAI']);
    });

    it('trims surrounding whitespace per tag', async () => {
      const { dto, errors } = await validateRaw({ tags: ' category:Funding , company:Cursor ' });
      expect(errors).toEqual([]);
      expect(dto.tags).toEqual(['category:Funding', 'company:Cursor']);
    });

    it('filters out empty fragments (e.g. trailing comma)', async () => {
      const { dto, errors } = await validateRaw({ tags: 'category:Release,,' });
      expect(errors).toEqual([]);
      expect(dto.tags).toEqual(['category:Release']);
    });

    it('does NOT validate tag content (LLM taxonomy drift acceptable, service hasEvery returns 0)', async () => {
      // 故意传不存在 tag — DTO 层不打回，service 层 Prisma hasEvery 自然返 0 行
      const { dto, errors } = await validateRaw({ tags: 'category:Nonsense' });
      expect(errors).toEqual([]);
      expect(dto.tags).toEqual(['category:Nonsense']);
    });
  });

  describe('q field (SP-12 search)', () => {
    it('defaults to undefined when omitted', async () => {
      const { dto, errors } = await validateRaw({});
      expect(errors).toEqual([]);
      expect(dto.q).toBeUndefined();
    });

    it('accepts a basic ASCII query', async () => {
      const { dto, errors } = await validateRaw({ q: 'OpenAI' });
      expect(errors).toEqual([]);
      expect(dto.q).toBe('OpenAI');
    });

    it('accepts CJK query (pg_trgm splits 3-char windows)', async () => {
      const { dto, errors } = await validateRaw({ q: '智能体' });
      expect(errors).toEqual([]);
      expect(dto.q).toBe('智能体');
    });

    it('trims surrounding whitespace', async () => {
      const { dto, errors } = await validateRaw({ q: '  Claude Code  ' });
      expect(errors).toEqual([]);
      expect(dto.q).toBe('Claude Code');
    });

    it('rejects queries longer than 200 chars (防御性 — trigram 对超长无意义)', async () => {
      const { errors } = await validateRaw({ q: 'a'.repeat(201) });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts exactly 200 chars (boundary)', async () => {
      const { dto, errors } = await validateRaw({ q: 'a'.repeat(200) });
      expect(errors).toEqual([]);
      expect(dto.q!.length).toBe(200);
    });
  });

  describe('groupMode field (SP-7-D)', () => {
    it('defaults to undefined when omitted (controller maps to "fold")', async () => {
      const { dto, errors } = await validateRaw({});
      expect(errors).toEqual([]);
      expect(dto.groupMode).toBeUndefined();
    });

    it('accepts "fold"', async () => {
      const { dto, errors } = await validateRaw({ groupMode: 'fold' });
      expect(errors).toEqual([]);
      expect(dto.groupMode).toBe('fold');
    });

    it('accepts "expand"', async () => {
      const { dto, errors } = await validateRaw({ groupMode: 'expand' });
      expect(errors).toEqual([]);
      expect(dto.groupMode).toBe('expand');
    });

    it('lowercases " FOLD " (mixed case + whitespace)', async () => {
      const { dto, errors } = await validateRaw({ groupMode: ' FOLD ' });
      expect(errors).toEqual([]);
      expect(dto.groupMode).toBe('fold');
    });

    it('rejects "collapse" (not in allowlist)', async () => {
      const { errors } = await validateRaw({ groupMode: 'collapse' });
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
