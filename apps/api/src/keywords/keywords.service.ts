import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { getPrisma, Prisma, Platform, ContentStatus } from '@ai-hot-news/db';
import type {
  CreateKeywordDto,
  KeywordHitItemDto,
  KeywordHitsResponseDto,
  KeywordListResponseDto,
  KeywordMonitorDto,
  KeywordTriggerRules,
  MonitorFrequency,
  NotifyChannel,
  UpdateKeywordDto,
} from '@ai-hot-news/types';

/**
 * SP-14 (2026-05-23): KeywordMonitor CRUD service.
 *
 * V1 single-user: every row's userId is hardcoded to the seeded admin
 * 'usr-admin'. SP-X multi-user will swap to req.user.userId via Guard.
 * Encapsulated here so the controller stays agnostic of the user lookup
 * strategy.
 *
 * Tag normalization (synonyms / excludeWords):
 *   - trim each entry
 *   - drop empty
 *   - case-insensitive de-dup (preserve first-seen casing)
 *   This runs at write-time (create/update). SP-16 detection worker can
 *   rely on the array containing canonicalized strings.
 */

const ADMIN_USER_ID = 'usr-admin';

@Injectable()
export class KeywordsService {
  private readonly logger = new Logger(KeywordsService.name);

  // === public methods are ordered by REST verb: list → get → create → update → delete ===

