import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const ALLOWED_PLATFORMS = ['RSS', 'HACKERNEWS', 'REDDIT'] as const;
type AllowedPlatform = (typeof ALLOWED_PLATFORMS)[number];

const ALLOWED_SORTS = ['time', 'heat'] as const;
type AllowedSort = (typeof ALLOWED_SORTS)[number];

/** SP-7-D (2026-05-16): how to handle rows that share a `groupId`.
 *  - `fold`: collapse same-group rows into a single representative entry
 *    on the list, with `groupMembers[]` populated for client-side disclosure.
 *  - `expand`: legacy behavior — every row gets its own list entry,
 *    `groupMembers` is empty. Useful for debugging and for clients that
 *    want to render their own grouping UI. */
const ALLOWED_GROUP_MODES = ['fold', 'expand'] as const;
type AllowedGroupMode = (typeof ALLOWED_GROUP_MODES)[number];

/** SP-10 (2026-05-21): user-controllable time window for the feed.
 *  Explicitly overrides PLATFORM_WINDOW_HOURS in the service when set —
 *  e.g. ?range=7d on community tab forces 7d window even though
 *  HN/Reddit platform default is 48h. Sub-day granularity (1h/6h) was
 *  intentionally skipped (data sparse; HN/Reddit 1h often empty).
 *  Upper bound = 30d, aligned with SP-10.5 hot_news TTL — "what users
 *  see = what DB stores". */
const ALLOWED_RANGES = ['1d', '7d', '30d'] as const;
type AllowedRange = (typeof ALLOWED_RANGES)[number];

export const RANGE_HOURS_MAP: Record<AllowedRange, number> = {
  '1d': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

export type { AllowedRange };

export class ListHotNewsQuery {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize: number = 20;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value == null) return undefined;
    if (typeof value !== 'string') return value;
    return value
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
  })
  @IsArray()
  @IsIn(ALLOWED_PLATFORMS, { each: true })
  platforms?: AllowedPlatform[];

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsIn(ALLOWED_SORTS)
  sort?: AllowedSort;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsIn(ALLOWED_GROUP_MODES)
  groupMode?: AllowedGroupMode;

  /** SP-10: user-explicit time window. When set, overrides PLATFORM_WINDOW_HOURS
   *  in the service. When omitted, service falls back to per-platform defaults
   *  (HN/Reddit 48h, RSS 7d) — keeps all pre-SP-10 clients (SP-9 dashboard,
   *  SP-11 detail page) behavior-identical.
   *
   *  URL form: `?range=1d|7d|30d`. Sub-day not supported by design (see
   *  ALLOWED_RANGES doc). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsIn(ALLOWED_RANGES)
  range?: AllowedRange;

  /** SP-10: AI tag filter. URL form: `?tags=category:OpenSource,company:OpenAI`.
   *  Multi-tag AND semantics applied in service via Prisma `aiTags: { hasEvery }`.
   *  Service does NOT validate tag content against TAXONOMY — drift-tolerant by
   *  design (e.g. ?tags=category:NotARealCat returns 0 rows, not 400). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value == null) return undefined;
    if (typeof value !== 'string') return value;
    const parsed = value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return parsed.length > 0 ? parsed : undefined;
  })
  @IsArray()
  tags?: string[];

  /** SP-12: pg_trgm trigram search overlay. When set, service adds
   *  `WHERE <search_expr> % $q` + `ORDER BY similarity(search_expr, $q) DESC`
   *  on top of the existing platform / range / tags filters. Trim happens
   *  in the @Transform; max length 200 is a defensive cap (trigram for
   *  queries beyond that returns noise). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  q?: string;
}
