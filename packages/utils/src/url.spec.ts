import { describe, expect, it } from 'vitest';
import { normalizeUrl } from './url';

describe('normalizeUrl', () => {
  it('lowercases the host and keeps the path', () => {
    expect(normalizeUrl('HTTPS://OpenAI.com/News')).toBe('https://openai.com/News');
  });

  it('strips utm_* / fbclid / gclid / ref / source query params', () => {
    expect(
      normalizeUrl(
        'https://example.com/post?id=42&utm_source=x&utm_medium=y&fbclid=z&gclid=g&ref=foo&source=rss',
      ),
    ).toBe('https://example.com/post?id=42');
  });

  it('removes the URL fragment', () => {
    expect(normalizeUrl('https://example.com/post#section-1')).toBe('https://example.com/post');
  });

  it('removes a trailing slash on a non-root path', () => {
    expect(normalizeUrl('https://example.com/post/')).toBe('https://example.com/post');
  });

  it('keeps the trailing slash on the bare host root', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('sorts remaining query parameters deterministically', () => {
    expect(normalizeUrl('https://example.com/?b=2&a=1')).toBe('https://example.com/?a=1&b=2');
  });

  it('preserves an explicit non-default port', () => {
    expect(normalizeUrl('https://example.com:8443/post')).toBe('https://example.com:8443/post');
  });

  it('returns the input unchanged when it is not a valid URL', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });

  // === SP-4: 6 new rules ===

  it('folds http to https', () => {
    expect(normalizeUrl('http://example.com/post')).toBe('https://example.com/post');
  });

  it('preserves https unchanged for the protocol rule', () => {
    expect(normalizeUrl('https://example.com/post')).toBe('https://example.com/post');
  });

  it('maps Reddit legacy hosts (old/np/new) to www.reddit.com', () => {
    expect(normalizeUrl('https://old.reddit.com/r/OpenAI/comments/abc')).toBe(
      'https://www.reddit.com/r/OpenAI/comments/abc',
    );
    expect(normalizeUrl('https://np.reddit.com/r/OpenAI/comments/abc')).toBe(
      'https://www.reddit.com/r/OpenAI/comments/abc',
    );
    expect(normalizeUrl('https://new.reddit.com/r/OpenAI/comments/abc')).toBe(
      'https://www.reddit.com/r/OpenAI/comments/abc',
    );
  });

  it('maps Twitter / mobile.twitter.com / m.x.com to x.com', () => {
    expect(normalizeUrl('https://twitter.com/user/status/123')).toBe(
      'https://x.com/user/status/123',
    );
    expect(normalizeUrl('https://mobile.twitter.com/user/status/123')).toBe(
      'https://x.com/user/status/123',
    );
    expect(normalizeUrl('https://m.x.com/user/status/123')).toBe('https://x.com/user/status/123');
  });

  it('strips m. / mobile. prefix when no host alias matches', () => {
    expect(normalizeUrl('https://m.example.com/post')).toBe('https://example.com/post');
    expect(normalizeUrl('https://mobile.bbc.co.uk/news/123')).toBe('https://bbc.co.uk/news/123');
  });

  it('keeps www unchanged (we do not unify www subdomains)', () => {
    expect(normalizeUrl('https://www.openai.com/blog/x')).toBe('https://www.openai.com/blog/x');
    expect(normalizeUrl('https://en.wikipedia.org/wiki/AI')).toBe(
      'https://en.wikipedia.org/wiki/AI',
    );
  });

  it('deduplicates repeated query parameters (last value wins)', () => {
    expect(normalizeUrl('https://example.com/?a=1&a=2&b=3')).toBe(
      'https://example.com/?a=2&b=3',
    );
  });

  it('drops a trailing empty query string', () => {
    expect(normalizeUrl('https://example.com/post?')).toBe('https://example.com/post');
  });

  it('drops the query string when only tracking params remain', () => {
    expect(normalizeUrl('https://example.com/post?utm_source=x')).toBe(
      'https://example.com/post',
    );
  });
});
