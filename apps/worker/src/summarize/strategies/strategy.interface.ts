export type StrategyVerdict = 'allow' | `skip:${string}`;

export interface StrategyRowInput {
  id: string;
  sourcePlatform: 'TWITTER' | 'RSS' | 'HACKERNEWS' | 'REDDIT';
  publishedAt: Date;
  status: 'VISIBLE' | 'HIDDEN' | 'PENDING';
  interactionData: Record<string, unknown> | null;
  heatScore: number;
}

export interface SummarizationStrategy {
  /**
   * 根据 row 元数据决定是否调 LLM。
   * 'allow' → 走 LLM；'skip:<reason>' → 跳过（不算失败、不入计数器）。
   */
  shouldSummarize(row: StrategyRowInput): StrategyVerdict;
}
