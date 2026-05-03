import { Inject, Injectable } from '@nestjs/common';
import { Platform } from '@ai-hot-news/db';
import type { Crawler } from './crawlers/crawler.interface';
import { RssCrawler } from './crawlers/rss.crawler';
import { HackerNewsCrawler } from './crawlers/hackernews.crawler';
import { RedditCrawler } from './crawlers/reddit.crawler';
import { REDDIT_USER_AGENT } from './crawlers/reddit.types';

export interface CrawlerSource {
  id: string;
  platform: Platform;
  url: string | null;
  identifier: string | null;
}

@Injectable()
export class CrawlerFactory {
  constructor(
    @Inject(REDDIT_USER_AGENT) private readonly redditUserAgent: string,
  ) {}

  create(source: CrawlerSource): Crawler {
    switch (source.platform) {
      case Platform.RSS:
        return new RssCrawler({ id: source.id, url: source.url });
      case Platform.HACKERNEWS:
        return new HackerNewsCrawler({ id: source.id, identifier: source.identifier });
      case Platform.REDDIT:
        return new RedditCrawler(
          { id: source.id, url: source.url, identifier: source.identifier },
          this.redditUserAgent,
        );
      default:
        throw new Error(`Unsupported crawler platform: ${source.platform}`);
    }
  }
}
