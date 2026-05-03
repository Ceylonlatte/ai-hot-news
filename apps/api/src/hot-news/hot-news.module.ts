import { Module } from '@nestjs/common';
import { HotNewsController } from './hot-news.controller';
import { HotNewsService } from './hot-news.service';

@Module({
  controllers: [HotNewsController],
  providers: [HotNewsService],
})
export class HotNewsModule {}
