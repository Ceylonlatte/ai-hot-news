import { Controller, DefaultValuePipe, Get, Query } from '@nestjs/common';
import { StatsService } from './stats.service';
import type {
  HeatCurveDto,
  StatsSourcesDto,
  StatsTodayDto,
  TrendingKeywordsDto,
} from '@ai-hot-news/types';

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

  /**
   * GET /stats/heat-curve
   * SP-9 (2026-05-19): 24 hourly buckets of MAX(heatScore), oldest-first.
   * RSS excluded (SP-6 §0 Q1/Q2 contract). `buckets[23]` is the current
   * partial hour.
   */
  @Get('heat-curve')
  heatCurve(): Promise<HeatCurveDto> {
    return this.service.getHeatCurve();
  }

  /**
   * GET /stats/trending-keywords?limit=N
   * SP-9 (2026-05-19): aiTag momentum ranking via 24h-vs-prior-24h delta.
   * Default `limit=8`, clamped to `[1, 20]` by the service layer.
   *
   * We use `DefaultValuePipe` with a string default so the param shows up
   * as a string when present and as the default '8' when absent; the
   * service does `parseInt` and clamps. This avoids `ParseIntPipe`'s
   * `BadRequestException` when the param is omitted entirely.
   */
  @Get('trending-keywords')
  trendingKeywords(
    @Query('limit', new DefaultValuePipe('8')) limit: string,
  ): Promise<TrendingKeywordsDto> {
    return this.service.getTrendingKeywords(parseInt(limit, 10));
  }
}
