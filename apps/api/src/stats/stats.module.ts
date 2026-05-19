import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

/**
 * SP-9 (2026-05-19): Dashboard stats endpoints under `/stats/*`. Sibling
 * to HotNewsModule (single-responsibility). No DB schema changes; reuses
 * SP-5 aiTags + SP-6 heatScore/heatLevel via raw SQL aggregates against
 * the `hot_news` table.
 */
@Module({
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
