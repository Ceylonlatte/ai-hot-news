import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ALLOWED_CHANNELS,
  ALLOWED_FREQUENCIES,
  ALLOWED_PLATFORMS,
  EXCLUDE_WORDS_MAX_COUNT,
  EXCLUDE_WORD_MAX_LENGTH,
  KEYWORD_MAX_LENGTH,
  SYNONYMS_MAX_COUNT,
  SYNONYM_MAX_LENGTH,
  type AllowedChannel,
  type AllowedFrequency,
  type AllowedPlatform,
} from './keyword-rules';

/**
 * SP-14 (2026-05-23): nested validator for triggerRules JSONB.
 * All fields optional; service treats undefined / empty object as null
 * (meaning "trigger on any hit"). Numeric caps are defensive against
 * accidentally negative or astronomically large thresholds.
 */
export class TriggerRulesDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  minCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  minHeatScore?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000)
  growthRatePct?: number;
}

/**
 * SP-14: POST /keywords body.
 *
 * keyword trimmed (whitespace-only rejected via MinLength(1) after trim).
 * synonyms / excludeWords trimmed + empty-filtered + de-duplicated case-
 * insensitively in the service (DTO just enforces shape + max counts).
 */
export class CreateKeywordDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(KEYWORD_MAX_LENGTH)
  keyword!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SYNONYMS_MAX_COUNT)
  @IsString({ each: true })
  @MaxLength(SYNONYM_MAX_LENGTH, { each: true })
  synonyms?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(EXCLUDE_WORDS_MAX_COUNT)
  @IsString({ each: true })
  @MaxLength(EXCLUDE_WORD_MAX_LENGTH, { each: true })
  excludeWords?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ALLOWED_PLATFORMS.length)
  @IsIn(ALLOWED_PLATFORMS, { each: true })
  platforms?: AllowedPlatform[];

  @IsOptional()
  @IsIn(ALLOWED_FREQUENCIES)
  monitorFrequency?: AllowedFrequency;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => TriggerRulesDto)
  triggerRules?: TriggerRulesDto | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ALLOWED_CHANNELS.length)
  @IsIn(ALLOWED_CHANNELS, { each: true })
  notifyChannels?: AllowedChannel[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
