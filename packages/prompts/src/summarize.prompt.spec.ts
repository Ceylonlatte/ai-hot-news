import { describe, it, expect } from 'vitest';
import {
  SUMMARIZE_PROMPT_VERSION,
  buildSystemPrompt,
  buildUserPrompt,
} from './summarize.prompt';

describe('summarize.prompt', () => {
  it('SUMMARIZE_PROMPT_VERSION is a number ≥ 1', () => {
    expect(typeof SUMMARIZE_PROMPT_VERSION).toBe('number');
    expect(SUMMARIZE_PROMPT_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('system prompt embeds taxonomy companies (e.g. OpenAI) and categories (e.g. Release)', () => {
    const sys = buildSystemPrompt();
    expect(sys).toContain('OpenAI');
    expect(sys).toContain('Anthropic');
    expect(sys).toContain('Release');
    expect(sys).toContain('Research');
    expect(sys).toMatch(/JSON/);
    expect(sys).toMatch(/中文/);
  });

  it('system prompt instructs not to use marketing tone (no 小编 / 一起看看)', () => {
    const sys = buildSystemPrompt();
    expect(sys).toMatch(/小编|营销/);
  });

  it('system prompt declares titleZh field + exactly-2-line summary (SP-5 v3.3)', () => {
    const sys = buildSystemPrompt();
    expect(sys).toContain('titleZh');
    expect(sys).toMatch(/恰好\s*2\s*行/);
    expect(sys).toMatch(/60-90\s*字/);
    expect(sys).toContain('\\n');
    expect(sys).toContain('保留');
  });

  it('user prompt embeds platform + title + body verbatim when content < 6000 chars', () => {
    const user = buildUserPrompt({
      title: 'GPT-5 announcement',
      content: 'OpenAI released GPT-5 today.',
      sourcePlatform: 'HACKERNEWS',
    });
    expect(user).toContain('HACKERNEWS');
    expect(user).toContain('GPT-5 announcement');
    expect(user).toContain('OpenAI released GPT-5 today.');
    expect(user).not.toContain('内容已截断');
  });

  it('user prompt truncates content to first 6000 chars and adds hint when exceeded', () => {
    const long = 'a'.repeat(6500);
    const user = buildUserPrompt({
      title: 'long',
      content: long,
      sourcePlatform: 'RSS',
    });
    expect(user).toContain('a'.repeat(6000));
    expect(user).not.toContain('a'.repeat(6001));
    expect(user).toMatch(/内容已截断/);
  });
});
