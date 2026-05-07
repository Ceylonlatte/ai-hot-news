import { describe, it, expect } from 'vitest';
import { parseSummarizeResponse } from './parse';

const goodJson = JSON.stringify({
  titleZh: 'OpenAI 发布 GPT-5：推理能力大幅提升',
  summary:
    'OpenAI 今日发布 GPT-5，相比 GPT-4o 在数学推理上提升 30%。\n模型已开放给所有 API 用户，定价与 GPT-4o 持平。',
  companies: ['OpenAI'],
  models: ['GPT-5'],
  category: 'Release',
  tech: ['Reasoning'],
});

describe('parseSummarizeResponse', () => {
  it('parses a clean JSON response with all fields', () => {
    const r = parseSummarizeResponse(goodJson);
    expect(r).not.toBeNull();
    expect(r!.summary).toMatch(/OpenAI 今日发布 GPT-5/);
    expect(r!.aiTags).toEqual(
      expect.arrayContaining([
        'company:OpenAI',
        'model:GPT-5',
        'category:Release',
        'tech:Reasoning',
      ]),
    );
  });

  it('returns null when JSON is completely invalid', () => {
    expect(parseSummarizeResponse('not json at all')).toBeNull();
  });

  it('returns null when summary field is missing', () => {
    const r = parseSummarizeResponse(JSON.stringify({ companies: [], category: 'Release' }));
    expect(r).toBeNull();
  });

  it('returns null when summary is empty string', () => {
    const r = parseSummarizeResponse(JSON.stringify({ summary: '', companies: [] }));
    expect(r).toBeNull();
  });

  it('returns null when raw response is empty', () => {
    expect(parseSummarizeResponse('')).toBeNull();
  });

  it('extracts JSON from response with leading noise (e.g. "好的，根据要求...{...}")', () => {
    const noisy = `好的，根据要求生成如下结果：${goodJson}`;
    const r = parseSummarizeResponse(noisy);
    expect(r).not.toBeNull();
    expect(r!.summary).toMatch(/OpenAI/);
  });

  it('extracts JSON from markdown-wrapped response (```json {...} ```)', () => {
    const wrapped = '```json\n' + goodJson + '\n```';
    const r = parseSummarizeResponse(wrapped);
    expect(r).not.toBeNull();
  });

  it('drops companies not in the controlled taxonomy', () => {
    const json = JSON.stringify({
      summary: '某不知名公司发了新产品。',
      companies: ['UnknownCo', 'OpenAI'],
      models: [],
      category: 'Product',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.aiTags).toContain('company:OpenAI');
    expect(r.aiTags).not.toContain('company:UnknownCo');
  });

  it('drops invalid category (not in 8 enum values)', () => {
    const json = JSON.stringify({
      summary: '业内讨论了一些观点。',
      companies: [],
      models: [],
      category: 'NotARealCategory',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.aiTags.find((t) => t.startsWith('category:'))).toBeUndefined();
  });

  it('truncates each multi-value array dimension to ≤ 3', () => {
    const json = JSON.stringify({
      summary: 'AI 巨头联合发布。',
      companies: ['OpenAI', 'Anthropic', 'Google', 'Meta', 'Microsoft'],
      models: [],
      category: 'Release',
      tech: ['Agents', 'RAG', 'Multimodal', 'MoE', 'Long Context'],
    });
    const r = parseSummarizeResponse(json)!;
    const companyTags = r.aiTags.filter((t) => t.startsWith('company:'));
    const techTags = r.aiTags.filter((t) => t.startsWith('tech:'));
    expect(companyTags.length).toBeLessThanOrEqual(3);
    expect(techTags.length).toBeLessThanOrEqual(3);
  });

  it('truncates summary at 400 chars hard cap', () => {
    const longSummary = '中'.repeat(500);
    const json = JSON.stringify({ summary: longSummary, companies: [], models: [], category: 'Opinion', tech: [] });
    const r = parseSummarizeResponse(json)!;
    expect(r.summary.length).toBeLessThanOrEqual(400);
  });

  it('drops non-string array elements', () => {
    const json = JSON.stringify({
      summary: 'OpenAI did things.',
      companies: ['OpenAI', 123, null, { foo: 1 }],
      models: [],
      category: 'Release',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.aiTags).toEqual(expect.arrayContaining(['company:OpenAI']));
    expect(r.aiTags.filter((t) => t.startsWith('company:'))).toHaveLength(1);
  });

  it('truncates tech tag value to 30 chars (free-form dimension)', () => {
    const json = JSON.stringify({
      summary: 'A very specific paper.',
      companies: [],
      models: [],
      category: 'Research',
      tech: ['x'.repeat(50)],
    });
    const r = parseSummarizeResponse(json)!;
    const techTag = r.aiTags.find((t) => t.startsWith('tech:'));
    expect(techTag).toBeDefined();
    expect(techTag!.length).toBeLessThanOrEqual(35);
  });

  it('parses titleZh when present (SP-5 v3.3)', () => {
    const r = parseSummarizeResponse(goodJson)!;
    expect(r.titleZh).toBe('OpenAI 发布 GPT-5：推理能力大幅提升');
  });

  it('returns titleZh=null when field is missing (V1 prompt back-compat)', () => {
    const json = JSON.stringify({
      summary: '一段摘要',
      companies: [],
      models: [],
      category: 'Opinion',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.titleZh).toBeNull();
  });

  it('returns titleZh=null when field is empty / whitespace', () => {
    const json = JSON.stringify({
      titleZh: '   ',
      summary: '一段摘要',
      companies: [],
      models: [],
      category: 'Opinion',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.titleZh).toBeNull();
  });

  it('returns titleZh=null when field is non-string', () => {
    const json = JSON.stringify({
      titleZh: 123,
      summary: '一段摘要',
      companies: [],
      models: [],
      category: 'Opinion',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.titleZh).toBeNull();
  });

  it('caps titleZh at 100 chars to defend against runaway LLM output', () => {
    const json = JSON.stringify({
      titleZh: '中'.repeat(200),
      summary: '正常摘要\n第二行',
      companies: [],
      models: [],
      category: 'Opinion',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.titleZh).not.toBeNull();
    expect(r.titleZh!.length).toBeLessThanOrEqual(100);
  });

  it('preserves two-line summary as-is (joined with single \\n)', () => {
    const r = parseSummarizeResponse(goodJson)!;
    const lines = r.summary.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/OpenAI 今日发布 GPT-5/);
    expect(lines[1]).toMatch(/API 用户/);
  });

  it('normalizes 3+ line summary down to first 2 non-empty lines (LLM drift defense)', () => {
    const json = JSON.stringify({
      titleZh: 't',
      summary: '第一行核心事实。\n第二行关键细节。\n第三行多余的话。\n第四行也不要',
      companies: [],
      models: [],
      category: 'Opinion',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    const lines = r.summary.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('第一行核心事实。');
    expect(lines[1]).toBe('第二行关键细节。');
  });

  it('normalizes blank lines between sentences (\\n\\n → \\n)', () => {
    const json = JSON.stringify({
      titleZh: 't',
      summary: '第一行。\n\n第二行。',
      companies: [],
      models: [],
      category: 'Opinion',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.summary).toBe('第一行。\n第二行。');
  });

  it('normalizes CRLF / CR line endings to LF', () => {
    const json = JSON.stringify({
      titleZh: 't',
      summary: '第一行。\r\n第二行。',
      companies: [],
      models: [],
      category: 'Opinion',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.summary).toBe('第一行。\n第二行。');
  });

  it('accepts a single-line summary as-is (no synthetic line break injected)', () => {
    const json = JSON.stringify({
      titleZh: 't',
      summary: '仅有一行内容。',
      companies: [],
      models: [],
      category: 'Opinion',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.summary).toBe('仅有一行内容。');
    expect(r.summary).not.toContain('\n');
  });
});
