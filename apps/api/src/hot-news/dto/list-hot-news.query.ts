import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

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
}
