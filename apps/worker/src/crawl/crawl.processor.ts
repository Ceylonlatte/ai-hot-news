import { Logger } from '@nestjs/common';
import { getPrisma, SourceStatus } from '@ai-hot-news/db';
import { RssCrawler } from './crawlers/rss.crawler';
import { IngestionService } from './ingestion.service';

const logger = new Logger('CrawlProcessor');

export interface CrawlJobData {
  sourceConfigId: string;
}

export async function processCrawlJob(
  data: CrawlJobData,
  ingestion: IngestionService,
): Promise<void> {
  const prisma = getPrisma();
  const source = await prisma.sourceConfig.findUnique({ where: { id: data.sourceConfigId } });
  if (!source) {
    logger.warn(`SourceConfig ${data.sourceConfigId} not found, skipping`);
    return;
  }
  if (source.platform !== 'RSS') {
    logger.warn(`SourceConfig ${source.id} not RSS (platform=${source.platform}), skipping`);
    return;
  }

  const crawler = new RssCrawler({ id: source.id, url: source.url });
  try {
    const items = await crawler.fetch();
    const result = await ingestion.ingest(items, {
      id: source.id,
      platform: 'RSS',
      url: source.url,
      name: source.name,
    });
    logger.log(
      `RSS fetched: source=${source.name} fetched=${result.fetched} inserted=${result.inserted} skipped=${result.skipped} failed=${result.failed}`,
    );
    await prisma.sourceConfig.update({
      where: { id: source.id },
      data: {
        lastCrawledAt: new Date(),
        status: SourceStatus.NORMAL,
        errorMessage: null,
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    logger.error(`RSS crawl failed: source=${source.name} error=${msg}`);
    await prisma.sourceConfig.update({
      where: { id: source.id },
      data: {
        status: SourceStatus.FAILED,
        errorMessage: msg.slice(0, 500),
      },
    });
    throw err; // BullMQ will retry per attempts/backoff
  }
}
