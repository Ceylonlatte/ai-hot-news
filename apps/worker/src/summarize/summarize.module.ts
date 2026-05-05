import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { SUMMARY_QUEUE, summaryQueueProvider } from './summarize.queue';

/**
 * SP-4.7 阶段：仅暴露 SUMMARY_QUEUE token，让 ExtractModule 能注入并把 hotNewsId 推入 summary 队列。
 * SP-5 ship 时会扩展本 module，加 SUMMARY_WORKER + SummarizeService + Strategy +
 * OnApplicationBootstrap (boot backstop 扫 summary IS NULL 入队)。
 */
@Module({
  imports: [RedisModule],
  providers: [summaryQueueProvider],
  exports: [SUMMARY_QUEUE],
})
export class SummarizeModule {}
