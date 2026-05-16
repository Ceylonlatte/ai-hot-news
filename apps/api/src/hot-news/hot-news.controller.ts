import { Controller, Get, Query } from '@nestjs/common';
import { HotNewsService } from './hot-news.service';
import { ListHotNewsQuery } from './dto/list-hot-news.query';
import type { HotNewsListResponseDto } from './dto/hot-news-list.response';

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
}
