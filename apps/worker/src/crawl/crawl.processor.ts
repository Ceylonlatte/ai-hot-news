import { Logger } from '@nestjs/common';
import { getPrisma, SourceStatus } from '@ai-hot-news/db';
import type { CrawlerFactory } from './crawler.factory';
import type { IngestionService } from './ingestion.service';

const logger = new Logger('CrawlProcessor');

export interface CrawlJobData {
  sourceConfigId: string;
}

export async function processCrawlJob(
  data: CrawlJobData,
  ingestion: IngestionService,
  factory: CrawlerFactory,
): Promise<void> {
  const prisma = getPrisma();
  const source = await prisma.sourceConfig.findUnique({ where: { id: data.sourceConfigId } });
  if (!source) {
    logger.warn(`SourceConfig ${data.sourceConfigId} not found, skipping`);
    return;
  }
  if (!source.enabled) {
    logger.debug(`SourceConfig ${source.id} disabled, skipping`);
    return;
  }

  let crawler;
  try {
    crawler = factory.create({
      id: source.id,
      platform: source.platform,
      url: source.url,
      identifier: source.identifier,
    });
  } catch (err) {
    logger.error(`Unsupported platform: ${(err as Error).message}`);
    await prisma.sourceConfig.update({
      where: { id: source.id },
      data: {
        status: SourceStatus.FAILED,
        errorMessage: (err as Error).message.slice(0, 500),
      },
    });
    return;
  }

  try {
    const items = await crawler.fetch();
    const result = await ingestion.ingest(items, {
      id: source.id,
      platform: source.platform,
      url: source.url,
      identifier: source.identifier,
      name: source.name,
    });
    logger.log(
      `${source.platform} crawled: source=${source.name} ` +
        `fetched=${result.fetched} inserted=${result.inserted} ` +
        `skipped=${result.skipped} hidden=${result.hidden} failed=${result.failed}`,
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
    logger.error(`${source.platform} crawl failed: source=${source.name} error=${msg}`);
    await prisma.sourceConfig.update({
      where: { id: source.id },
      data: {
        status: SourceStatus.FAILED,
        errorMessage: msg.slice(0, 500),
      },
    });
    throw err;
  }
}
