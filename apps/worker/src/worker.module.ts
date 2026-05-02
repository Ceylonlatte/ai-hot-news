import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LivenessService } from './liveness.service';
import { CrawlModule } from './crawl/crawl.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), CrawlModule],
  providers: [LivenessService],
})
export class WorkerModule {}
