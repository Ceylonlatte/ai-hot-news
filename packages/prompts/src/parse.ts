import { TAXONOMY } from './taxonomy';

export interface SummarizeResult {
  /** 已 trim + 截断到 ≤400 字符 */
  summary: string;
  /** prefix-encoded: 'company:OpenAI' / 'model:GPT-5' / 'category:Release' / 'tech:Agents' */
  aiTags: string[];
}

const MAX_TAGS_PER_DIM = 3;
const MAX_SUMMARY_CHARS = 400;
const MAX_TECH_VALUE_CHARS = 30;

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

  const summary = String(obj.summary ?? '').trim().slice(0, MAX_SUMMARY_CHARS);
  if (!summary) return null;

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

  return { summary, aiTags: tags };
}
