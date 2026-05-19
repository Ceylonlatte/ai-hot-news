import { Controller, Get } from '@nestjs/common';
import { StatsService } from './stats.service';
import type { StatsSourcesDto, StatsTodayDto } from '@ai-hot-news/types';

@Controller('stats')
export class StatsController {
  constructor(private readonly service: StatsService) {}

  /**
   * GET /stats/today
   * SP-9 (2026-05-19): 4-card dashboard stats for the HomePage. SSR-friendly;
   * Web layer fetches with `cache: 'no-store'` per spec §0 Q8.
   */
  @Get('today')
  today(): Promise<StatsTodayDto> {
    return this.service.getToday();
  }

  /**
   * GET /stats/sources
   * SP-9 (2026-05-19): 24h per-platform distribution. Hare-quota pct
   * rounding guarantees sum === 100 (when total > 0).
   */
  @Get('sources')
  sources(): Promise<StatsSourcesDto> {
    return this.service.getSources();
  }
}
