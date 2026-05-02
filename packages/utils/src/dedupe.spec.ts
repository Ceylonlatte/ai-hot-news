import { describe, expect, it } from 'vitest';
import { computeDedupeHash } from './dedupe';

describe('computeDedupeHash', () => {
  it('returns a 32-character hex string', () => {
    const h = computeDedupeHash('https://example.com/a', 'Title');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });

  it('returns the same hash for identical url+title', () => {
    expect(computeDedupeHash('https://example.com/a', 'Hello')).toBe(
      computeDedupeHash('https://example.com/a', 'Hello'),
    );
  });

  it('is case-insensitive on the title (trim + lowercase)', () => {
    expect(computeDedupeHash('https://example.com/a', '  Hello  ')).toBe(
      computeDedupeHash('https://example.com/a', 'hello'),
    );
  });

  it('is sensitive to the URL', () => {
    expect(computeDedupeHash('https://example.com/a', 'x')).not.toBe(
      computeDedupeHash('https://example.com/b', 'x'),
    );
  });

  it('handles an empty title', () => {
    expect(() => computeDedupeHash('https://example.com/a', '')).not.toThrow();
    expect(computeDedupeHash('https://example.com/a', '')).toMatch(/^[0-9a-f]{32}$/);
  });
});
