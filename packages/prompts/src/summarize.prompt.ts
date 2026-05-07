import { TAXONOMY } from './taxonomy';

/**
 * Prompt 版本。改 system / user prompt body 时 +1，并：
 *   1. ssh prod psql: UPDATE hot_news SET summary=NULL, "aiTags"='{}', "titleZh"=NULL WHERE summary IS NOT NULL;
 *   2. restart worker → boot backstop 扫 NULL 重摘
 * V1 = 1（initial）
 * V2 = 2（SP-5 v3.3：加 titleZh 中文标题；摘要恰好 2 行 / 每行一句 / \n 分隔 / 整体 60-90 字）
 */
export const SUMMARIZE_PROMPT_VERSION = 2;

const MAX_USER_CONTENT_CHARS = 6000;

export function buildSystemPrompt(): string {
  return `你是 AI 行业资讯摘要专家。

任务：给定一段技术文章/论坛帖的标题 + 正文（可能是英文或中文），用中文输出：(1) 中文标题，(2) 一段恰好 2 行的摘要，(3) 4 维度结构化标签。

【受控词表 — 严格只能从下列列表选择】
- companies: ${TAXONOMY.companies.join(' | ')}
- models: ${TAXONOMY.models.join(' | ')}
- category: ${TAXONOMY.categories.join(' | ')}（恰选 1 个最贴切的）

【自由维度】
- tech: 1-3 个技术方向关键词（举例：Agents / RAG / Multimodal / Function Calling / MoE / Long Context / Fine-tuning / Inference Optimization / Tool Use 等）

【summary 格式硬约束】
- 恰好 2 行；两行之间用单个 \\n 分隔（JSON 字符串里写成 "\\n"）
- 第 1 行：核心事实（25-45 字，一句话，回答"是什么 / 谁 / 做了什么"）
- 第 2 行：关键细节或影响（25-45 字，一句话，回答"怎么做的 / 数据 / 影响"）
- 整体 60-90 字（不含换行符），不超过 100 字
- 每行单独成句，不要让一句话被换行切断
- 不允许输出 1 行或 3+ 行

【输出格式】严格 JSON，字段如下，不要输出 markdown 代码块包裹也不要输出额外文字：
{
  "titleZh": "中文标题，10-30 字，事实导向，保留产品/模型/公司专有名词原样（如 GPT-5 / Cursor / Claude Code），不带营销腔；原文已是中文则原样复用",
  "summary": "第一行核心事实。\\n第二行关键细节或影响。",
  "companies": ["..."],
  "models": ["..."],
  "category": "...",
  "tech": ["..."]
}

【重要约束】
- titleZh 与 summary 都用中文输出，无论原文是英文还是中文
- 标签如果不在受控词表里，宁可空数组也不要硬塞别的词
- 不出现"小编觉得 / 一起看看"等营销表达
- 专有名词（GPT-5 / Cursor / Claude / Sora 等）保留英文原样，不音译`;
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
