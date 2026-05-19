import { describe, expect, it } from 'vitest';
import { stripTagLabel } from './tag-label';

describe('stripTagLabel', () => {
  it('strips company: prefix and applies Title-case', () => {
    expect(stripTagLabel('company:google')).toBe('Google');
    expect(stripTagLabel('company:anthropic')).toBe('Anthropic');
  });

  it('applies brand override for OpenAI', () => {
    expect(stripTagLabel('company:openai')).toBe('OpenAI');
  });

  it('applies brand override for DeepSeek / HuggingFace / GitHub', () => {
    expect(stripTagLabel('company:deepseek')).toBe('DeepSeek');
    expect(stripTagLabel('company:huggingface')).toBe('HuggingFace');
    expect(stripTagLabel('company:github')).toBe('GitHub');
  });

  it('joins kebab-case with spaces and Title-cases each segment', () => {
    expect(stripTagLabel('model:claude-4')).toBe('Claude 4');
    expect(stripTagLabel('model:llama-3')).toBe('Llama 3');
    expect(stripTagLabel('category:code-generation')).toBe('Code Generation');
  });

  it('preserves known acronyms in uppercase', () => {
    expect(stripTagLabel('tech:rag')).toBe('RAG');
    expect(stripTagLabel('tech:llm')).toBe('LLM');
    expect(stripTagLabel('tech:gpu')).toBe('GPU');
    expect(stripTagLabel('tech:sdk')).toBe('SDK');
    expect(stripTagLabel('tech:mcp')).toBe('MCP');
  });

  it('handles acronym + word compounds', () => {
    expect(stripTagLabel('tech:rag-system')).toBe('RAG System');
    expect(stripTagLabel('tech:llm-tools')).toBe('LLM Tools');
  });

  it('handles brand + acronym compounds', () => {
    expect(stripTagLabel('model:openai-gpt')).toBe('OpenAI GPT');
  });

  it('returns original when no colon prefix', () => {
    expect(stripTagLabel('weird-no-prefix')).toBe('weird-no-prefix');
  });

  it('returns original when prefix has empty body', () => {
    expect(stripTagLabel('company:')).toBe('company:');
  });

  it('handles underscore separator', () => {
    expect(stripTagLabel('category:code_review')).toBe('Code Review');
  });

  it('coalesces double separators', () => {
    expect(stripTagLabel('tech:rag--system')).toBe('RAG System');
  });

  it('preserves already mixed-case input', () => {
    expect(stripTagLabel('company:JetBrains')).toBe('JetBrains');
  });
});
