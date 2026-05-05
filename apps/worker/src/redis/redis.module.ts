import { Module } from '@nestjs/common';
import { REDIS_CONNECTION, redisProvider } from '../crawl/queue.provider';

/**
 * Shared single IORedis connection. SP-4 had only `crawl` queue so the connection
 * lived in CrawlModule. SP-4.7 added `extract` + `summary` queues that also need
 * REDIS_CONNECTION; pulling it into a tiny module avoids the obvious
 * UnknownDependenciesException at boot and keeps a single shared connection
 * (Nest deduplicates providers from imported modules within the same DI tree).
 */
@Module({
  providers: [redisProvider],
  exports: [REDIS_CONNECTION],
})
export class RedisModule {}
