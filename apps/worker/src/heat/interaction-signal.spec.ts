import { describe, expect, it } from 'vitest';
import { interactionSignal } from './interaction-signal';
import type { HeatConfig } from './heat.config';

const CFG: HeatConfig = {
  decayTauHours: 48,
  cronIntervalMin: 30,
  batchSize: 500,
  concurrency: 2,
  maxHn: 500,
  maxReddit: 5000,
  maxTwitter: 100000,
};

describe('interactionSignal', () => {
  describe('null / empty data', () => {
    it('returns 0 when data is null', () => {
      expect(interactionSignal('HACKERNEWS', null, CFG)).toBe(0);
    });

    it('returns 0 when HN data has no score / comments', () => {
      expect(interactionSignal('HACKERNEWS', {}, CFG)).toBe(0);
    });
  });

  describe('HACKERNEWS', () => {
    it('score=0, comments=0 → 0', () => {
      expect(interactionSignal('HACKERNEWS', { score: 0, comments: 0 }, CFG)).toBe(0);
    });

    it('score=100, comments=20 normalizes to ~80 (log10(141)/log10(501) * 100)', () => {
      const v = interactionSignal('HACKERNEWS', { score: 100, comments: 20 }, CFG);
      expect(v).toBeCloseTo(79.6, 0);
    });

    it('score=10000, comments=2000 exceeds 100 (above MAX_HN=500, no clamp in formula)', () => {
      const v = interactionSignal('HACKERNEWS', { score: 10000, comments: 2000 }, CFG);
      expect(v).toBeGreaterThan(100);
    });
  });

  describe('REDDIT', () => {
    it('null upvote_ratio falls back to 0.5 dampener', () => {
      const v = interactionSignal(
        'REDDIT',
        { score: 100, comments: 20, redditUpvoteRatio: null },
        CFG,
      );
      expect(v).toBeCloseTo(50.1, 0);
    });

    it('upvote_ratio=0.4 still treated as 0.5 (clamp)', () => {
      const v1 = interactionSignal(
        'REDDIT',
        { score: 100, comments: 20, redditUpvoteRatio: 0.4 },
        CFG,
      );
      const v2 = interactionSignal(
        'REDDIT',
        { score: 100, comments: 20, redditUpvoteRatio: 0.5 },
        CFG,
      );
      expect(v1).toBeCloseTo(v2, 1);
    });

    it('upvote_ratio=0.95 boosts (raw * 0.95)', () => {
      const v = interactionSignal(
        'REDDIT',
        { score: 100, comments: 20, redditUpvoteRatio: 0.95 },
        CFG,
      );
      expect(v).toBeCloseTo(57.7, 0);
    });
  });

  describe('TWITTER', () => {
    it('placeholder formula uses likes + retweets*3 + replies*2', () => {
      const v = interactionSignal(
        'TWITTER',
        { likes: 100, retweets: 20, replies: 10 },
        CFG,
      );
      expect(v).toBeCloseTo(45.2, 0);
    });
  });

  describe('RSS guard', () => {
    it('throws when called for RSS (caller must filter)', () => {
      expect(() => interactionSignal('RSS', { score: 100 }, CFG)).toThrow(
        /RSS rows must be filtered/,
      );
    });
  });
});
