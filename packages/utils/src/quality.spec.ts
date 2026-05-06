import { describe, expect, it } from 'vitest';
import {
  FILTER_REASONS,
  checkRedditQuality,
  checkHnQuality,
  checkUniversalQuality,
} from './quality';

describe('FILTER_REASONS constants', () => {
  it('exposes the 4 known reason strings', () => {
    expect(FILTER_REASONS.REDDIT_LOW_RATIO).toBe('reddit_low_ratio');
    expect(FILTER_REASONS.REDDIT_LOW_ENGAGEMENT).toBe('reddit_low_engagement');
    expect(FILTER_REASONS.HN_LOW_ENGAGEMENT).toBe('hn_low_engagement');
    expect(FILTER_REASONS.TITLE_TOO_SHORT).toBe('title_too_short');
  });
});

describe('checkRedditQuality', () => {
  it('returns REDDIT_LOW_RATIO when upvote_ratio < 0.5', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.4, score: 100, num_comments: 50 }),
    ).toBe('reddit_low_ratio');
  });

  it('returns null when upvote_ratio is null (cold post < 3 votes)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: null, score: 100, num_comments: 50 }),
    ).toBeNull();
  });

  it('returns REDDIT_LOW_ENGAGEMENT when score<5 AND num_comments<2', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.95, score: 3, num_comments: 0 }),
    ).toBe('reddit_low_engagement');
  });

  it('returns null when score<5 BUT num_comments>=2 (high engagement saves it)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.95, score: 3, num_comments: 5 }),
    ).toBeNull();
  });

  it('returns null when score>=5 (above engagement threshold)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.95, score: 100, num_comments: 0 }),
    ).toBeNull();
  });

  it('checks ratio before engagement (low ratio + low engagement → ratio reason)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.3, score: 1, num_comments: 0 }),
    ).toBe('reddit_low_ratio');
  });

  it('returns null at the exact upvote_ratio = 0.5 boundary (strict less-than)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.5, score: 100, num_comments: 50 }),
    ).toBeNull();
  });

  it('returns null at the exact engagement boundaries (score=5 OR comments=2)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.95, score: 5, num_comments: 0 }),
    ).toBeNull();
    expect(
      checkRedditQuality({ upvote_ratio: 0.95, score: 4, num_comments: 2 }),
    ).toBeNull();
  });
});

describe('checkHnQuality', () => {
  it('returns HN_LOW_ENGAGEMENT when score<20 AND descendants<5', () => {
    expect(checkHnQuality({ score: 19, descendants: 4 })).toBe('hn_low_engagement');
  });

  it('returns null when score>=20', () => {
    expect(checkHnQuality({ score: 20, descendants: 0 })).toBeNull();
    expect(checkHnQuality({ score: 100, descendants: 0 })).toBeNull();
  });

  it('returns null when descendants>=5 (discussion saves it)', () => {
    expect(checkHnQuality({ score: 3, descendants: 5 })).toBeNull();
  });

  it('treats null score / descendants as 0 (returns HN_LOW_ENGAGEMENT)', () => {
    expect(checkHnQuality({ score: null, descendants: null })).toBe('hn_low_engagement');
  });

  it('returns null at the exact engagement boundaries (score=20 OR descendants=5)', () => {
    expect(checkHnQuality({ score: 20, descendants: 0 })).toBeNull();
    expect(checkHnQuality({ score: 19, descendants: 5 })).toBeNull();
  });
});

describe('checkUniversalQuality', () => {
  it('returns TITLE_TOO_SHORT when title is empty', () => {
    expect(checkUniversalQuality({ title: '' })).toBe('title_too_short');
  });

  it('returns TITLE_TOO_SHORT when trimmed title length < 5', () => {
    expect(checkUniversalQuality({ title: 'abc' })).toBe('title_too_short');
    expect(checkUniversalQuality({ title: '   ' })).toBe('title_too_short');
  });

  it('returns null when trimmed title length >= 5', () => {
    expect(checkUniversalQuality({ title: 'hello world' })).toBeNull();
    expect(checkUniversalQuality({ title: 'GPT-5' })).toBeNull();
  });

  it('returns null at the exact title length = 5 boundary (after trim)', () => {
    expect(checkUniversalQuality({ title: 'fives' })).toBeNull();
    expect(checkUniversalQuality({ title: '  fives  ' })).toBeNull();
  });
});
