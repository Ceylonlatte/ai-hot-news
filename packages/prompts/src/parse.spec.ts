import { describe, it, expect } from 'vitest';
import { parseSummarizeResponse } from './parse';

const goodJson = JSON.stringify({
  titleZh: 'OpenAI 发布 GPT-5：推理能力大幅提升',
  summary:
    'OpenAI 发布 GPT-5，数学推理较 GPT-4o 提升 30%，已开放给所有 API 用户，定价与 GPT-4o 持平。',
  companies: ['OpenAI'],
  models: ['GPT-5'],
  category: 'Release',
  tech: ['Reasoning'],
});

describe('parseSummarizeResponse', () => {
  it('parses a clean JSON response with all fields', () => {
    const r = parseSummarizeResponse(goodJson);
    expect(r).not.toBeNull();
    expect(r!.summary).toMatch(/OpenAI 发布 GPT-5/);
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

  it('accepts OpenSource as a valid category (SP-5.6)', () => {
    // SP-5.6 expanded TAXONOMY.categories 8 → 10; LLM 输出 `category: 'OpenSource'`
    // 应当被 parser 接受并打到 `category:OpenSource` 标签上 — SP-10 顶部 chip filter
    // "开源" 依赖此 tag 命中。命名约定无空格：`OpenSource` 而非 `Open Source`，
    // 与 taxonomy.ts 的 readonly tuple 字面量严格匹配。
    const json = JSON.stringify({
      titleZh: '某团队开源 LLM 微调工具链',
      summary: '某团队在 GitHub 上开源了一套 LLM 微调工具链，覆盖数据清洗、训练、评测三阶段。',
      companies: [],
      models: [],
      category: 'OpenSource',
      tech: ['Fine-tuning'],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.aiTags).toContain('category:OpenSource');
  });

  it('accepts Funding as a valid category (SP-5.6)', () => {
    const json = JSON.stringify({
      titleZh: '某 AI 公司完成 B 轮融资',
      summary: '某 AI 初创公司宣布完成 1.5 亿美元 B 轮融资，由 Sequoia 领投，估值 10 亿美元。',
      companies: [],
      models: [],
      category: 'Funding',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.aiTags).toContain('category:Funding');
  });

  it('drops invalid category (not in taxonomy)', () => {
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

  it('returns titleZh=null when LLM lazy-copied the original English title (no CJK chars)', () => {
    // Real-world prod sample: LLM 应当翻译为「某 OpenAI 文章」但偷懒原样返回了
    // 英文。新规则识别"无 CJK 字符" → set null → UI fallback 到原 title。
    const json = JSON.stringify({
      titleZh: 'Why do haters keep insisting LLMs cant code?',
      summary: '资深工程师分享了一段经历\n讨论 LLM 的实际编程能力。',
      companies: [],
      models: [],
      category: 'Opinion',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.titleZh).toBeNull();
    // summary / aiTags 不应受影响
    expect(r.summary).toMatch(/资深工程师/);
  });

  it('returns titleZh=null when LLM rephrased the title but still produced English-only output', () => {
    // 比上一种更隐蔽的偷懒：LLM 改写了大小写 / 标点但没真的翻译
    const json = JSON.stringify({
      titleZh: 'Show HN: Built an Agent Memory Library',
      summary: '一段正常的中文摘要。',
      companies: [],
      models: [],
      category: 'Open Source',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.titleZh).toBeNull();
  });

  it('accepts titleZh that mixes CJK + Latin (real-world product names retained)', () => {
    // PRD 要求「保留专有名词」，所以「Cursor 0.50 内置 AI 安全审查」是合法翻译
    const json = JSON.stringify({
      titleZh: 'Cursor 0.50 内置 AI 安全审查功能',
      summary: '正常摘要内容。',
      companies: ['Cursor'],
      models: [],
      category: 'Product',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.titleZh).toBe('Cursor 0.50 内置 AI 安全审查功能');
  });

  it('passes through a single-paragraph summary unchanged (SP-5 v3.4 default)', () => {
    const r = parseSummarizeResponse(goodJson)!;
    expect(r.summary).not.toContain('\n');
    expect(r.summary).toMatch(/OpenAI 发布 GPT-5/);
    expect(r.summary).toMatch(/API 用户/);
  });

  it('still passes through a deliberately two-line summary unchanged (LLM-elected dual-dimension shape)', () => {
    const json = JSON.stringify({
      titleZh: 't',
      summary:
        'OpenAI 发布 GPT-5，数学推理较 GPT-4o 提升 30%。\n但研究者指出该评测集已被多家模型针对性优化，实际收益仍需独立验证。',
      companies: [],
      models: [],
      category: 'Release',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.summary.split('\n')).toHaveLength(2);
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