  async list(): Promise<KeywordListResponseDto> {
    const prisma = getPrisma();
    // SP-15: include _count.hits so the UI list shows hit count per row
    // without a second round-trip. Prisma generates one LEFT JOIN +
    // GROUP BY query — cheaper than N+1 even at 100 keywords.
    const rows = await prisma.keywordMonitor.findMany({
      where: { userId: ADMIN_USER_ID },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { hits: true } } },
    });
    return {
      items: rows.map((r) => toDto(r, r._count.hits)),
      total: rows.length,
    };
  }

  async get(id: string): Promise<KeywordMonitorDto> {
    const prisma = getPrisma();
    const row = await prisma.keywordMonitor.findFirst({
      where: { id, userId: ADMIN_USER_ID },
      include: { _count: { select: { hits: true } } },
    });
    if (!row) throw new NotFoundException(`Keyword ${id} not found`);
    return toDto(row, row._count.hits);
  }

  async create(dto: CreateKeywordDto): Promise<KeywordMonitorDto> {
    const prisma = getPrisma();
    const synonyms = normalizeStringList(dto.synonyms);
    const excludeWords = normalizeStringList(dto.excludeWords);
    const platforms = dto.platforms ?? [];
    const monitorFrequency = (dto.monitorFrequency ?? 'H1') as MonitorFrequency;
    const triggerRules = normalizeTriggerRules(dto.triggerRules ?? null);
    const notifyChannels = (dto.notifyChannels ?? ['site']) as NotifyChannel[];
    const enabled = dto.enabled ?? true;

    try {
      const created = await prisma.keywordMonitor.create({
        data: {
          userId: ADMIN_USER_ID,
          keyword: dto.keyword,
          synonyms,
          excludeWords,
          platforms,
          monitorFrequency,
          triggerRules: triggerRules as Prisma.InputJsonValue,
          notifyChannels,
          enabled,
        },
      });
      return toDto(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Keyword "${dto.keyword}" already exists — PATCH the existing monitor instead.`,
        );
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateKeywordDto): Promise<KeywordMonitorDto> {
    const prisma = getPrisma();
    // Use updateMany scoped to userId so a future multi-user swap is one-line.
    // Manual existence check first because updateMany returns count, not row.
    const existing = await prisma.keywordMonitor.findFirst({
      where: { id, userId: ADMIN_USER_ID },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(`Keyword ${id} not found`);

    const data: Prisma.KeywordMonitorUpdateInput = {};
    if (dto.keyword !== undefined) data.keyword = dto.keyword;
    if (dto.synonyms !== undefined) data.synonyms = normalizeStringList(dto.synonyms);
    if (dto.excludeWords !== undefined) {
      data.excludeWords = normalizeStringList(dto.excludeWords);
    }
    if (dto.platforms !== undefined) data.platforms = dto.platforms;
    if (dto.monitorFrequency !== undefined) {
      data.monitorFrequency = dto.monitorFrequency as MonitorFrequency;
    }
    if (dto.triggerRules !== undefined) {
      data.triggerRules = normalizeTriggerRules(
        dto.triggerRules,
      ) as Prisma.InputJsonValue;
    }
    if (dto.notifyChannels !== undefined) {
      data.notifyChannels = dto.notifyChannels as NotifyChannel[];
    }
    if (dto.enabled !== undefined) data.enabled = dto.enabled;

    try {
      const updated = await prisma.keywordMonitor.update({
        where: { id },
        data,
        include: { _count: { select: { hits: true } } },
      });
      return toDto(updated, updated._count.hits);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Keyword "${dto.keyword}" already exists — pick another name or PATCH that one.`,
        );
      }
      throw err;
    }
  }

  /**
   * SP-15 PR-B (2026-05-23): list hits for one keyword, paginated.
   *
   * One query loads page of KeywordHit rows + JOIN HotNews via Prisma
   * include. Visible-only filter on the joined HotNews so users don't
   * see hits whose article got hidden (cleanup, quality re-flag, etc.).
   * Ordered by hitAt DESC = newest first (matches user mental model:
   * "Claude 监控最近抓到啥").
   */
  async hits(
    id: string,
    limit: number,
    offset: number,
  ): Promise<KeywordHitsResponseDto> {
    const prisma = getPrisma();

    const monitorRow = await prisma.keywordMonitor.findFirst({
      where: { id, userId: ADMIN_USER_ID },
      include: { _count: { select: { hits: true } } },
    });
    if (!monitorRow) {
      throw new NotFoundException(`Keyword ${id} not found`);
    }
    const monitor = toDto(monitorRow, monitorRow._count.hits);

    const hitRows = await prisma.keywordHit.findMany({
      where: {
        keywordId: id,
        hotNews: { status: ContentStatus.VISIBLE },
      },
      orderBy: { hitAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        hotNews: {
          select: {
            id: true,
            title: true,
            titleZh: true,
            summary: true,
            sourceUrl: true,
            sourcePlatform: true,
            author: true,
            publishedAt: true,
            crawledAt: true,
            aiTags: true,
            matchedKeywords: true,
            heatScore: true,
            heatLevel: true,
            groupId: true,
          },
        },
      },
    });

    const items: KeywordHitItemDto[] = hitRows.map((row) => ({
      id: row.hotNews.id,
      title: row.hotNews.title,
      titleZh: row.hotNews.titleZh,
      summary: row.hotNews.summary,
      aiTags: row.hotNews.aiTags,
      sourceUrl: row.hotNews.sourceUrl,
      sourcePlatform: row.hotNews.sourcePlatform as Platform,
      author: row.hotNews.author,
      publishedAt: row.hotNews.publishedAt.toISOString(),
      crawledAt: row.hotNews.crawledAt.toISOString(),
      heatScore: row.hotNews.heatScore,
      heatLevel: row.hotNews.heatLevel,
      groupId: row.hotNews.groupId,
      // Group fields zero-stubbed: this is a per-keyword view, the user
      // isn't expecting cross-platform fold semantics. NewsItem handles
      // groupSize===1 / empty arrays gracefully.
      groupSize: 1,
      groupPlatforms: {},
      groupMembers: [],
      subreddit: null,
      matchedKeywords: row.hotNews.matchedKeywords,
      hitAt: row.hitAt.toISOString(),
    }));

    return {
      monitor,
      items,
      total: monitorRow._count.hits,
      limit,
      offset,
    };
  }

  async remove(id: string): Promise<{ deleted: true }> {
    const prisma = getPrisma();
    // deleteMany returns { count } — gives 0 for not-found instead of throwing,
    // which is what we want to translate to 404 ourselves (consistent shape).
    const result = await prisma.keywordMonitor.deleteMany({
      where: { id, userId: ADMIN_USER_ID },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Keyword ${id} not found`);
    }
    return { deleted: true };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────

type PrismaRow = {
  id: string;
  keyword: string;
  synonyms: string[];
  excludeWords: string[];
  platforms: string[];
  monitorFrequency: 'M15' | 'M30' | 'H1' | 'D1';
  triggerRules: Prisma.JsonValue | null;
  notifyChannels: string[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastSearchedAt: Date | null;
};

function toDto(row: PrismaRow, hitCount = 0): KeywordMonitorDto {
  return {
    id: row.id,
    keyword: row.keyword,
    synonyms: row.synonyms,
    excludeWords: row.excludeWords,
    platforms: row.platforms,
    monitorFrequency: row.monitorFrequency,
    triggerRules: row.triggerRules as KeywordTriggerRules | null,
    notifyChannels: row.notifyChannels as NotifyChannel[],
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    hitCount,
    lastSearchedAt: row.lastSearchedAt?.toISOString() ?? null,
  };
}

/** trim → drop empty → case-insensitive de-dup (preserve first casing) */
function normalizeStringList(input: string[] | undefined): string[] {
  if (!input) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Empty object → null (DB cleaner); otherwise pass-through. */
function normalizeTriggerRules(
  input: KeywordTriggerRules | null | undefined,
): KeywordTriggerRules | null {
  if (input == null) return null;
  const hasAnyField =
    input.minCount !== undefined ||
    input.minHeatScore !== undefined ||
    input.growthRatePct !== undefined;
  if (!hasAnyField) return null;
  return input;
}
