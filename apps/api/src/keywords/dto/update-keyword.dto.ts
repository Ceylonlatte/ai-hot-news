import { PartialType } from '@nestjs/mapped-types';
import { CreateKeywordDto } from './create-keyword.dto';

/**
 * SP-14 (2026-05-23): PATCH /keywords/:id body.
 *
 * All fields from CreateKeywordDto become optional. Renaming `keyword`
 * is allowed but the service re-checks UNIQUE(userId, keyword) before
 * committing (translates Prisma P2002 → 409 Conflict).
 */
export class UpdateKeywordDto extends PartialType(CreateKeywordDto) {}
