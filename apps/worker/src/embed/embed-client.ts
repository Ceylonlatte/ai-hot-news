export interface EmbedResult {
  vector: number[];
  tokensIn: number;
  durationMs: number;
}

/**
 * Call OpenRouter `/api/v1/embeddings` for a single text input.
 *
 * SP-7-A v2 (2026-05-15) switched provider from OpenAI direct → OpenRouter:
 * OpenRouter exposes a 100% OpenAI-compatible embeddings endpoint that
 * forwards to the OpenAI provider with no markup ($0.020 / 1M tokens, same
 * as direct), and we reuse the same `OPENROUTER_API_KEY` already used by
 * SP-5 summary. Model id gains the `openai/` prefix per OpenRouter routing
 * convention. Response shape is identical to OpenAI's
 * (`data[0].embedding` + `usage.prompt_tokens`), so callers see no diff.
 *
 * App attribution headers (HTTP-Referer / X-OpenRouter-Title) are optional
 * but help with OpenRouter's leaderboard / rate-limit fairness.
 */
export async function callEmbed(text: string): Promise<EmbedResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');
  const model = process.env.EMBED_MODEL ?? 'openai/text-embedding-3-small';

  const start = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/Ceylonlatte/ai-hot-news',
      'X-OpenRouter-Title': 'ai-hot-news',
    },
    body: JSON.stringify({ model, input: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '<no body>');
    throw new Error(
      `OpenRouter embeddings ${res.status}: ${errText.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as {
    data: Array<{ embedding: number[] }>;
    usage: { prompt_tokens: number };
  };
  const vector = json.data[0]?.embedding;
  if (!vector || vector.length !== 1536) {
    throw new Error(
      `OpenRouter embeddings returned invalid vector (len=${vector?.length ?? 'undef'})`,
    );
  }
  return {
    vector,
    tokensIn: json.usage.prompt_tokens,
    durationMs: Date.now() - start,
  };
}
