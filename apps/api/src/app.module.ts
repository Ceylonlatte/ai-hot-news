import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { HealthModule } from './health/health.module';
import { HotNewsModule } from './hot-news/hot-news.module';
import { StatsModule } from './stats/stats.module';
import { AuthModule } from './auth/auth.module';
import { KeywordsModule } from './keywords/keywords.module';
import { AdminModule } from './admin/admin.module';

// API reads the monorepo root .env (DATABASE_URL, REDIS_URL, ...). In dev the
// process is spawned with cwd=apps/api by turbo, so the default ConfigModule
// behavior of reading ./env wouldn't find DATABASE_URL. __dirname at runtime
// is apps/api/dist, so root is three levels up. App-local .env (if any) wins
// over root.
const ROOT_ENV = join(__dirname, '..', '..', '..', '.env');
const APP_ENV = join(__dirname, '..', '.env');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [APP_ENV, ROOT_ENV] }),
    AuthModule,
    HealthModule,
    HotNewsModule,
    StatsModule,
    KeywordsModule,
    AdminModule,
  ],
})
export class AppModule {}
