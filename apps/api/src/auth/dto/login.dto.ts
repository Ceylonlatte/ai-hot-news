import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * SP-13 (2026-05-23): POST /auth/login request body.
 *
 * Username trimmed but case-sensitive. Password not trimmed
 * (leading/trailing spaces in passwords are user choice, and
 * trimming would break paste-from-password-manager flows).
 * Lengths defensive against megabyte payloads.
 */
export class LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
