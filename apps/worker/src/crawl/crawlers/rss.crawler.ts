import Parser from 'rss-parser';
import { RawCrawledItem } from '@ai-hot-news/types';
import { Crawler } from './crawler.interface';

interface CustomItem {
  contentEncoded?: string;
  dcCreator?: string;
}

interface SourceLike {
  id: string;
  url: string | null;
}

export class RssCrawler implements Crawler {
  private readonly parser: Parser<unknown, CustomItem>;

  constructor(private readonly source: SourceLike) {
    this.parser = new Parser<unknown, CustomItem>({
      timeout: parseInt(process.env.RSS_FETCH_TIMEOUT_MS ?? '15000', 10),
      headers: {
        'User-Agent': process.env.RSS_USER_AGENT ?? 'ai-hot-news-bot/0.1',
      },
      customFields: {
        item: [
          ['content:encoded', 'contentEncoded'],
          ['dc:creator', 'dcCreator'],
        ],
      },
    });
  }

  async fetch(): Promise<RawCrawledItem[]> {
    if (!this.source.url) {
      throw new Error(`SourceConfig ${this.source.id} missing url`);
    }
    const feed = await this.parser.parseURL(this.source.url);
    return feed.items.map((it) => this.toRaw(it));
  }

  private toRaw(item: Parser.Item & CustomItem): RawCrawledItem {
    const rawHtml = item.contentEncoded ?? null;
    const title = (item.title ?? '').trim() || '(untitled)';
    return {
      title,
      contentText: stripHtml(rawHtml ?? item.contentSnippet ?? ''),
      rawHtml,
      sourceUrl: item.link ?? '',
      author: item.dcCreator ?? item.creator ?? null,
      publishedAt: item.isoDate ? new Date(item.isoDate) : null,
    };
  }
}

function stripHtml(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
