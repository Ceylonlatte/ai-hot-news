import { describe, expect, it } from 'vitest';
import {
  FILTER_REASONS,
  checkRedditQuality,
  checkHnQuality,
  checkUniversalQuality,
  checkRedditDomainSignal,
} from './quality';

describe('FILTER_REASONS constants', () => {
  it('exposes the 6 known reason strings (SP-5.5 added LOW_SIGNAL_LINK + TINY_SELFPOST)', () => {
    expect(FILTER_REASONS.REDDIT_LOW_RATIO).toBe('reddit_low_ratio');
    expect(FILTER_REASONS.REDDIT_LOW_ENGAGEMENT).toBe('reddit_low_engagement');
    expect(FILTER_REASONS.HN_LOW_ENGAGEMENT).toBe('hn_low_engagement');
    expect(FILTER_REASONS.TITLE_TOO_SHORT).toBe('title_too_short');
    expect(FILTER_REASONS.REDDIT_LOW_SIGNAL_LINK).toBe('reddit_low_signal_link');
    expect(FILTER_REASONS.REDDIT_TINY_SELFPOST).toBe('reddit_tiny_selfpost');
  });
});

// SP-5.5 (2026-05-09): SP-5 v3.3 raised Reddit thresholds to fight memes,
// but empirical analysis (688 hot posts across 7 AI subs) showed engagement
// is *anti*-correlated with content value on Reddit — memes routinely score
// 5000+ while a paper announcement may score 50. Quality is now governed by
// `checkRedditDomainSignal` (HIGH bypass / LOW reject) so engagement is
// rolled back to SP-3 baseline (5/2/0.5) as a noise-floor only.
describe('checkRedditQuality (SP-5.5 reverted to SP-3 baseline)', () => {
  it('returns REDDIT_LOW_RATIO when upvote_ratio < 0.5', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.4, score: 100, num_comments: 50 }),
    ).toBe('reddit_low_ratio');
  });

  it('returns null at the exact upvote_ratio = 0.5 boundary (strict less-than)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.5, score: 100, num_comments: 50 }),
    ).toBeNull();
  });

  it('returns null when upvote_ratio = 0.6 (was rejected pre-SP-5.5)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.6, score: 100, num_comments: 50 }),
    ).toBeNull();
  });

  it('returns null when upvote_ratio is null (cold post < 3 votes)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: null, score: 100, num_comments: 50 }),
    ).toBeNull();
  });

  it('returns REDDIT_LOW_ENGAGEMENT when score<5 AND num_comments<2', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.95, score: 4, num_comments: 1 }),
    ).toBe('reddit_low_engagement');
  });

  it('returns null when score<5 BUT num_comments>=2 (discussion saves it)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.95, score: 1, num_comments: 2 }),
    ).toBeNull();
  });

  it('returns null when score>=5 (above engagement threshold)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.95, score: 5, num_comments: 0 }),
    ).toBeNull();
  });

  it('returns null when score=10 (was the SP-5 v3.3 boundary, now well above)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.95, score: 10, num_comments: 0 }),
    ).toBeNull();
  });

  it('checks ratio before engagement (low ratio + low engagement → ratio reason)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.3, score: 1, num_comments: 0 }),
    ).toBe('reddit_low_ratio');
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

  describe('SP-5 v3.5 top-N pass-through', () => {
    it('passes through when position<=20 even with low engagement (score=8, comments=0)', () => {
      expect(checkHnQuality({ score: 8, descendants: 0, position: 5 })).toBeNull();
    });

    it('passes through at the exact boundary position=20', () => {
      expect(checkHnQuality({ score: 1, descendants: 0, position: 20 })).toBeNull();
    });

    it('falls back to engagement check when position>20', () => {
      expect(checkHnQuality({ score: 8, descendants: 0, position: 21 })).toBe(
        'hn_low_engagement',
      );
    });

    it('falls back to engagement check when position is undefined (legacy callers)', () => {
      expect(checkHnQuality({ score: 8, descendants: 0 })).toBe('hn_low_engagement');
    });

    it('falls back to engagement check when position is null', () => {
      expect(checkHnQuality({ score: 8, descendants: 0, position: null })).toBe(
        'hn_low_engagement',
      );
    });

    it('still drops when position invalid (<1) and engagement low', () => {
      expect(checkHnQuality({ score: 5, descendants: 0, position: 0 })).toBe(
        'hn_low_engagement',
      );
    });

    it('top-N pass-through respects engagement above threshold (no double-drop)', () => {
      expect(checkHnQuality({ score: 100, descendants: 50, position: 5 })).toBeNull();
      expect(checkHnQuality({ score: 100, descendants: 50, position: 50 })).toBeNull();
    });
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

// SP-5.5 (2026-05-09): Empirical analysis of 688 hot Reddit posts across 7
// AI-native subs found that *out-bound link domain* is a far stronger
// content-value signal than engagement or keyword match. 34% of hot
// posts link to i.redd.it / v.redd.it / imgur (memes); 3.5% link to
// arxiv / huggingface / github / lab-blogs / major press (every one
// high-signal). This function returns 'high' for trusted publishing
// domains, 'low' for known meme/screenshot hosts, null for everything
// else (which then falls through to keyword + engagement gates).
describe('checkRedditDomainSignal', () => {
  describe('returns "high" for trusted AI/tech publishing domains', () => {
    it.each([
      'https://arxiv.org/abs/2604.01234',
      'https://www.arxiv.org/abs/2604.01234',
      'https://openreview.net/forum?id=abc',
      'https://huggingface.co/Qwen/Qwen3-72B',
      'https://hf.co/datasets/foo',
      'https://github.com/ggml-org/llama.cpp/pull/22493',
      'https://openai.com/news/gpt-5',
      'https://blog.google/technology/ai/foo',
      'https://deepmind.google/discover/blog/alphaevolve',
      'https://research.google/blog/foo',
      'https://www.anthropic.com/news/claude-3',
      'https://alignment.anthropic.com/2026/midtraining',
      'https://ai.meta.com/blog/llama-4',
      'https://deepseek.com/blog/v4',
      'https://mistral.ai/news/mistral-large',
      'https://x.ai/blog/grok-3',
      'https://qwenlm.github.io/blog/qwen3',
      'https://www.nytimes.com/2026/05/09/ai-vetting',
      'https://www.wsj.com/tech/ai/foo',
      'https://www.theverge.com/ai-artificial-intelligence/foo',
      'https://arstechnica.com/ai/foo',
      'https://www.cnbc.com/2026/05/09/foo',
      'https://www.bloomberg.com/news/foo',
      'https://www.reuters.com/technology/foo',
      'https://www.ft.com/content/foo',
      'https://www.theinformation.com/articles/foo',
      'https://lmarena.ai/leaderboard',
      'https://livebench.ai/',
      'https://swebench.com/',
      'https://artificialanalysis.ai/models',
    ])('high: %s', (url) => {
      expect(checkRedditDomainSignal(url)).toBe('high');
    });
  });

  describe('returns "low" for meme/image/video/cross-post hosts', () => {
    it.each([
      'https://i.redd.it/abcdef.png',
      'https://v.redd.it/xyz123',
      'https://preview.redd.it/foo.jpg',
      'https://imgur.com/gallery/abc',
      'https://i.imgur.com/abc.png',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://x.com/sama/status/1234',
      'https://twitter.com/sama/status/1234',
      'https://www.tiktok.com/@user/video/123',
      'https://www.reddit.com/r/ChatGPT/comments/abc/another_meme/',
    ])('low: %s', (url) => {
      expect(checkRedditDomainSignal(url)).toBe('low');
    });
  });

  describe('returns null for ambiguous / uncurated domains', () => {
    it.each([
      'https://www.fortune.com/2026/05/09/anthropic',
      'https://futurism.com/article/foo',
      'https://www.linkedin.com/posts/spotify-cto',
      'https://example.com/random',
      'https://www.cnet.com/tech/foo',
    ])('null: %s', (url) => {
      expect(checkRedditDomainSignal(url)).toBeNull();
    });
  });

  describe('handles edge cases', () => {
    it('returns null when url is null', () => {
      expect(checkRedditDomainSignal(null)).toBeNull();
    });

    it('returns null when url is empty', () => {
      expect(checkRedditDomainSignal('')).toBeNull();
    });

    it('returns null when url is malformed', () => {
      expect(checkRedditDomainSignal('not a url')).toBeNull();
    });

    it('is case-insensitive on host', () => {
      expect(checkRedditDomainSignal('https://ARXIV.ORG/abs/123')).toBe('high');
      expect(checkRedditDomainSignal('https://I.REDD.IT/abc.png')).toBe('low');
    });

    it('does NOT match a domain whose suffix accidentally contains a trusted name', () => {
      // evil-arxiv.org should not match arxiv.org via naive substring
      expect(checkRedditDomainSignal('https://evil-arxiv.org/foo')).toBeNull();
      expect(checkRedditDomainSignal('https://anthropic.com.attacker.net/foo')).toBeNull();
    });
  });
});
