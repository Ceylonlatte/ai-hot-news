export interface EmbedResult {
  vector: number[];
  tokensIn: number;
  durationMs: number;
  /** SP-19 PR-A: which model served — surfaced for LlmUsageService cost
   *  recording. Mirrors `EMBED_MODEL` env at call time. */
  model: string;
}

/** Default embedding dimension. Matches `HotNews.embedding vector(N)` in
 *  schema.prisma. SP-7-A v3 bumped this from 1536 (OpenAI v3-small) to
 *  2048 (NVIDIA Nemotron VL-1B). Override with `EMBED_DIM` env if you
 *  swap models again; the spec/plan doc has the canonical model→dim table. */
export const EMBED_DIM_DEFAULT = 2048;

/**
 * Call OpenRouter `/api/v1/embeddings` for a single text input.
 *
 * SP-7-A v3 (2026-05-15): provider stays at OpenRouter (one key shared with
 * SP-5 summary) but the model switched from `openai/text-embedding-3-small`
 * to `nvidia/llama-nemotron-embed-vl-1b-v2:free`.
 *
 * Background: v2 (also OpenRouter) routed `openai/text-embedding-3-small`
 * — that endpoint returns HTTP 403 "violation of provider Terms of Service"
 * because OpenRouter ToS blocks OpenAI's and Google's embedding models
 * (chat/completions work; embeddings don't). Verified 2026-05-15 in prod
 * with a real `curl` against `openai/{text-embedding-3-small,large,ada-002}`
 * and `google/gemini-embedding-2-preview` — all 403. Six non-OpenAI/Google
 * candidates returned vectors; Nemotron VL-1B-free had the best cosine
 * signal-to-noise on a 9-sample matrix (gap 0.489 vs BGE-M3 0.343) and is
 * free, so it wins.
 *
 * Trade-offs accepted:
 * - Vision-language model used for text-only — the spec author's intent was
 *   multimodal, but text-only behaviour was empirically excellent.
 * - Free tier: OpenRouter free models cap at roughly $1/day worth of
 *   requests. Our ~165 rows/day × ~80 tokens is well under any reasonable
 *   limit, but if we start hitting 429 we fall back to BGE-M3 ($0.01/M).
 *
 * Response shape stays OpenAI-compatible (`data[0].embedding` +
 * `usage.prompt_tokens`), so downstream parsing is unchanged.
 */
export async function callEmbed(text: string): Promise<EmbedResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');
  const model =
    process.env.EMBED_MODEL ?? 'nvidia/llama-nemotron-embed-vl-1b-v2:free';
  const expectedDim = Number(process.env.EMBED_DIM ?? EMBED_DIM_DEFAULT);

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
  if (!vector || vector.length !== expectedDim) {
    throw new Error(
      `OpenRouter embeddings returned invalid vector (len=${vector?.length ?? 'undef'}, expected ${expectedDim})`,
    );
  }
  return {
    vector,
    tokensIn: json.usage.prompt_tokens,
    durationMs: Date.now() - start,
    model,
  };
}
