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
});
