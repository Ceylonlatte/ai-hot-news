import { describe, expect, it } from 'vitest';
import { stripTitleBoilerplate, stripContentBoilerplate } from './boilerplate';

describe('stripTitleBoilerplate', () => {
  it('strips " - <whitelisted site>" suffix', () => {
    expect(stripTitleBoilerplate('GPT-5 announced - OpenAI Blog')).toBe('GPT-5 announced');
  });

  it('strips " | <whitelisted site>" suffix', () => {
    expect(stripTitleBoilerplate('AI news | TechCrunch')).toBe('AI news');
  });

  it('strips " — <whitelisted site>" suffix (em-dash)', () => {
    expect(stripTitleBoilerplate('Claude 4 — Anthropic')).toBe('Claude 4');
  });

  it('strips " – <whitelisted site>" suffix (en-dash)', () => {
    expect(stripTitleBoilerplate('Gemini update – Google AI Blog')).toBe('Gemini update');
  });

  it('does NOT strip when the suffix is not in the whitelist', () => {
    expect(stripTitleBoilerplate('GPT-5 - The Next Generation')).toBe(
      'GPT-5 - The Next Generation',
    );
  });

  it('does NOT strip a separator that appears in the middle (only matches the tail)', () => {
    expect(stripTitleBoilerplate('Article - about - something')).toBe(
      'Article - about - something',
    );
  });

  it('returns the title trimmed when no boilerplate matches', () => {
    expect(stripTitleBoilerplate('  Trim test  ')).toBe('Trim test');
  });

  it('returns the empty string for an empty input', () => {
    expect(stripTitleBoilerplate('')).toBe('');
  });

  it('handles a title that IS the site name without a separator', () => {
    expect(stripTitleBoilerplate('OpenAI Blog')).toBe('OpenAI Blog');
  });

  it('strips OpenAI / Anthropic / Hugging Face / The Verge / YouTube / X', () => {
    expect(stripTitleBoilerplate('Sora demo - OpenAI')).toBe('Sora demo');
    expect(stripTitleBoilerplate('Constitutional AI - Anthropic')).toBe('Constitutional AI');
    expect(stripTitleBoilerplate('Llama-4 weights - Hugging Face')).toBe('Llama-4 weights');
    expect(stripTitleBoilerplate('AI scoop - The Verge')).toBe('AI scoop');
    expect(stripTitleBoilerplate('Demo video - YouTube')).toBe('Demo video');
    expect(stripTitleBoilerplate('Hot take - X')).toBe('Hot take');
  });
});

describe('stripContentBoilerplate', () => {
  it('strips a "Read more →" tail', () => {
    expect(stripContentBoilerplate('Body content here.\n\nRead more →')).toBe(
      'Body content here.',
    );
  });

  it('strips a "Continue reading" tail', () => {
    expect(stripContentBoilerplate('Body content here. Continue reading')).toBe(
      'Body content here.',
    );
  });

  it('strips "This article was first published at <site>"', () => {
    expect(
      stripContentBoilerplate(
        'Body content here. This article was first published at TechCrunch',
      ),
    ).toBe('Body content here.');
  });

  it('strips WordPress "The post X appeared first on Y"', () => {
    expect(
      stripContentBoilerplate(
        'Real content. The post My Title appeared first on Some Blog',
      ),
    ).toBe('Real content.');
  });

  it('collapses runs of spaces / tabs into a single space', () => {
    expect(stripContentBoilerplate('a    b\t\tc')).toBe('a b c');
  });

  it('collapses 3+ consecutive newlines into 2', () => {
    expect(stripContentBoilerplate('para1\n\n\n\npara2')).toBe('para1\n\npara2');
  });

  it('preserves a normal 2-newline paragraph break', () => {
    expect(stripContentBoilerplate('para1\n\npara2')).toBe('para1\n\npara2');
  });

  it('returns the empty string for empty input', () => {
    expect(stripContentBoilerplate('')).toBe('');
  });

  it('trims surrounding whitespace', () => {
    expect(stripContentBoilerplate('  hello  ')).toBe('hello');
  });
});
