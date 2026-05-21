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

  it('system prompt declares titleZh + single-paragraph 50-80 字 + 套话黑名单 (SP-5 v3.4)', () => {
    const sys = buildSystemPrompt();
    expect(sys).toContain('titleZh');
    expect(sys).toMatch(/50-80\s*字/);
    expect(sys).toMatch(/单段连贯陈述/);
    expect(sys).toMatch(/不强制换行/);
    expect(sys).toContain('文章探讨了');
    expect(sys).toContain('该 X');
    expect(sys).toContain('重磅');
    expect(sys).toContain('对照示例');
  });

  it('system prompt advertises OpenSource + Funding as valid category values (SP-5.6)', () => {
    const sys = buildSystemPrompt();
    // 受控词表通过 TAXONOMY.categories.join(' | ') 拼进 prompt，新增的两个 category 应当自动出现。
    // 这两个词撑住 SP-10 顶部 chip filter 的全召回 — 如果 prompt 不含它们，LLM 永远不会输出这两个标签。
    expect(sys).toMatch(/OpenSource/);
    expect(sys).toMatch(/Funding/);
    // category namespace 仍按预期声明
    expect(sys).toMatch(/category:/);
  });

  it('SUMMARIZE_PROMPT_VERSION is at v4 (SP-5.6 taxonomy expansion)', () => {
    expect(SUMMARIZE_PROMPT_VERSION).toBe(4);
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
