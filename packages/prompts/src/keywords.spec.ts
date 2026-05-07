import { describe, expect, it } from 'vitest';
import { buildMatcher, matchesAiTopic, parseKeywords } from './keywords';

describe('parseKeywords', () => {
  it('parses comma-separated keywords and dedupes case-insensitively', () => {
    expect(parseKeywords('LLM, llm, AGI, Vibe Coding')).toEqual([
      'LLM',
      'AGI',
      'Vibe Coding',
    ]);
  });

  it('parses newline and markdown-list formats', () => {
    const raw = `
# AI keywords
- OpenAI
* Anthropic

RAG
<!-- ignored -->
`;
    expect(parseKeywords(raw)).toEqual(['OpenAI', 'Anthropic', 'RAG']);
  });

  it('supports inline commas inside markdown list lines', () => {
    expect(parseKeywords('- LLM, RAG\n- AI Agent')).toEqual([
      'LLM',
      'RAG',
      'AI Agent',
    ]);
  });
});

describe('buildMatcher', () => {
  it('matches case-insensitively with word boundaries', () => {
    const re = buildMatcher(['AI', 'AI Agent', 'GPT-4o']);
    expect(re.test('Show HN: I built an AI Agent')).toBe(true);
    expect(re.test('new gpt-4o demo')).toBe(true);
    expect(re.test('Spain on the map')).toBe(false);
  });

  it('returns a never-matching regex for empty keyword lists', () => {
    const re = buildMatcher([]);
    expect(re.test('AI Agent')).toBe(false);
  });
});

describe('matchesAiTopic', () => {
  it('uses the repository keywords bundle', () => {
    expect(matchesAiTopic('Claude Code improves AI coding workflows')).toBe(true);
    expect(matchesAiTopic('Cricket India vs Pakistan score')).toBe(false);
    expect(matchesAiTopic(null)).toBe(false);
    expect(matchesAiTopic(undefined)).toBe(false);
    expect(matchesAiTopic('')).toBe(false);
  });
});
