import { describe, it, expect } from 'vitest';
import { LLM_PRICING, computeCostUsd } from './pricing';

describe('LLM_PRICING table', () => {
  it('has entries for the production-default summarize + embed models', () => {
    expect(LLM_PRICING['deepseek/deepseek-v3.2']).toBeDefined();
    expect(LLM_PRICING['openai/text-embedding-3-small']).toBeDefined();
  });

  it('embedding entries have outputPerM = 0 (no output tokens)', () => {
    expect(LLM_PRICING['openai/text-embedding-3-small']!.outputPerM).toBe(0);
  });
});

describe('computeCostUsd', () => {
  it('returns null for an unpriced model', () => {
    expect(computeCostUsd('unknown/model-x', 1000, 500)).toBeNull();
  });

  it('charges only input cost for an embedding model (outputPerM=0)', () => {
    // 1M tokens * $0.02/M = $0.02
    expect(
      computeCostUsd('openai/text-embedding-3-small', 1_000_000, 0),
    ).toBeCloseTo(0.02, 6);
    // tokensOut ignored when outputPerM=0
    expect(
      computeCostUsd('openai/text-embedding-3-small', 1_000_000, 999_999),
    ).toBeCloseTo(0.02, 6);
  });

  it('charges input + output for chat models', () => {
    // deepseek-v3.2 = $0.27/M in + $1.10/M out
    // 100k in + 50k out = (0.1 * 0.27) + (0.05 * 1.10) = 0.027 + 0.055 = 0.082
    expect(
      computeCostUsd('deepseek/deepseek-v3.2', 100_000, 50_000),
    ).toBeCloseTo(0.082, 6);
  });

  it('rounds to 6 decimals (matches DECIMAL(10,6))', () => {
    // 1 token in = 0.27 / 1M = 0.00000027 → rounds to 0.000000 (under 6 decimal)
    const cost = computeCostUsd('deepseek/deepseek-v3.2', 1, 0);
    expect(cost).not.toBeNull();
    // Must be representable in 6 decimals
    expect(Number.isFinite(cost!)).toBe(true);
    // Confirm rounding is 6 decimals (no 1e-10 garbage)
    expect(cost!.toString()).toMatch(/^\d+(\.\d{0,6})?$/);
  });

  it('returns 0 (not null) for zero-token call on a priced model', () => {
    expect(computeCostUsd('deepseek/deepseek-v3.2', 0, 0)).toBe(0);
  });
});
