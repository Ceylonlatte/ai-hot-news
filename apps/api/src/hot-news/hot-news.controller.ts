import {
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import type {
  HeatHistoryDto,
  HotNewsDetailDto,
  HotNewsListResponseDto,
} from '@ai-hot-news/types';
import { HotNewsService } from './hot-news.service';
import { ListHotNewsQuery } from './dto/list-hot-news.query';

const ALLOWED_HOURS = [24, 48, 72] as const;
type AllowedHours = (typeof ALLOWED_HOURS)[number];

function clampHours(raw: number): AllowedHours {
  return (ALLOWED_HOURS as readonly number[]).includes(raw)
    ? (raw as AllowedHours)
    : 48;
}

@Controller('hot-news')
export class HotNewsController {
  constructor(private readonly service: HotNewsService) {}

  @Get()
  list(@Query() query: ListHotNewsQuery): Promise<HotNewsListResponseDto> {
    return this.service.list(
      query.page,
      query.pageSize,
      query.platforms,
      query.sort,
      query.groupMode ?? 'fold',
    );
  }

  // SP-11: detail page payload. NotFoundException becomes a 404 with the
  // standard Nest body shape; the Web RSC catches that and calls notFound().
  @Get(':id')
  async detail(@Param('id') id: string): Promise<HotNewsDetailDto> {
    const row = await this.service.detail(id);
    if (!row) throw new NotFoundException();
    return row;
  }

  // SP-11: 30-min heat snapshot series. `hours` defaults to 48 and gets
  // clamped to 24 | 48 | 72; invalid integers (or any other value Nest's
  // pipe-derived `hoursRaw` rejects as NaN) fall back to 48 inside
  // `clampHours`, so this endpoint never 400s on a numeric query.
  @Get(':id/heat-history')
  heatHistory(
    @Param('id') id: string,
    @Query('hours', new DefaultValuePipe(48), ParseIntPipe) hoursRaw: number,
  ): Promise<HeatHistoryDto> {
    return this.service.heatHistory(id, clampHours(hoursRaw));
  }
}
