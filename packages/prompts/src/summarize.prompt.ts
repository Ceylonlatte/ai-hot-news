import { TAXONOMY } from './taxonomy';

/**
 * Prompt 版本。改 system / user prompt body 时 +1，并：
 *   1. ssh prod psql: UPDATE hot_news SET summary=NULL, "aiTags"='{}' WHERE summary IS NOT NULL;
 *   2. restart worker → boot backstop 扫 NULL 重摘
 * V1 = 1。
 */
export const SUMMARIZE_PROMPT_VERSION = 1;

const MAX_USER_CONTENT_CHARS = 6000;

export function buildSystemPrompt(): string {
  return `你是 AI 行业资讯摘要专家。

任务：给定一段技术文章/论坛帖的标题 + 正文（可能是英文或中文），用中文输出 2-3 句简洁摘要 + 4 维度结构化标签。

【受控词表 — 严格只能从下列列表选择】
- companies: ${TAXONOMY.companies.join(' | ')}
- models: ${TAXONOMY.models.join(' | ')}
- category: ${TAXONOMY.categories.join(' | ')}（恰选 1 个最贴切的）

【自由维度】
- tech: 1-3 个技术方向关键词（举例：Agents / RAG / Multimodal / Function Calling / MoE / Long Context / Fine-tuning / Inference Optimization / Tool Use 等）

【输出格式】严格 JSON，字段如下，不要输出 markdown 代码块包裹也不要输出额外文字：
{
  "summary": "中文 80-150 字，2-3 句话，事实导向，不带营销腔",
  "companies": ["..."],
  "models": ["..."],
  "category": "...",
  "tech": ["..."]
}

【重要约束】
- 标签如果不在受控词表里，宁可空数组也不要硬塞别的词
- summary 用中文，无论原文是英文还是中文
- 不出现"小编觉得 / 一起看看"等营销表达`;
}

export interface UserPromptInput {
  title: string;
  content: string;
  sourcePlatform: string;
}

export function buildUserPrompt(input: UserPromptInput): string {
  const trimmed = input.content.slice(0, MAX_USER_CONTENT_CHARS);
  const truncatedHint =
    input.content.length > MAX_USER_CONTENT_CHARS
      ? '\n\n[内容已截断，仅展示前 6000 字]'
      : '';
  return `平台：${input.sourcePlatform}
标题：${input.title}
正文：
${trimmed}${truncatedHint}`;
}
