import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateKeywordDto } from './create-keyword.dto';

async function v(raw: Record<string, unknown>) {
  const dto = plainToInstance(CreateKeywordDto, raw);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('CreateKeywordDto', () => {
  describe('keyword', () => {
    it('rejects when missing', async () => {
      const { errors } = await v({});
      expect(errors.length).toBeGreaterThan(0);
    });

    it('trims and keeps', async () => {
      const { dto, errors } = await v({ keyword: '  Claude Code  ' });
      expect(errors).toEqual([]);
      expect(dto.keyword).toBe('Claude Code');
    });

    it('rejects empty after trim', async () => {
      const { errors } = await v({ keyword: '   ' });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects > 100 chars', async () => {
      const { errors } = await v({ keyword: 'a'.repeat(101) });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('synonyms', () => {
    it('defaults to undefined (service applies [])', async () => {
      const { dto, errors } = await v({ keyword: 'k' });
      expect(errors).toEqual([]);
      expect(dto.synonyms).toBeUndefined();
    });

    it('accepts an array', async () => {
      const { dto, errors } = await v({
        keyword: 'Claude',
        synonyms: ['Anthropic Claude', 'Claude Code'],
      });
      expect(errors).toEqual([]);
      expect(dto.synonyms).toEqual(['Anthropic Claude', 'Claude Code']);
    });

    it('rejects > 10 entries', async () => {
      const { errors } = await v({
        keyword: 'k',
        synonyms: Array(11).fill('a'),
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects any synonym > 100 chars', async () => {
      const { errors } = await v({
        keyword: 'k',
        synonyms: ['x'.repeat(101)],
      });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('platforms', () => {
    it('rejects unknown platform value', async () => {
      const { errors } = await v({ keyword: 'k', platforms: ['TIKTOK'] });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts known platforms', async () => {
      const { dto, errors } = await v({
        keyword: 'k',
        platforms: ['HACKERNEWS', 'REDDIT'],
      });
      expect(errors).toEqual([]);
      expect(dto.platforms).toEqual(['HACKERNEWS', 'REDDIT']);
    });
  });

  describe('monitorFrequency', () => {
    it('accepts each allowed value', async () => {
      for (const f of ['M15', 'M30', 'H1', 'D1']) {
        const { errors } = await v({ keyword: 'k', monitorFrequency: f });
        expect(errors).toEqual([]);
      }
    });

    it('rejects unknown frequency', async () => {
      const { errors } = await v({ keyword: 'k', monitorFrequency: '5M' });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('triggerRules', () => {
    it('accepts empty object', async () => {
      const { dto, errors } = await v({ keyword: 'k', triggerRules: {} });
      expect(errors).toEqual([]);
      expect(dto.triggerRules).toEqual({});
    });

    it('accepts populated rules', async () => {
      const { dto, errors } = await v({
        keyword: 'k',
        triggerRules: { minCount: 5, minHeatScore: 70, growthRatePct: 200 },
      });
      expect(errors).toEqual([]);
      expect(dto.triggerRules!.minCount).toBe(5);
    });

    it('rejects negative minCount', async () => {
      const { errors } = await v({
        keyword: 'k',
        triggerRules: { minCount: -1 },
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects minHeatScore > 100', async () => {
      const { errors } = await v({
        keyword: 'k',
        triggerRules: { minHeatScore: 150 },
      });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('notifyChannels', () => {
    it('accepts known channels', async () => {
      const { errors } = await v({
        keyword: 'k',
        notifyChannels: ['site', 'email'],
      });
      expect(errors).toEqual([]);
    });

    it('rejects unknown channel', async () => {
      const { errors } = await v({
        keyword: 'k',
        notifyChannels: ['sms'],
      });
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
