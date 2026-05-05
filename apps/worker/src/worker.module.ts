import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { LivenessService } from './liveness.service';
import { CrawlModule } from './crawl/crawl.module';
import { ExtractModule } from './extract/extract.module';
import { SummarizeModule } from './summarize/summarize.module';

// Worker reads the monorepo root .env (DATABASE_URL, REDIS_URL, ...) — its own
// apps/worker/.env only carries worker-specific knobs. Pass an explicit array
// so ConfigModule searches both: project root first, then app-local override.
// __dirname at runtime is apps/worker/dist, so root is three levels up.
const ROOT_ENV = join(__dirname, '..', '..', '..', '.env');
const APP_ENV = join(__dirname, '..', '.env');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [APP_ENV, ROOT_ENV] }),
    SummarizeModule,
    ExtractModule,
    CrawlModule,
  ],
  providers: [LivenessService],
})
export class WorkerModule {}
