/**
 * SP-9 (2026-05-19): Map prefix-encoded `aiTag` strings back into display
 * labels for the UI. Pure, deterministic, no I/O.
 *
 * Used by:
 *   - `apps/api/src/stats/stats.service.ts::getTrendingKeywords` to fill
 *     `TrendingKeywordsDto.items[i].label`
 *   - Future SP-11 / SP-12 UI when they need to render aiTags as chips
 *
 * Tag shape contract (set by SP-5 prompts + parser):
 *   `<prefix>:<slug>` where prefix ∈ { 'company', 'model', 'category', 'tech' }
 *   and slug is lower-case kebab/underscore separated.
 *
 * Examples:
 *   'company:openai'       → 'OpenAI'
 *   'company:deepseek'     → 'DeepSeek'
 *   'model:claude-4'       → 'Claude 4'
 *   'model:gpt-4o-mini'    → 'GPT 4o Mini'
 *   'category:research'    → 'Research'
 *   'tech:rag'             → 'RAG'
 *   'tech:rag-system'      → 'RAG System'
 *   'weird-no-prefix'      → 'weird-no-prefix' (no transform when no colon)
 *
 * The function is INTENTIONALLY UI-layer and stays separate from
 * `@ai-hot-news/prompts` taxonomy (which is the LLM's source-of-truth
 * vocabulary). Don't merge — they serve different consumers.
 */

const KNOWN_ACRONYMS = new Set([
  'rag',
  'llm',
  'ai',
  'gpu',
  'cpu',
  'tpu',
  'api',
  'sdk',
  'mcp',
  'cli',
  'tts',
  'stt',
  'vlm',
  'rl',
  'ml',
  'nlp',
  'cv',
  'gan',
  'vae',
  'kv',
  'gpt',
  'gguf',
  'qlora',
  'lora',
]);

/**
 * Brands / product names whose canonical mixed-case form cannot be
 * inferred from kebab segments. Lower-case key, canonical-cased value.
 * Add entries here when trending output renders something off-looking
 * like "Openai" or "Github".
 */
const BRAND_OVERRIDES: Record<string, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  huggingface: 'HuggingFace',
  github: 'GitHub',
  gitlab: 'GitLab',
  langchain: 'LangChain',
  langgraph: 'LangGraph',
  pytorch: 'PyTorch',
  tensorflow: 'TensorFlow',
  llama: 'Llama',
  jetbrains: 'JetBrains',
  vscode: 'VS Code',
  chatgpt: 'ChatGPT',
};

export function stripTagLabel(tag: string): string {
  const colonIdx = tag.indexOf(':');
  // No prefix → return as-is (caller may have passed a non-prefixed tag).
  if (colonIdx === -1) return tag;
  const raw = tag.slice(colonIdx + 1);
  if (!raw) return tag;

  return raw
    .split(/[-_]/)
    .map((part) => {
      if (!part) return '';
      const lower = part.toLowerCase();
      if (BRAND_OVERRIDES[lower]) return BRAND_OVERRIDES[lower];
      if (KNOWN_ACRONYMS.has(lower)) return lower.toUpperCase();
      // Preserve already-mixed-case (e.g. caller passed "OpenAI" raw)
      if (part !== lower && part !== part.toUpperCase()) return part;
      // Default: Title-case the lowered form
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .filter((p) => p.length > 0)
    .join(' ');
}
