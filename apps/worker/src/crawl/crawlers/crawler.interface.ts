import { RawCrawledItem } from '@ai-hot-news/types';

export interface Crawler {
  fetch(): Promise<RawCrawledItem[]>;
}

export const CRAWLER_FACTORY = Symbol('CRAWLER_FACTORY');
