import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  KeywordHitsResponseDto,
  KeywordListResponseDto,
  KeywordMonitorDto,
} from '@ai-hot-news/types';
import { KeywordsService } from './keywords.service';
import { CreateKeywordDto } from './dto/create-keyword.dto';
import { UpdateKeywordDto } from './dto/update-keyword.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * SP-14 (2026-05-23): GET/POST/PATCH/DELETE /keywords.
 *
 * All endpoints @UseGuards(JwtAuthGuard) — unauthenticated → 401.
 * Service ignores the JWT.user payload for V1 (single-user, hardcoded
 * ADMIN_USER_ID). Multi-user SP-X swaps to req.user.userId.
 *
 * Status codes:
 *   POST /keywords          → 201 + body | 400 (validation) | 409 (dup) | 401
 *   GET  /keywords          → 200 { items, total } | 401
 *   GET  /keywords/:id      → 200 body | 404 | 401
 *   PATCH /keywords/:id     → 200 body | 400 | 404 | 409 | 401
 *   DELETE /keywords/:id    → 200 { deleted: true } | 404 | 401
 *
 * DELETE returns 200 not 204 so the body conveys idempotency + the
 * front-end fetch can `.json()` without choking on no-body.
 */
@Controller('keywords')
@UseGuards(JwtAuthGuard)
export class KeywordsController {
  constructor(private readonly service: KeywordsService) {}

  @Get()
  list(): Promise<KeywordListResponseDto> {
    return this.service.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<KeywordMonitorDto> {
    return this.service.get(id);
  }

  /**
   * SP-15 PR-B (2026-05-23): GET /keywords/:id/hits?limit=20&offset=0
   *
   * Returns paginated KeywordHit rows joined with HotNews for one
   * keyword, newest hit first. Limits clamped to [1, 100] to protect
   * the response payload; defaults match typical first-page UX.
   */
  @Get(':id/hits')
  async hits(
    @Param('id') id: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ): Promise<KeywordHitsResponseDto> {
    const limit = parseClamp(limitRaw, 20, 1, 100, 'limit');
    const offset = parseClamp(offsetRaw, 0, 0, Number.MAX_SAFE_INTEGER, 'offset');
    return this.service.hits(id, limit, offset);
  }

  @Post()
  create(@Body() dto: CreateKeywordDto): Promise<KeywordMonitorDto> {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateKeywordDto,
  ): Promise<KeywordMonitorDto> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(
    @Param('id') id: string,
  ): Promise<{ deleted: true; cleanedKeyword: string }> {
    return this.service.remove(id);
  }
}

function parseClamp(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  fieldName: string,
): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new BadRequestException(`${fieldName} must be a finite number`);
  }
  const floored = Math.floor(n);
  if (floored < min) {
    throw new BadRequestException(`${fieldName} must be >= ${min}`);
  }
  if (floored > max) return max;
  return floored;
}
