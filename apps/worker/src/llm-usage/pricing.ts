// SP-19 PR-A (2026-05-24): per-model LLM pricing table.
//
// Prices are USD per 1M tokens, mirroring OpenRouter / OpenAI billing
// units. Source: https://openrouter.ai/models — review monthly when
// usage materially shifts; SP-19 PR-B's /admin/llm-cost endpoint flags
// any model that records usage but has no entry here as "(unpriced)".
//
// Why hardcoded vs env-config:
//   - V1 has 2 models in production (summary + embed); rare changes
//   - hardcoding co-locates price next to the code that bills against it
//   - env-driven JSON would require ops to keep two systems in sync
// When pricing volatility hits (or we add a 3rd+ model), promote to a
// DB table or env JSON.

export interface ModelPricing {
  /** USD per 1M input tokens */
  inputPerM: number;
  /** USD per 1M output tokens (0 for embedding models) */
  outputPerM: number;
}

export const LLM_PRICING: Record<string, ModelPricing> = {
  // Summarize default — DeepSeek V3.2 via OpenRouter (2026-05 list price)
  'deepseek/deepseek-v3.2': { inputPerM: 0.27, outputPerM: 1.1 },
  // Embed default — OpenAI text-embedding-3-small (2026-05 list price)
  'openai/text-embedding-3-small': { inputPerM: 0.02, outputPerM: 0 },
  // Common alternates we sometimes test against; harmless to leave priced
  'openai/gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.6 },
  'openai/gpt-5-nano': { inputPerM: 0.15, outputPerM: 0.6 },
  'anthropic/claude-3.5-haiku': { inputPerM: 0.8, outputPerM: 4.0 },
};

/**
 * Compute cost in USD for one LLM call.
 * Returns null when the model isn't priced — caller persists null too,
 * which the admin UI surfaces as "(unpriced)" rather than zero.
 */
export function computeCostUsd(
  model: string,
  tokensIn: number,
  tokensOut: number,
): number | null {
  const price = LLM_PRICING[model];
  if (!price) return null;
  const inCost = (tokensIn / 1_000_000) * price.inputPerM;
  const outCost = (tokensOut / 1_000_000) * price.outputPerM;
  // Round to 6 decimals (matches DECIMAL(10,6) column scale).
  return Math.round((inCost + outCost) * 1_000_000) / 1_000_000;
}
