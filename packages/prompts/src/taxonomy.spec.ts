import { describe, it, expect } from 'vitest';
import { TAXONOMY } from './taxonomy';

describe('TAXONOMY', () => {
  it('companies array is non-empty and unique', () => {
    expect(TAXONOMY.companies.length).toBeGreaterThan(0);
    const set = new Set(TAXONOMY.companies);
    expect(set.size).toBe(TAXONOMY.companies.length);
  });

  it('models array is non-empty and unique', () => {
    expect(TAXONOMY.models.length).toBeGreaterThan(0);
    const set = new Set(TAXONOMY.models);
    expect(set.size).toBe(TAXONOMY.models.length);
  });

  it('categories has exactly 8 entries (Release / Research / Tutorial / Opinion / Tooling / Benchmark / Incident / Product)', () => {
    expect(TAXONOMY.categories.length).toBe(8);
    expect([...TAXONOMY.categories].sort()).toEqual(
      [
        'Benchmark',
        'Incident',
        'Opinion',
        'Product',
        'Release',
        'Research',
        'Tooling',
        'Tutorial',
      ].sort(),
    );
  });

  it('contains key reference companies (OpenAI, Anthropic, Google, DeepSeek)', () => {
    expect(TAXONOMY.companies).toContain('OpenAI');
    expect(TAXONOMY.companies).toContain('Anthropic');
    expect(TAXONOMY.companies).toContain('Google');
    expect(TAXONOMY.companies).toContain('DeepSeek');
  });
});
