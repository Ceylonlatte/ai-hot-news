import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { LivenessService } from './liveness.service';
import { CrawlModule } from './crawl/crawl.module';
import { ExtractModule } from './extract/extract.module';
import { SummarizeModule } from './summarize/summarize.module';
import { EmbedModule } from './embed/embed.module';
import { HeatModule } from './heat/heat.module';
import { CleanupModule } from './cleanup/cleanup.module';
import { KeywordMatchModule } from './keywords/keyword-match.module';
import { KeywordSearchModule } from './keyword-search/keyword-search.module';
import { LlmUsageModule } from './llm-usage/llm-usage.module';

// Worker reads the monorepo root .env (DATABASE_URL, REDIS_URL, ...) — its own
// apps/worker/.env only carries worker-specific knobs. Pass an explicit array
// so ConfigModule searches both: project root first, then app-local override.
// __dirname at runtime is apps/worker/dist, so root is three levels up.
const ROOT_ENV = join(__dirname, '..', '..', '..', '.env');
const APP_ENV = join(__dirname, '..', '.env');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [APP_ENV, ROOT_ENV] }),
    // SP-19 PR-A: @Global LlmUsageModule must register before any feature
    // module that injects LlmUsageService — keep it first so DI resolves it.
    LlmUsageModule,
    SummarizeModule,
    ExtractModule,
    EmbedModule,
    HeatModule,
    CleanupModule,
    KeywordMatchModule,
    KeywordSearchModule,
    CrawlModule,
  ],
  providers: [LivenessService],
})
export class WorkerModule {}
