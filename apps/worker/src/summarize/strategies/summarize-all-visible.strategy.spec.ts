import { describe, it, expect } from 'vitest';
import { SummarizeAllVisibleStrategy } from './summarize-all-visible.strategy';
import type { StrategyRowInput } from './strategy.interface';

const baseRow: StrategyRowInput = {
  id: 'r1',
  sourcePlatform: 'HACKERNEWS',
  publishedAt: new Date('2026-05-05T00:00:00Z'),
  status: 'VISIBLE',
  interactionData: null,
  heatScore: 100,
};

describe('SummarizeAllVisibleStrategy', () => {
  const strategy = new SummarizeAllVisibleStrategy();

  it('allows VISIBLE rows', () => {
    expect(strategy.shouldSummarize({ ...baseRow, status: 'VISIBLE' })).toBe('allow');
  });

  it('skips HIDDEN rows with skip:status_HIDDEN reason', () => {
    expect(strategy.shouldSummarize({ ...baseRow, status: 'HIDDEN' })).toBe('skip:status_HIDDEN');
  });

  it('skips PENDING rows with skip:status_PENDING reason', () => {
    expect(strategy.shouldSummarize({ ...baseRow, status: 'PENDING' })).toBe('skip:status_PENDING');
  });
});
