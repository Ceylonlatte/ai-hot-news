import { describe, expect, it } from 'vitest';
import { stripHtml } from './strip-html';

describe('stripHtml', () => {
  it('removes simple HTML tags and trims whitespace', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('removes <script> blocks entirely (with content)', () => {
    expect(stripHtml('before<script>alert(1)</script>after')).toBe('beforeafter');
  });

  it('removes <style> blocks entirely (with content)', () => {
    expect(stripHtml('a<style>.x{color:red}</style>b')).toBe('ab');
  });

  it('collapses runs of whitespace into a single space', () => {
    expect(stripHtml('  hello   \n   world  ')).toBe('hello world');
  });

  it('returns an empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });

  it('handles input without any tags unchanged (modulo whitespace)', () => {
    expect(stripHtml('plain text')).toBe('plain text');
  });

  it('strips nested and self-closing tags', () => {
    expect(stripHtml('<div><img src="x"/><span>y</span></div>')).toBe('y');
  });

  it('does NOT decode HTML entities (left as-is by design)', () => {
    expect(stripHtml('a &amp; b')).toBe('a &amp; b');
  });
});
