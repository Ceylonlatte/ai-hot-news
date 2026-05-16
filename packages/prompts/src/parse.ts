import { TAXONOMY } from './taxonomy';

export interface SummarizeResult {
  /**
   * SP-5 v3.3: AI-translated Chinese title (10-30 chars target, hard-capped to 100).
   * `null` when the LLM omitted the field (legacy V1 prompts), produced empty
   * string, OR produced a string with no CJK characters (LLM laziness defense
   * added 2026-05-16: prod实测 ~6.9% rows had `titleZh` byte-equal to original
   * English `title` because the LLM gave up on translation; setting it to null
   * lets the UI's `titleZh ?? title` fallback work cleanly instead of pinning
   * a fake-translation string in the DB forever).
   * Caller writes to `HotNews.titleZh` and falls back to original `title`
   * in the UI when null.
   */
  titleZh: string | null;
  /** 已 trim + 截断到 ≤400 字符 */
  summary: string;
  /** prefix-encoded: 'company:OpenAI' / 'model:GPT-5' / 'category:Release' / 'tech:Agents' */
  aiTags: string[];
}

const MAX_TAGS_PER_DIM = 3;
const MAX_SUMMARY_CHARS = 400;
const MAX_TITLE_ZH_CHARS = 100;
const MAX_TECH_VALUE_CHARS = 30;

/**
 * Matches any CJK Unified Ideograph in the BMP range (U+4E00–U+9FFF).
 * Covers ~99% of modern Chinese characters. Excludes CJK punctuation and
 * Latin-only strings — exactly the discrimination we need to detect the
 * "LLM gave up and copy-pasted the English title" failure mode.
 */
const HAS_CJK = /[\u4E00-\u9FFF]/;

function extractJson(raw: string): unknown | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

/**
 * SP-5 v3.3: enforce "exactly 2 lines" on summary as a soft defense against
 * LLM drift (3+ lines / single-line / blank lines between sentences).
 *
 * Rules:
 * - normalize CRLF/CR → LF
 * - drop empty lines (\n\n becomes \n)
 * - take first 2 non-empty lines, join with single '\n'
 * - if input has only 1 non-empty line, return it as-is (caller still gets a
 *   valid summary; UI line-clamp-2 handles overflow visually)
 */
function normalizeToTwoLines(s: string): string {
  const lines = s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.slice(0, 2).join('\n');
}

function isCompany(s: string): boolean {
  return (TAXONOMY.companies as readonly string[]).includes(s);
}
function isModel(s: string): boolean {
  return (TAXONOMY.models as readonly string[]).includes(s);
}
function isCategory(s: string): boolean {
  return (TAXONOMY.categories as readonly string[]).includes(s);
}

export function parseSummarizeResponse(raw: string): SummarizeResult | null {
  if (!raw) return null;
  const obj = extractJson(raw) as Record<string, unknown> | null;
  if (!obj) return null;

  const summaryRaw = String(obj.summary ?? '').trim().slice(0, MAX_SUMMARY_CHARS);
  if (!summaryRaw) return null;
  const summary = normalizeToTwoLines(summaryRaw);
  if (!summary) return null;

  const titleZhRaw = typeof obj.titleZh === 'string' ? obj.titleZh.trim() : '';
  const titleZhCandidate = titleZhRaw ? titleZhRaw.slice(0, MAX_TITLE_ZH_CHARS) : null;
  // SP-5 titleZh-cjk-guard (2026-05-16): LLM 偷懒会把原英文标题原样/改写后返回
  // 而不真的翻译。用单一 CJK 检查识别这种"假翻译"，set null 让 UI fallback
  // 到原 title 显示。已 trim 过、已 slice 过，纯防御性的最后一道闸。
  const titleZh =
    titleZhCandidate && HAS_CJK.test(titleZhCandidate) ? titleZhCandidate : null;

  const tags: string[] = [];

  for (const c of asStringArray(obj.companies).slice(0, MAX_TAGS_PER_DIM)) {
    if (isCompany(c)) tags.push(`company:${c}`);
  }
  for (const m of asStringArray(obj.models).slice(0, MAX_TAGS_PER_DIM)) {
    if (isModel(m)) tags.push(`model:${m}`);
  }
  if (typeof obj.category === 'string' && isCategory(obj.category)) {
    tags.push(`category:${obj.category}`);
  }
  for (const t of asStringArray(obj.tech).slice(0, MAX_TAGS_PER_DIM)) {
    const trimmed = t.trim().slice(0, MAX_TECH_VALUE_CHARS);
    if (trimmed) tags.push(`tech:${trimmed}`);
  }

  return { titleZh, summary, aiTags: tags };
}
