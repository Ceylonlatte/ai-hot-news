import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { HotNewsModule } from './hot-news/hot-news.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), HealthModule, HotNewsModule],
})
export class AppModule {}
