export interface EmbedResult {
  vector: number[];
  tokensIn: number;
  durationMs: number;
}

/**
 * Call OpenAI `/v1/embeddings` for a single text input.
 *
 * Uses OpenAI directly (NOT OpenRouter — OpenRouter does not expose the
 * embeddings interface). Distinct from `llm-client.ts` which talks to
 * OpenRouter for summary generation.
 */
export async function callEmbed(text: string): Promise<EmbedResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  const model = process.env.EMBED_MODEL ?? 'text-embedding-3-small';

  const start = Date.now();
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '<no body>');
    throw new Error(
      `OpenAI embeddings ${res.status}: ${errText.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as {
    data: Array<{ embedding: number[] }>;
    usage: { prompt_tokens: number };
  };
  const vector = json.data[0]?.embedding;
  if (!vector || vector.length !== 1536) {
    throw new Error(
      `OpenAI embeddings returned invalid vector (len=${vector?.length ?? 'undef'})`,
    );
  }
  return {
    vector,
    tokensIn: json.usage.prompt_tokens,
    durationMs: Date.now() - start,
  };
}
