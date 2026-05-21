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

  it('categories has exactly 10 entries (8 SP-5 baseline + 2 SP-5.6 OpenSource + Funding)', () => {
    expect(TAXONOMY.categories.length).toBe(10);
    expect([...TAXONOMY.categories].sort()).toEqual(
      [
        'Benchmark',
        'Funding',
        'Incident',
        'OpenSource',
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

  it('contains OpenSource + Funding categories (SP-5.6, covers PRD §5.2 6 类完整映射)', () => {
    expect(TAXONOMY.categories).toContain('OpenSource');
    expect(TAXONOMY.categories).toContain('Funding');
  });
});
