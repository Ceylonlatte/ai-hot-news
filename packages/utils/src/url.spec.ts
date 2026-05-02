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
});
