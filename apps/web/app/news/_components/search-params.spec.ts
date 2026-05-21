import { describe, it, expect } from 'vitest';
import {
  buildNewsUrl,
  DEFAULT_RANGE,
  DEFAULT_SORT,
  parseRange,
  parseSort,
  parseTags,
  TAB_PLATFORMS,
  toggleTag,
} from './search-params';

describe('parseRange', () => {
  it('returns default 1d when undefined', () => {
    expect(parseRange(undefined)).toBe('1d');
  });

  it('accepts 1d / 7d / 30d', () => {
    expect(parseRange('1d')).toBe('1d');
    expect(parseRange('7d')).toBe('7d');
    expect(parseRange('30d')).toBe('30d');
  });

  it('lowercases and trims', () => {
    expect(parseRange(' 7D ')).toBe('7d');
    expect(parseRange('30D')).toBe('30d');
  });

  it('returns default for invalid values (1h / all / "" / random)', () => {
    expect(parseRange('1h')).toBe('1d');
    expect(parseRange('all')).toBe('1d');
    expect(parseRange('')).toBe('1d');
    expect(parseRange('garbage')).toBe('1d');
  });
});

describe('parseSort', () => {
  it('returns default time when undefined', () => {
    expect(parseSort(undefined)).toBe('time');
  });

  it('accepts time / heat', () => {
    expect(parseSort('time')).toBe('time');
    expect(parseSort('heat')).toBe('heat');
  });

  it('lowercases mixed case', () => {
    expect(parseSort('HEAT')).toBe('heat');
  });

  it('returns default for unknown values', () => {
    expect(parseSort('popularity')).toBe('time');
    expect(parseSort('')).toBe('time');
  });
});

describe('parseTags', () => {
  it('returns empty array when undefined or empty', () => {
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags('')).toEqual([]);
  });

  it('parses single tag', () => {
    expect(parseTags('category:OpenSource')).toEqual(['category:OpenSource']);
  });

  it('parses multi-tag with order preserved', () => {
    expect(parseTags('category:Opinion,company:OpenAI')).toEqual([
      'category:Opinion',
      'company:OpenAI',
    ]);
  });

  it('trims surrounding whitespace per tag', () => {
    expect(parseTags(' category:Funding , company:Cursor ')).toEqual([
      'category:Funding',
      'company:Cursor',
    ]);
  });

  it('filters out empty fragments (trailing / leading commas)', () => {
    expect(parseTags(',category:Release,,company:Anthropic,')).toEqual([
      'category:Release',
      'company:Anthropic',
    ]);
  });
});

describe('buildNewsUrl', () => {
  it('returns /news with empty state', () => {
    expect(buildNewsUrl({})).toBe('/news');
  });

  it('omits default values from URL (community / 1d / time / no tags)', () => {
    expect(
      buildNewsUrl({
        tab: 'community',
        range: '1d',
        sort: 'time',
        tags: [],
      }),
    ).toBe('/news');
  });

  it('includes non-default tab=media', () => {
    expect(buildNewsUrl({ tab: 'media' })).toBe('/news?tab=media');
  });

  it('includes non-default range=7d', () => {
    expect(buildNewsUrl({ range: '7d' })).toBe('/news?range=7d');
  });

  it('includes non-default sort=heat', () => {
    expect(buildNewsUrl({ sort: 'heat' })).toBe('/news?sort=heat');
  });

  it('includes tags joined by comma', () => {
    expect(buildNewsUrl({ tags: ['category:OpenSource', 'company:Anthropic'] })).toBe(
      '/news?tags=category%3AOpenSource%2Ccompany%3AAnthropic',
    );
  });

  it('combines all 4 dimensions when non-default', () => {
    const url = buildNewsUrl({
      tab: 'media',
      range: '30d',
      sort: 'heat',
      tags: ['category:Funding'],
    });
    // URLSearchParams orders insertion: tab → range → sort → tags
    expect(url).toBe('/news?tab=media&range=30d&sort=heat&tags=category%3AFunding');
  });
});

describe('toggleTag', () => {
  it('appends tag when not present', () => {
    expect(toggleTag(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('removes tag when present', () => {
    expect(toggleTag(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('returns empty array when toggling sole tag off', () => {
    expect(toggleTag(['a'], 'a')).toEqual([]);
  });

  it('returns single-element array when toggling fresh tag from empty', () => {
    expect(toggleTag([], 'a')).toEqual(['a']);
  });

  it('case-sensitive match (different case = added not removed)', () => {
    expect(toggleTag(['category:OpenAI'], 'category:openai')).toEqual([
      'category:OpenAI',
      'category:openai',
    ]);
  });

  it('does not mutate input array', () => {
    const input = ['a', 'b'];
    toggleTag(input, 'c');
    expect(input).toEqual(['a', 'b']);
  });
});

describe('module constants', () => {
  it('DEFAULT_RANGE = 1d (路径 A 决策)', () => {
    expect(DEFAULT_RANGE).toBe('1d');
  });

  it('DEFAULT_SORT = time (保持 SP-9/11 URL 兼容)', () => {
    expect(DEFAULT_SORT).toBe('time');
  });

  it('TAB_PLATFORMS preserves SP-4.5 / SP-8 mapping', () => {
    expect(TAB_PLATFORMS.community).toEqual(['HACKERNEWS', 'REDDIT']);
    expect(TAB_PLATFORMS.media).toEqual(['RSS']);
  });
});
