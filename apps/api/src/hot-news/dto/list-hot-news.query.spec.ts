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
});
