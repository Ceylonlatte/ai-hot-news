import pLimit from 'p-limit';
import { stripHtml } from '@ai-hot-news/utils';
import type { RawCrawledItem } from '@ai-hot-news/types';
import type { Crawler } from './crawler.interface';
import type { HnStory } from './hackernews.types';

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';
const TOPIC_ENDPOINT = {
  top: 'topstories',
  ask: 'askstories',
  show: 'showstories',
} as const;

export type HnTopic = keyof typeof TOPIC_ENDPOINT;

interface HnSource {
  id: string;
  identifier: string | null;
}

export class HackerNewsCrawler implements Crawler {
  constructor(private readonly source: HnSource) {}

  async fetch(): Promise<RawCrawledItem[]> {
    const topic = this.source.identifier as HnTopic | null;
    if (!topic || !(topic in TOPIC_ENDPOINT)) {
      throw new Error(
        `HN SourceConfig ${this.source.id} invalid identifier=${topic}; ` +
          `expected one of: ${Object.keys(TOPIC_ENDPOINT).join(', ')}`,
      );
    }
    const ids = await this.fetchIds(topic);
    const limit = pLimit(this.concurrency());
    const stories = await Promise.all(ids.map((id) => limit(() => this.fetchStory(id))));
    return stories.filter(this.isValidStory).map((s) => this.toRaw(s));
  }

  private async fetchIds(topic: HnTopic): Promise<number[]> {
    const url = `${HN_BASE}/${TOPIC_ENDPOINT[topic]}.json`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(this.timeoutMs()),
      headers: { 'User-Agent': this.userAgent() },
    });
    if (!res.ok) {
      throw new Error(`HN ids fetch ${res.status} ${res.statusText} for ${topic}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error(
        `HN ids response not array for ${topic}: ${JSON.stringify(data).slice(0, 100)}`,
      );
    }
    return data as number[];
  }

  private timeoutMs(): number {
    const raw = parseInt(process.env.HN_FETCH_TIMEOUT_MS ?? '15000', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 15000;
  }

  private userAgent(): string {
    return process.env.RSS_USER_AGENT ?? 'ai-hot-news-bot/0.1';
  }

  private async fetchStory(id: number): Promise<HnStory | null> {
    try {
      const res = await fetch(`${HN_BASE}/item/${id}.json`, {
        signal: AbortSignal.timeout(this.timeoutMs()),
        headers: { 'User-Agent': this.userAgent() },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as HnStory | null;
      return data;
    } catch {
      return null;
    }
  }

  private isValidStory = (s: HnStory | null): s is HnStory => {
    if (!s) return false;
    if (s.type !== 'story') return false;
    if (s.deleted || s.dead) return false;
    if (!s.title) return false;
    return true;
  };

  private toRaw(s: HnStory): RawCrawledItem {
    const isSelfPost = !s.url && !!s.text;
    const title = s.title ?? '(untitled)';
    return {
      title,
      contentText: isSelfPost ? stripHtml(s.text!) : title,
      rawHtml: isSelfPost ? s.text! : null,
      sourceUrl: `https://news.ycombinator.com/item?id=${s.id}`,
      author: s.by ?? null,
      publishedAt: s.time ? new Date(s.time * 1000) : null,
      interactionData: {
        score: s.score ?? 0,
        comments: s.descendants ?? 0,
        externalUrl: s.url ?? null,
        hnId: s.id,
      },
    };
  }

  private concurrency(): number {
    const raw = parseInt(process.env.HN_CONCURRENCY ?? '10', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 10;
  }
}
