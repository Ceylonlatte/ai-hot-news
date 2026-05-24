import { Global, Module } from '@nestjs/common';
import { LlmUsageService } from './llm-usage.service';

/**
 * SP-19 PR-A (2026-05-24): @Global so SummarizeService / EmbedService
 * (different feature modules) can `@Inject(LlmUsageService)` without
 * having to re-import LlmUsageModule everywhere. There's only one
 * recorder; sharing it via DI keeps a single Logger instance + a single
 * point of injection for future Prometheus / OTel metrics export.
 */
@Global()
@Module({
  providers: [LlmUsageService],
  exports: [LlmUsageService],
})
export class LlmUsageModule {}
