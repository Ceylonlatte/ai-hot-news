export interface ExtractedArticle {
  contentText: string;
  rawHtml: string | null;
  /**
   * 三方可能返回更准确的标题；SP-4.7 不强制覆盖 HotNews.title。
   * 仅作日志 / 调试观察用，extract.service 不消费。
   */
  title?: string | null;
}

export interface ExtractProvider {
  readonly name: 'firecrawl' | 'jina';
  extract(url: string, signal: AbortSignal): Promise<ExtractedArticle>;
}

/**
 * 三类错误用于 chain.ts 的不同 fallback 决策：
 *  - QuotaExceededError    → fallback 到下一 provider
 *  - TransientFetchError   → fallback；都失败时让 BullMQ retry
 *  - PermanentFetchError   → 立即终止整个 chain（4xx 不会变成 200）
 */
export class QuotaExceededError extends Error {
  constructor(public provider: 'firecrawl' | 'jina') {
    super(`${provider} quota / rate exceeded`);
    this.name = 'QuotaExceededError';
  }
}

export class TransientFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientFetchError';
  }
}

export class PermanentFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentFetchError';
  }
}
