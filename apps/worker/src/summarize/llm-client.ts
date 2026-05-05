import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

export interface LlmCallResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export async function callLlm(
  systemPrompt: string,
  userPrompt: string,
): Promise<LlmCallResult> {
  const baseURL = process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');

  const provider = createOpenAI({ baseURL, apiKey });
  const modelId = process.env.SUMMARY_MODEL ?? 'deepseek/deepseek-v3.2';

  const start = Date.now();
  const { text, usage } = await generateText({
    model: provider(modelId),
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.2,
    maxTokens: 500,
    abortSignal: AbortSignal.timeout(30_000),
  });

  return {
    text,
    tokensIn: usage?.promptTokens ?? 0,
    tokensOut: usage?.completionTokens ?? 0,
    durationMs: Date.now() - start,
  };
}
