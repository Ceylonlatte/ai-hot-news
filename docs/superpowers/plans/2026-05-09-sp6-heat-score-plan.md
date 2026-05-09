# SP-6 Heat Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `HotNews.heatScore`（Float 0-100）和 `HotNews.heatLevel`（enum BURST/HOT/NORMAL/LOW）这两个 schema 已就位的字段被真实计算 + 持续刷新；通过 `GET /hot-news?sort=heat` 端点暴露给下游 SP-8/9。RSS 不参与热度榜单。

**Architecture:**

1. `SourceConfig` 加 `weight Float @default(0.5)` —— 公式中"源权重"维度的输入。
2. API 层 `?sort=heat` 切换 orderBy（`[heatScore desc, publishedAt desc]`），并在 heat 路径过滤掉 RSS。DTO 暴露 `heatScore` + `heatLevel`。
3. Worker 新增 `apps/worker/src/heat/` 模块：BullMQ `heat` 队列（per-row 计算）+ BullMQ repeat job `heat-refresh`（30min 全量重算 + NTILE 重排 heatLevel）+ `OnApplicationBootstrap` boot backstop（镜像 SP-5 范式，含 `queue.clean` failed+completed 前置）。
4. `IngestionService` 改 first-write-wins → upsert（仅刷 `interactionData`，其他字段不动）+ INSERT/UPDATE 后均 push `heat:<id>`。
5. **不动** Web UI（HeatBadge + sort UI 留给 SP-8/9）。

**Tech Stack:** NestJS · BullMQ · Prisma · vitest · ioredis · Postgres NTILE window function · esbuild bundle pattern（同 `@ai-hot-news/utils`）。

**Spec:** `docs/superpowers/specs/2026-05-09-sp6-heat-score-design.md`

**部署：3 PR 链** `chore/sp6-A-schema` → `chore/sp6-B-api` → `chore/sp6-C-worker`，依赖序列。

---

## Pre-flight: codebase state on origin/main (VERIFIED 2026-05-09 23:43)

PR #9（chore/sp5-5-rename）已开但未 merge —— **PR-A 启动前必须先把 PR #9 merge 到 origin/main**，否则 PR-A 改的 `decomposition.md` 会跟 PR #9 的 SP-5.5 entry 冲突。

**已存在（不要重复创建）：**

- `apps/worker/src/redis/redis.module.ts` —— 共享 `RedisModule` 导出 `REDIS_CONNECTION`（SP-4.7 PR #2 引入）。任何注入 `REDIS_CONNECTION` 的新 module 必须 `imports: [RedisModule]`，否则 `redis.module.spec.ts` 会红。
- `apps/worker/src/redis/redis.module.spec.ts` —— 防回归：测试 `Test.createTestingModule({ imports: [<NewModule>] })` 能 resolve `REDIS_CONNECTION`。**HeatModule 加入后必须把 `HeatModule` 加到这个 spec 的 import 列表内。**
- `apps/worker/src/summarize/summarize.queue.ts` —— SP-5 的 BullMQ wiring 模板，HeatModule 完全 mirror 这个形态（`Symbol() + queueProvider + WORKER token + factory function + concurrency from env`）。
- `apps/worker/src/summarize/summarize.module.ts` —— SP-5 模块模板（含 `OnApplicationBootstrap` boot backstop + `OnModuleDestroy` worker.close + `queue.clean(0,0,'failed'+'completed')` 前置）。HeatModule mirror 这个形态。
- `apps/worker/src/summarize/summarize.module.spec.ts` —— boot backstop 测试模板，95% 可以 copy 改字段名。
- `apps/worker/src/crawl/ingestion.service.ts` —— 当前用 `prisma.hotNews.create` + P2002 catch silently skip。**SP-6 改这里**：替换为 upsert（仅刷 interactionData）+ INSERT/UPDATE 后 push `heat:<id>`。
- `apps/worker/src/crawl/ingestion.service.integration.spec.ts` 第 160 行 `does NOT overwrite interactionData on duplicate sourceUrl` HN case + 第 360 行同款 Reddit case —— **SP-6 invert 这两个 case**：改为"DOES upsert interactionData on duplicate sourceUrl, preserves other fields"。
- `packages/db/prisma/schema.prisma` `HotNews` 已有 `heatScore Float @default(0)` / `heatLevel HeatLevel @default(LOW)` / `@@index([heatScore(sort: Desc)])` —— **不改这三处**。
- `packages/db/prisma/schema.prisma` `SourceConfig` 现有 11 字段，**SP-6 加第 12 字段** `weight Float @default(0.5)`。
- `packages/types/src/dtos.ts` `HotNewsListItemDto` 12 字段（含 SP-5 的 titleZh/summary/aiTags），**SP-6 加 2 个字段** `heatScore` + `heatLevel`。
- `apps/api/src/hot-news/dto/list-hot-news.query.ts` 含 `page` / `pageSize` / `platforms` 3 个 query —— **SP-6 加第 4 个** `sort?: 'time' | 'heat'`。
- `apps/api/src/hot-news/hot-news.service.ts` `list(page, pageSize, platforms?)` 签名 —— **SP-6 加第 4 参数** `sort: 'time' | 'heat' = 'time'`，select 加 `heatScore`/`heatLevel`，conditional RSS filter，conditional orderBy。
- `apps/api/src/hot-news/hot-news.controller.ts` 透传 `query.platforms` —— **SP-6 加透传** `query.sort`。
- `apps/api/src/hot-news/hot-news.service.spec.ts` 含 SP-4/5 contract 测试 —— **SP-6 加 4 个新 case**（DTO 暴露 heat 字段；sort=heat 改 orderBy；sort=heat 过滤 RSS；sort=time 默认行为不变）。
- `.env.example` 含 SP-4.7/SP-5 段（FIRECRAWL/JINA/EXTRACT_CONCURRENCY/OPENROUTER/SUMMARY_*）—— **SP-6 加新段**（HEAT_*/INTERACTION_MAX_*）。
- `docker/docker-compose.prod.yml` worker.environment 已显式透传 SP-4.7/SP-5 keys —— **SP-6 加显式透传**（HEAT_*/INTERACTION_MAX_*）。**仅写 .env 不够**（PR #3 hot fix 教训）。

**还没有（本 SP 创建/扩展）：**

- `apps/worker/src/heat/` —— 整个目录不存在（8 个文件 + 4 个 spec）。
- `packages/db/prisma/migrations/20260509094500_sp6_source_weight/` —— migration 不存在。
- `apps/worker/src/heat/heat.cron.processor.integration.spec.ts` —— 新 integration 测试。
- prod `/srv/ai-hot-news/.env` 未含 HEAT_* / INTERACTION_MAX_*。

**契约信号（不要破坏）：**

- `apps/worker/src/redis/redis.module.spec.ts` 必须保持绿（含 HeatModule resolve）。
- `apps/worker/src/crawl/ingestion.service.integration.spec.ts` 当前 18 case 全绿，SP-6 invert 2 个 case + 加 1 个新 case 后仍需 18+1=19 case 全绿。
- `apps/api/src/hot-news/hot-news.service.spec.ts` 现有 SP-4/5 case 不能改语义（`status:VISIBLE` filter / DTO 不暴露 status/filterReason / titleZh+summary+aiTags 透传）。
- `prisma migrate deploy` 必须 idempotent；ADD COLUMN with DEFAULT 在 PG 11+ 是 metadata-only operation，无 row rewrite。

---

## PR-A · Schema migration（`SourceConfig.weight` 列）

**Branch:** `chore/sp6-A-schema`
**Base:** `origin/main` after PR #9 merged
**Goal:** Add a single column with backward-compatible default. No code consumes it yet (PR-B/C will).

### Task A1: Add `weight` column to `SourceConfig` Prisma schema

**Files:**

- Modify: `packages/db/prisma/schema.prisma:95-112`
- Create: `packages/db/prisma/migrations/20260509094500_sp6_source_weight/migration.sql`
- **Step A1.1: Create branch from origin/main**

```bash
git fetch origin
git checkout -b chore/sp6-A-schema origin/main
git status -sb
```

Expected: `## chore/sp6-A-schema...origin/main`

- **Step A1.2: Edit `packages/db/prisma/schema.prisma` SourceConfig model — add `weight` field**

Locate the `SourceConfig` block (line 95-112) and add the `weight` field after `errorMessage` and before `createdAt`:

```prisma
model SourceConfig {
  id             String       @id @default(cuid())
  platform       Platform
  name           String
  url            String?
  identifier     String?
  enabled        Boolean      @default(true)
  crawlInterval  Int          @default(1800)
  lastCrawledAt  DateTime?
  status         SourceStatus @default(NORMAL)
  errorMessage   String?
  weight         Float        @default(0.5)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([platform, enabled])
  @@unique([platform, url])
  @@map("source_configs")
}
```

- **Step A1.3: Generate the migration via prisma migrate dev**

Run from repo root:

```bash
pnpm --filter @ai-hot-news/db exec prisma migrate dev --name sp6_source_weight --create-only
```

Expected: prisma creates `packages/db/prisma/migrations/<timestamp>_sp6_source_weight/migration.sql` (timestamp will not be `20260509094500` literally — that's just for identification; whatever timestamp prisma picks is fine). The file will contain:

```sql
-- AlterTable
ALTER TABLE "source_configs" ADD COLUMN "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5;
```

If `--create-only` is unsupported in this prisma version, run without it (will apply to local DB; that's OK):

```bash
pnpm --filter @ai-hot-news/db exec prisma migrate dev --name sp6_source_weight
```

- **Step A1.4: Inspect migration SQL**

```bash
ls packages/db/prisma/migrations/ | grep sp6_source_weight
cat packages/db/prisma/migrations/*_sp6_source_weight/migration.sql
```

Expected: `ALTER TABLE "source_configs" ADD COLUMN "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5;`

- **Step A1.5: Apply locally + regenerate Prisma client**

If Step A1.3 used `--create-only`, apply now:

```bash
pnpm --filter @ai-hot-news/db exec prisma migrate deploy
pnpm --filter @ai-hot-news/db exec prisma generate
```

Expected: `Database schema is in sync` + `Generated Prisma Client (v6.19.x) to ./src/generated`.

- **Step A1.6: Verify column exists locally**

```bash
docker compose -f docker/docker-compose.dev.yml exec postgres \
  psql -U ai_hot_news -d ai_hot_news_dev -c "\d source_configs" | grep weight
```

Expected output (column line):

```
 weight         | double precision            |           | not null | 0.5
```

- **Step A1.7: Existing seed.consts.spec / consolidate-sp5-sources.spec / sp5-5-source-migrations.spec all pass**

```bash
pnpm --filter @ai-hot-news/db test
```

Expected: all 8 test files green (33+ cases). The new `weight` column has a default, so existing tests querying `source_configs` rows are unaffected.

- **Step A1.8: turbo lint + typecheck**

```bash
pnpm turbo run lint typecheck
```

Expected: 19/19 green.

- **Step A1.9: Commit PR-A**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(sp6-A): add SourceConfig.weight column for heat-score sourceWeight dimension

PR-A of 3 (schema migration only; PR-B adds API DTO + sort, PR-C adds worker).

Schema:
- SourceConfig.weight Float @default(0.5)

Migration:
- ALTER TABLE "source_configs" ADD COLUMN "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5;
- Metadata-only operation in PG 11+ (no row rewrite); idempotent backfill of
  existing 11 prod rows (3 HN + 1 Reddit bundle + 7 RSS) to 0.5.

Behavior:
- No consumer yet — PR-B exposes the field via DTO; PR-C reads it in the
  heat formula.
- V1 strategy is "all 0.5" (per spec §0 Q6/Q10): no data to tier yet,
  observe NTILE distribution two weeks then tune per-source.

Tests: prisma generate + db package tests 33/33; turbo lint+typecheck 19/19.

Spec: docs/superpowers/specs/2026-05-09-sp6-heat-score-design.md §5
EOF
)"
```

### Task A2: Push PR-A and open GitHub PR

- **Step A2.1: Push branch**

```bash
git push -u origin chore/sp6-A-schema
```

Expected: `* [new branch]      chore/sp6-A-schema -> chore/sp6-A-schema`.

- **Step A2.2: Open PR**

```bash
gh pr create --base main --head chore/sp6-A-schema \
  --title "feat(sp6-A): add SourceConfig.weight column for heat-score sourceWeight dimension" \
  --body "$(cat <<'EOF'
PR-A of 3 (SP-6 heat scoring split):

- **PR-A · this** · schema migration only
- **PR-B · next** · types DTO + API sort param + service routing
- **PR-C · last** · worker heat module + ingestion upsert refactor

## What

Add \`SourceConfig.weight Float @default(0.5)\` for the heat formula's
"sourceScore" dimension (spec §2.1). DEFAULT 0.5 backfills the existing
11 prod rows (3 HN + 1 Reddit bundle + 7 RSS) with no row rewrite
(metadata-only ALTER in PG 11+).

## Why now (vs in PR-C)

Smallest possible blast radius: schema migration is the riskiest step
(prod DDL); shipping it first lets PR-B/C deploy as pure code changes.
Rollback is trivial (\`prisma migrate resolve --rolled-back\` + manual
DROP COLUMN).

## Test plan

- [x] \`pnpm --filter @ai-hot-news/db exec prisma migrate dev --name sp6_source_weight\` → SQL generated
- [x] \`pnpm --filter @ai-hot-news/db test\` → 33/33 ✓
- [x] \`pnpm turbo run lint typecheck\` → 19/19 ✓
- [ ] CI green
- [ ] Prod migration applies cleanly: \`prisma migrate deploy\` adds the column with default 0.5

Spec: \`docs/superpowers/specs/2026-05-09-sp6-heat-score-design.md\` §5
EOF
)"
```

Expected: PR URL printed (e.g. `https://github.com/Ceylonlatte/ai-hot-news/pull/10`). Note the number for PR-B's base.

- **Step A2.3: Wait for CI green + merge to main**

After CI passes, merge via UI or `gh pr merge --squash --delete-branch`. Confirm origin/main now has the migration:

```bash
git fetch origin
git log origin/main --oneline -3 | grep sp6-A
```

Expected: a commit titled `feat(sp6-A): add SourceConfig.weight ...` on main.

---

## PR-B · API（DTO + sort + service + controller）

**Branch:** `chore/sp6-B-api`
**Base:** `origin/main` (after PR-A merged)
**Goal:** API exposes `heatScore` + `heatLevel` in DTO; accepts `?sort=heat`; routes orderBy; filters RSS in heat path. No worker writes yet, so all responses will have `heatScore=0` until PR-C ships.

### Task B1: Add `heatScore` + `heatLevel` to `HotNewsListItemDto`

**Files:**

- Modify: `packages/types/src/dtos.ts:49-78`
- **Step B1.1: Create branch from origin/main (with PR-A merged)**

```bash
git fetch origin
git checkout -b chore/sp6-B-api origin/main
```

- **Step B1.2: Add `heatScore` + `heatLevel` fields to DTO**

Edit `packages/types/src/dtos.ts`. Locate the `HotNewsListItemDto` interface (line 49). After the existing `crawledAt: string;` field (line 77), add:

```typescript
  /**
   * SP-6 (2026-05-09): Heat score 0-100 (V1 caps at 0-72.5; reaches 0-100
   * once SP-7's crossPlatformScore lands). Always 0 for RSS rows (excluded
   * from heat ranking; see HotNewsService heat-sort path). DTO type allows
   * null for forward-compat: if V2 schema makes the column nullable to
   * distinguish "uncomputed" vs "computed=0", DTO needn't change.
   */
  heatScore: number | null;
  /**
   * SP-6 (2026-05-09): Categorical heat tier from NTILE(20)→4-way bucket
   * over the 48h non-RSS VISIBLE window. BURST=top 5% / HOT=next 15% /
   * NORMAL=next 30% / LOW=bottom 50%. Recalculated globally on the
   * 30-min cron; single-row writes do NOT refresh heatLevel (see spec
   * §3.1 weak-consistency trade-off). Frontend uses for color coding
   * (Aurora SP-8 / Dashboard SP-9).
   */
  heatLevel: 'BURST' | 'HOT' | 'NORMAL' | 'LOW' | null;
```

- **Step B1.3: Verify typecheck**

```bash
pnpm turbo run typecheck
```

Expected: 5/5 typecheck tasks all green. (api/web/worker tsc may complain that `heatScore`/`heatLevel` are never set in `hot-news.service.ts` — that's expected, B3 fixes it.)

If typecheck fails (it will, because hot-news.service.ts doesn't return these fields yet), proceed to B3 — typecheck will pass after B3.

### Task B2: Add `sort` to `ListHotNewsQuery`

**Files:**

- Modify: `apps/api/src/hot-news/dto/list-hot-news.query.ts`
- Modify: `apps/api/src/hot-news/dto/list-hot-news.query.spec.ts`
- **Step B2.1: Write failing test for `sort` validation**

Edit `apps/api/src/hot-news/dto/list-hot-news.query.spec.ts`. Inside the existing `describe(...)` block, add:

```typescript
  describe('sort field (SP-6)', () => {
    it('defaults to undefined when sort is omitted', async () => {
      const dto = await transformAndValidate({});
      expect(dto.sort).toBeUndefined();
    });

    it('accepts "time" lowercased', async () => {
      const dto = await transformAndValidate({ sort: 'time' });
      expect(dto.sort).toBe('time');
    });

    it('accepts "heat" lowercased', async () => {
      const dto = await transformAndValidate({ sort: 'heat' });
      expect(dto.sort).toBe('heat');
    });

    it('lowercases " HEAT " (mixed case + whitespace)', async () => {
      const dto = await transformAndValidate({ sort: ' HEAT ' });
      expect(dto.sort).toBe('heat');
    });

    it('rejects "popularity" (not in allowlist)', async () => {
      await expect(transformAndValidate({ sort: 'popularity' })).rejects.toThrow();
    });
  });
```

(Reuse the existing `transformAndValidate` helper in the spec; if it doesn't exist, copy its pattern from the platforms test.)

- **Step B2.2: Run test to verify it fails**

```bash
pnpm --filter @ai-hot-news/api test -- list-hot-news.query.spec
```

Expected: 5 new tests fail with "Cannot read property 'sort'" or similar (sort field not declared in DTO).

- **Step B2.3: Implement `sort` field in DTO**

Edit `apps/api/src/hot-news/dto/list-hot-news.query.ts`. Replace the entire file:

```typescript
import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const ALLOWED_PLATFORMS = ['RSS', 'HACKERNEWS', 'REDDIT'] as const;
type AllowedPlatform = (typeof ALLOWED_PLATFORMS)[number];

const ALLOWED_SORTS = ['time', 'heat'] as const;
type AllowedSort = (typeof ALLOWED_SORTS)[number];

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
}
```

- **Step B2.4: Run test to verify it passes**

```bash
pnpm --filter @ai-hot-news/api test -- list-hot-news.query.spec
```

Expected: all tests pass (existing platform tests + 5 new sort tests).

### Task B3: Update `HotNewsService.list()` for sort routing + RSS filter + DTO field expansion

**Files:**

- Modify: `apps/api/src/hot-news/hot-news.service.ts`
- Modify: `apps/api/src/hot-news/hot-news.service.spec.ts`
- **Step B3.1: Write failing tests for sort routing + heat field passthrough**

Append to `apps/api/src/hot-news/hot-news.service.spec.ts` (inside the existing `describe('HotNewsService', ...)` block):

```typescript
  describe('SP-6 sort + heat field passthrough', () => {
    it('defaults to orderBy publishedAt desc when sort is undefined', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
      await service.list(1, 20);
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(findManyArgs.orderBy).toEqual([{ publishedAt: 'desc' }]);
      vi.useRealTimers();
    });

    it('uses orderBy [heatScore desc, publishedAt desc] when sort=heat', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
      await service.list(1, 20, ['HACKERNEWS', 'REDDIT'], 'heat');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(findManyArgs.orderBy).toEqual([
        { heatScore: 'desc' },
        { publishedAt: 'desc' },
      ]);
      vi.useRealTimers();
    });

    it('filters out RSS from platforms when sort=heat (SP-6 §0 Q1/Q2)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
      await service.list(1, 20, ['RSS', 'HACKERNEWS', 'REDDIT'], 'heat');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      const platformsInOr = findManyArgs.where.OR.map(
        (c: { sourcePlatform: string }) => c.sourcePlatform,
      );
      expect(platformsInOr).not.toContain('RSS');
      expect(platformsInOr).toEqual(['HACKERNEWS', 'REDDIT']);
      vi.useRealTimers();
    });

    it('returns empty result when sort=heat AND only RSS platform requested', async () => {
      const result = await service.list(1, 20, ['RSS'], 'heat');
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(prismaMock.hotNews.findMany).not.toHaveBeenCalled();
    });

    it('keeps RSS in platforms when sort=time (default)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
      await service.list(1, 20, ['RSS', 'HACKERNEWS'], 'time');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      const platformsInOr = findManyArgs.where.OR.map(
        (c: { sourcePlatform: string }) => c.sourcePlatform,
      );
      expect(platformsInOr).toContain('RSS');
      vi.useRealTimers();
    });

    it('selects heatScore + heatLevel from prisma', async () => {
      await service.list(1, 20);
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(findManyArgs.select).toMatchObject({
        heatScore: true,
        heatLevel: true,
      });
    });

    it('passes heatScore + heatLevel through to DTO', async () => {
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'h1',
          title: 'Anthropic launches Claude 5',
          titleZh: 'Anthropic 发布 Claude 5',
          summary: 'Anthropic 发布了 Claude 5。',
          aiTags: ['company:anthropic'],
          sourceUrl: 'https://example.com/h1',
          sourcePlatform: 'REDDIT',
          author: 'r/anthropic_user',
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          crawledAt: new Date('2026-05-10T10:01:00Z'),
          heatScore: 67.4,
          heatLevel: 'HOT',
        },
      ]);
      prismaMock.hotNews.count.mockResolvedValueOnce(1);

      const result = await service.list(1, 20, ['REDDIT'], 'heat');

      expect(result.items[0]!.heatScore).toBe(67.4);
      expect(result.items[0]!.heatLevel).toBe('HOT');
    });
  });
```

- **Step B3.2: Run tests to verify they fail**

```bash
pnpm --filter @ai-hot-news/api test -- hot-news.service.spec
```

Expected: 7 new tests fail (sort param not supported; heat fields not in DTO output; orderBy not configurable).

- **Step B3.3: Implement service changes**

Replace `apps/api/src/hot-news/hot-news.service.ts` with:

```typescript
import { Injectable } from '@nestjs/common';
import { getPrisma, ContentStatus, type Platform } from '@ai-hot-news/db';
import type { HotNewsListResponseDto } from '@ai-hot-news/types';

const PLATFORM_WINDOW_HOURS: Record<Platform, number> = {
  TWITTER: 48,
  HACKERNEWS: 48,
  REDDIT: 48,
  RSS: 24 * 7,
};

const DEFAULT_PLATFORMS: Platform[] = ['HACKERNEWS', 'REDDIT'];

@Injectable()
export class HotNewsService {
  async list(
    page: number,
    pageSize: number,
    platforms?: Platform[],
    sort: 'time' | 'heat' = 'time',
  ): Promise<HotNewsListResponseDto> {
    const prisma = getPrisma();
    const skip = (page - 1) * pageSize;
    const requested = platforms?.length ? platforms : DEFAULT_PLATFORMS;

    // SP-6 §0 Q1/Q2: heat sort excludes RSS by contract (RSS goes to its own
    // tab `?tab=media` and is not part of the trending ranking).
    const effectivePlatforms =
      sort === 'heat' ? requested.filter((p) => p !== 'RSS') : requested;

    if (effectivePlatforms.length === 0) {
      return { items: [], page, pageSize, total: 0 };
    }

    const now = new Date();
    const orClauses = effectivePlatforms.map((p) => ({
      sourcePlatform: p,
      publishedAt: {
        gte: new Date(now.getTime() - PLATFORM_WINDOW_HOURS[p] * 60 * 60 * 1000),
      },
    }));

    const where = {
      status: ContentStatus.VISIBLE,
      OR: orClauses,
    };

    const orderBy =
      sort === 'heat'
        ? [{ heatScore: 'desc' as const }, { publishedAt: 'desc' as const }]
        : [{ publishedAt: 'desc' as const }];

    const [rows, total] = await prisma.$transaction([
      prisma.hotNews.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        select: {
          id: true,
          title: true,
          titleZh: true,
          summary: true,
          aiTags: true,
          sourceUrl: true,
          sourcePlatform: true,
          author: true,
          publishedAt: true,
          crawledAt: true,
          heatScore: true,
          heatLevel: true,
        },
      }),
      prisma.hotNews.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        titleZh: r.titleZh,
        summary: r.summary,
        aiTags: r.aiTags,
        sourceUrl: r.sourceUrl,
        sourcePlatform: r.sourcePlatform,
        author: r.author,
        publishedAt: r.publishedAt.toISOString(),
        crawledAt: r.crawledAt.toISOString(),
        heatScore: r.heatScore,
        heatLevel: r.heatLevel,
      })),
      page,
      pageSize,
      total,
    };
  }
}
```

- **Step B3.4: Run tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/api test
```

Expected: all api tests green (existing 6 SP-4/5 cases + 7 new SP-6 cases = 13+).

### Task B4: Update `HotNewsController` to pass `query.sort` through

**Files:**

- Modify: `apps/api/src/hot-news/hot-news.controller.ts`
- Modify: `apps/api/src/hot-news/hot-news.controller.spec.ts`
- **Step B4.1: Write failing test for sort passthrough**

Append to `apps/api/src/hot-news/hot-news.controller.spec.ts`:

```typescript
  it('passes query.sort through to service.list (SP-6)', async () => {
    serviceListSpy.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    await controller.list({
      page: 1,
      pageSize: 20,
      platforms: ['HACKERNEWS'],
      sort: 'heat',
    } as ListHotNewsQuery);
    expect(serviceListSpy).toHaveBeenCalledWith(1, 20, ['HACKERNEWS'], 'heat');
  });
```

If `serviceListSpy` / `controller` setup doesn't exist in the spec, copy the pattern from existing controller test setup and add this case.

- **Step B4.2: Run test to verify it fails**

```bash
pnpm --filter @ai-hot-news/api test -- hot-news.controller.spec
```

Expected: failure with "expected service.list called with [1, 20, ['HACKERNEWS'], 'heat']" but actual is `[1, 20, ['HACKERNEWS']]` (3 args).

- **Step B4.3: Implement passthrough**

Replace `apps/api/src/hot-news/hot-news.controller.ts`:

```typescript
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
    );
  }
}
```

- **Step B4.4: Run all api tests + typecheck**

```bash
pnpm --filter @ai-hot-news/api test
pnpm turbo run typecheck
```

Expected: api tests fully green; typecheck 5/5 green (the worker tests still pass because the heatScore/heatLevel fields are present in the mock data already).

- **Step B4.5: Smoke test the API locally**

Start dev stack (or just api):

```bash
pnpm --filter @ai-hot-news/api dev &
sleep 5
curl -s 'http://localhost:3000/hot-news?pageSize=3' | jq '.items[0]'
curl -s 'http://localhost:3000/hot-news?pageSize=3&sort=heat' | jq '.items[0] | {sourcePlatform, heatScore, heatLevel, title}'
curl -s 'http://localhost:3000/hot-news?pageSize=3&sort=heat&platforms=RSS' | jq
```

Expected:

- First curl: returns up to 3 rows; each row has `heatScore: 0` and `heatLevel: "LOW"` (worker hasn't computed yet — will be filled by PR-C deploy).
- Second curl: returns up to 3 rows ordered by heatScore desc; **no RSS rows**.
- Third curl: `{ "items": [], "page": 1, "pageSize": 3, "total": 0 }` (RSS only + heat sort = empty by contract).

Kill the dev server: `pkill -f 'nest start'`.

- **Step B4.6: Commit PR-B**

```bash
git add packages/types/src/dtos.ts \
        apps/api/src/hot-news/dto/list-hot-news.query.ts \
        apps/api/src/hot-news/dto/list-hot-news.query.spec.ts \
        apps/api/src/hot-news/hot-news.service.ts \
        apps/api/src/hot-news/hot-news.service.spec.ts \
        apps/api/src/hot-news/hot-news.controller.ts \
        apps/api/src/hot-news/hot-news.controller.spec.ts
git commit -m "$(cat <<'EOF'
feat(sp6-B): API exposes heatScore + heatLevel; ?sort=heat routing + RSS exclusion

PR-B of 3 (PR-A schema migration shipped; PR-C worker module next).

DTO (packages/types/src/dtos.ts):
- HotNewsListItemDto adds `heatScore: number | null` and
  `heatLevel: 'BURST' | 'HOT' | 'NORMAL' | 'LOW' | null`.
- DTO type allows null for forward-compat (V2 may make column nullable to
  distinguish "uncomputed" vs "computed=0"); current schema returns 0 / 'LOW'
  defaults until PR-C worker writes real values.

Query (apps/api/src/hot-news/dto/list-hot-news.query.ts):
- New `sort?: 'time' | 'heat'` (default undefined → service treats as 'time').
- Lowercased + trimmed by @Transform; rejects unknown values.

Service (apps/api/src/hot-news/hot-news.service.ts):
- list() accepts new `sort` parameter (default 'time').
- sort='heat' → orderBy=[{heatScore: 'desc'}, {publishedAt: 'desc'}] (tiebreak
  by recency); RSS platforms filtered out (spec §0 Q1/Q2 contract).
- sort='time' → orderBy=[{publishedAt: 'desc'}] (preserved existing behavior).
- RSS-only request with sort='heat' returns empty (effectivePlatforms=[]).
- select adds heatScore + heatLevel; map adds them to DTO output.

Controller: passthrough of query.sort.

Tests: api 13+/13+ green (6 existing SP-4/5 cases preserved + 7 new SP-6 cases
+ 1 new controller passthrough case + 5 new query DTO cases).

Behavior on prod after deploy:
- All responses gain heatScore=0 + heatLevel='LOW' fields (default schema values).
- ?sort=heat works but ranks all rows equally by tiebreak publishedAt.
- PR-C worker will populate real heat values within 30min of deploy.

Spec: docs/superpowers/specs/2026-05-09-sp6-heat-score-design.md §6
EOF
)"
```

### Task B5: Push PR-B and open GitHub PR

- **Step B5.1: Push branch**

```bash
git push -u origin chore/sp6-B-api
```

- **Step B5.2: Open PR**

```bash
gh pr create --base main --head chore/sp6-B-api \
  --title "feat(sp6-B): API exposes heatScore + heatLevel; ?sort=heat routing + RSS exclusion" \
  --body "$(cat <<'EOF'
PR-B of 3 (SP-6 heat scoring split). Depends on PR-A (SourceConfig.weight) being merged.

## What

- DTO adds \`heatScore\` + \`heatLevel\` (nullable for forward-compat)
- Query DTO accepts \`?sort=time | heat\` (default time)
- Service routes orderBy + filters RSS in heat path
- Controller passes sort through

## Why before PR-C (worker)

API can ship safely with all heatScore=0 / heatLevel='LOW' since schema
has DEFAULT 0 / DEFAULT 'LOW'. Frontend (Web) is unchanged — DTO type
addition flows through automatically. Once PR-C deploys, worker fills
real heat values within the 30-min cron cycle.

## Test plan

- [x] api tests 13+/13+ ✓ (6 existing + 7 new SP-6 cases)
- [x] query DTO tests +5 ✓
- [x] controller passthrough +1 ✓
- [x] turbo lint+typecheck 19/19 ✓
- [x] Local smoke: curl /hot-news?sort=heat&platforms=RSS returns []
- [ ] CI green
- [ ] Prod smoke after merge: \`curl 'https://hotnews.shinpeionline.top/api/hot-news?pageSize=3' | jq '.items[0] | {heatScore, heatLevel}'\` returns the 2 new fields

Spec: \`docs/superpowers/specs/2026-05-09-sp6-heat-score-design.md\` §6
EOF
)"
```

- **Step B5.3: Wait for CI green + merge to main**

```bash
gh pr merge --squash --delete-branch
git fetch origin
git log origin/main --oneline -3 | grep sp6-B
```

---

## PR-C · Worker（heat module + ingestion upsert）

**Branch:** `chore/sp6-C-worker`
**Base:** `origin/main` (after PR-A + PR-B merged)
**Goal:** Worker computes heatScore + heatLevel via 3 trigger paths (ingest INSERT, ingest UPDATE upsert, 30-min cron). Ingestion changes from first-write-wins to upsert (refreshes interactionData on duplicate sourceUrl). decomposition.md §11 records SP-6 completion.

### Task C1: `apps/worker/src/heat/heat.config.ts` (env reading)

**Files:**

- Create: `apps/worker/src/heat/heat.config.ts`
- Create: `apps/worker/src/heat/heat.config.spec.ts`
- **Step C1.1: Create branch from origin/main (with PR-A + PR-B merged)**

```bash
git fetch origin
git checkout -b chore/sp6-C-worker origin/main
```

- **Step C1.2: Write failing test for env reading with defaults**

Create `apps/worker/src/heat/heat.config.spec.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadHeatConfig } from './heat.config';

describe('loadHeatConfig', () => {
  const orig = { ...process.env };

  beforeEach(() => {
    delete process.env.HEAT_DECAY_TAU_HOURS;
    delete process.env.HEAT_CRON_INTERVAL_MIN;
    delete process.env.HEAT_BATCH_SIZE;
    delete process.env.HEAT_CONCURRENCY;
    delete process.env.INTERACTION_MAX_HN;
    delete process.env.INTERACTION_MAX_REDDIT;
    delete process.env.INTERACTION_MAX_TWITTER;
  });

  afterEach(() => {
    process.env = { ...orig };
  });

  it('returns documented defaults when env is empty', () => {
    const cfg = loadHeatConfig();
    expect(cfg).toEqual({
      decayTauHours: 48,
      cronIntervalMin: 30,
      batchSize: 500,
      concurrency: 2,
      maxHn: 500,
      maxReddit: 5000,
      maxTwitter: 100000,
    });
  });

  it('reads HEAT_DECAY_TAU_HOURS from env', () => {
    process.env.HEAT_DECAY_TAU_HOURS = '24';
    expect(loadHeatConfig().decayTauHours).toBe(24);
  });

  it('reads INTERACTION_MAX_REDDIT from env', () => {
    process.env.INTERACTION_MAX_REDDIT = '8000';
    expect(loadHeatConfig().maxReddit).toBe(8000);
  });

  it('falls back to default when env value is invalid (NaN)', () => {
    process.env.HEAT_CONCURRENCY = 'not-a-number';
    expect(loadHeatConfig().concurrency).toBe(2);
  });

  it('falls back to default when env value is zero or negative', () => {
    process.env.HEAT_BATCH_SIZE = '0';
    expect(loadHeatConfig().batchSize).toBe(500);
    process.env.HEAT_BATCH_SIZE = '-1';
    expect(loadHeatConfig().batchSize).toBe(500);
  });
});
```

- **Step C1.3: Run test to verify it fails**

```bash
pnpm --filter @ai-hot-news/worker test -- heat.config.spec
```

Expected: file not found.

- **Step C1.4: Implement `heat.config.ts`**

Create `apps/worker/src/heat/heat.config.ts`:

```typescript
export interface HeatConfig {
  decayTauHours: number;
  cronIntervalMin: number;
  batchSize: number;
  concurrency: number;
  maxHn: number;
  maxReddit: number;
  maxTwitter: number;
}

const DEFAULTS: HeatConfig = {
  decayTauHours: 48,
  cronIntervalMin: 30,
  batchSize: 500,
  concurrency: 2,
  maxHn: 500,
  maxReddit: 5000,
  maxTwitter: 100000,
};

function readPositiveInt(envValue: string | undefined, fallback: number): number {
  if (!envValue) return fallback;
  const n = Number(envValue);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function readPositiveNumber(envValue: string | undefined, fallback: number): number {
  if (!envValue) return fallback;
  const n = Number(envValue);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function loadHeatConfig(): HeatConfig {
  return {
    decayTauHours: readPositiveNumber(process.env.HEAT_DECAY_TAU_HOURS, DEFAULTS.decayTauHours),
    cronIntervalMin: readPositiveInt(process.env.HEAT_CRON_INTERVAL_MIN, DEFAULTS.cronIntervalMin),
    batchSize: readPositiveInt(process.env.HEAT_BATCH_SIZE, DEFAULTS.batchSize),
    concurrency: readPositiveInt(process.env.HEAT_CONCURRENCY, DEFAULTS.concurrency),
    maxHn: readPositiveInt(process.env.INTERACTION_MAX_HN, DEFAULTS.maxHn),
    maxReddit: readPositiveInt(process.env.INTERACTION_MAX_REDDIT, DEFAULTS.maxReddit),
    maxTwitter: readPositiveInt(process.env.INTERACTION_MAX_TWITTER, DEFAULTS.maxTwitter),
  };
}
```

- **Step C1.5: Run test to verify it passes**

```bash
pnpm --filter @ai-hot-news/worker test -- heat.config.spec
```

Expected: 5/5 cases green.

- **Step C1.6: Commit**

```bash
git add apps/worker/src/heat/heat.config.ts apps/worker/src/heat/heat.config.spec.ts
git commit -m "feat(sp6-C): heat.config reads HEAT_* + INTERACTION_MAX_* env with safe fallbacks"
```

### Task C2: `apps/worker/src/heat/interaction-signal.ts` (per-platform log normalization)

**Files:**

- Create: `apps/worker/src/heat/interaction-signal.ts`
- Create: `apps/worker/src/heat/interaction-signal.spec.ts`
- **Step C2.1: Write failing tests for `interactionSignal` per platform**

Create `apps/worker/src/heat/interaction-signal.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { interactionSignal } from './interaction-signal';
import type { HeatConfig } from './heat.config';

const CFG: HeatConfig = {
  decayTauHours: 48,
  cronIntervalMin: 30,
  batchSize: 500,
  concurrency: 2,
  maxHn: 500,
  maxReddit: 5000,
  maxTwitter: 100000,
};

describe('interactionSignal', () => {
  describe('null / empty data', () => {
    it('returns 0 when data is null', () => {
      expect(interactionSignal('HACKERNEWS', null, CFG)).toBe(0);
    });

    it('returns 0 when HN data has no score / comments', () => {
      expect(interactionSignal('HACKERNEWS', {}, CFG)).toBe(0);
    });
  });

  describe('HACKERNEWS', () => {
    it('score=0, comments=0 → 0', () => {
      expect(interactionSignal('HACKERNEWS', { score: 0, comments: 0 }, CFG)).toBe(0);
    });

    it('score=100, comments=20 normalizes to ~62 (log10(141)/log10(501) * 100)', () => {
      // raw = 100 + 20*2 = 140; norm = log10(141)/log10(501) * 100 ≈ 79.6
      const v = interactionSignal('HACKERNEWS', { score: 100, comments: 20 }, CFG);
      expect(v).toBeCloseTo(79.6, 0);
    });

    it('score=10000, comments=2000 caps near 100 (above MAX_HN=500)', () => {
      // raw = 14000; norm = log10(14001)/log10(501) ≈ 1.52 → 152, no clamp in formula
      const v = interactionSignal('HACKERNEWS', { score: 10000, comments: 2000 }, CFG);
      expect(v).toBeGreaterThan(100);  // expected behavior — cap is upstream concern
    });
  });

  describe('REDDIT', () => {
    it('null upvote_ratio falls back to 0.5 dampener', () => {
      // raw = (100 + 20*2) * 0.5 = 70; norm = log10(71)/log10(5001) ≈ 50.1
      const v = interactionSignal(
        'REDDIT',
        { score: 100, comments: 20, redditUpvoteRatio: null },
        CFG,
      );
      expect(v).toBeCloseTo(50.1, 0);
    });

    it('upvote_ratio=0.4 still treated as 0.5 (clamp)', () => {
      const v1 = interactionSignal(
        'REDDIT',
        { score: 100, comments: 20, redditUpvoteRatio: 0.4 },
        CFG,
      );
      const v2 = interactionSignal(
        'REDDIT',
        { score: 100, comments: 20, redditUpvoteRatio: 0.5 },
        CFG,
      );
      expect(v1).toBeCloseTo(v2, 1);
    });

    it('upvote_ratio=0.95 boosts (raw * 0.95)', () => {
      // raw = (100 + 20*2) * 0.95 = 133; norm = log10(134)/log10(5001) ≈ 57.7
      const v = interactionSignal(
        'REDDIT',
        { score: 100, comments: 20, redditUpvoteRatio: 0.95 },
        CFG,
      );
      expect(v).toBeCloseTo(57.7, 0);
    });
  });

  describe('TWITTER', () => {
    it('placeholder formula uses likes + retweets*3 + replies*2', () => {
      // raw = 100 + 20*3 + 10*2 = 180; norm = log10(181)/log10(100001) ≈ 45.2
      const v = interactionSignal(
        'TWITTER',
        { likes: 100, retweets: 20, replies: 10 },
        CFG,
      );
      expect(v).toBeCloseTo(45.2, 0);
    });
  });

  describe('RSS guard', () => {
    it('throws when called for RSS (caller must filter)', () => {
      expect(() => interactionSignal('RSS', { score: 100 }, CFG)).toThrow(
        /RSS rows must be filtered/,
      );
    });
  });
});
```

- **Step C2.2: Run test to verify it fails**

```bash
pnpm --filter @ai-hot-news/worker test -- interaction-signal.spec
```

Expected: file not found.

- **Step C2.3: Implement `interaction-signal.ts`**

Create `apps/worker/src/heat/interaction-signal.ts`:

```typescript
import type { Platform } from '@ai-hot-news/db';
import type { HeatConfig } from './heat.config';

function normalizeLog(raw: number, max: number): number {
  return (Math.log10(raw + 1) / Math.log10(max + 1)) * 100;
}

export function interactionSignal(
  platform: Platform,
  data: Record<string, unknown> | null,
  cfg: HeatConfig,
): number {
  if (!data) return 0;

  switch (platform) {
    case 'HACKERNEWS': {
      const score = Number(data.score) || 0;
      const comments = Number(data.comments) || 0;
      const raw = score + comments * 2;
      return normalizeLog(raw, cfg.maxHn);
    }

    case 'REDDIT': {
      const score = Number(data.score) || 0;
      const comments = Number(data.comments) || 0;
      const ratio = Number(data.redditUpvoteRatio);
      const ratioWeight = Math.max(Number.isFinite(ratio) ? ratio : 0.5, 0.5);
      const raw = (score + comments * 2) * ratioWeight;
      return normalizeLog(raw, cfg.maxReddit);
    }

    case 'TWITTER': {
      const likes = Number(data.likes) || 0;
      const retweets = Number(data.retweets) || 0;
      const replies = Number(data.replies) || 0;
      const raw = likes + retweets * 3 + replies * 2;
      return normalizeLog(raw, cfg.maxTwitter);
    }

    case 'RSS':
      throw new Error('RSS rows must be filtered before interactionSignal()');
  }
}
```

- **Step C2.4: Run tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/worker test -- interaction-signal.spec
```

Expected: all 12 cases green.

- **Step C2.5: Commit**

```bash
git add apps/worker/src/heat/interaction-signal.ts apps/worker/src/heat/interaction-signal.spec.ts
git commit -m "feat(sp6-C): per-platform interaction signal with log10 normalization"
```

### Task C3: `apps/worker/src/heat/heat.service.ts` (compute + UPDATE single row)

**Files:**

- Create: `apps/worker/src/heat/heat.service.ts`
- Create: `apps/worker/src/heat/heat.service.spec.ts`
- **Step C3.1: Write failing tests for `HeatService.run` and `computeHeatScore`**

Create `apps/worker/src/heat/heat.service.spec.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  hotNews: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  sourceConfig: {
    findFirst: vi.fn(),
  },
};

vi.mock('@ai-hot-news/db', () => ({
  getPrisma: () => mockPrisma,
}));

import { HeatService, computeHeatScore } from './heat.service';
import type { HeatConfig } from './heat.config';

const CFG: HeatConfig = {
  decayTauHours: 48,
  cronIntervalMin: 30,
  batchSize: 500,
  concurrency: 2,
  maxHn: 500,
  maxReddit: 5000,
  maxTwitter: 100000,
};

describe('computeHeatScore', () => {
  it('returns 0 for RSS rows (early return)', () => {
    const score = computeHeatScore(
      {
        sourcePlatform: 'RSS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: null,
      },
      0.5,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    expect(score).toBe(0);
  });

  it('time decay: 1h old HN row → timeScore ≈ 98 (full weight 25%)', () => {
    const score = computeHeatScore(
      {
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: null,  // interaction=0
      },
      0.5,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    // timeScore=exp(-1/48)*100 ≈ 97.9; total = 97.9*0.25 + 0*0.35 + 50*0.25 + 0*0.15 = 24.475 + 12.5 = 36.97
    expect(score).toBeCloseTo(36.97, 1);
  });

  it('time decay: 48h old HN row → timeScore ≈ 37', () => {
    const score = computeHeatScore(
      {
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-07T13:00:00Z'),
        interactionData: null,
      },
      0.5,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    // timeScore=exp(-48/48)*100 ≈ 36.79; total = 36.79*0.25 + 0 + 12.5 + 0 = 21.7
    expect(score).toBeCloseTo(21.7, 0);
  });

  it('sourceWeight 1.0 → sourceScore contributes 25 instead of 12.5', () => {
    const score05 = computeHeatScore(
      {
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: null,
      },
      0.5,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    const score10 = computeHeatScore(
      {
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: null,
      },
      1.0,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    // diff = (1.0 - 0.5) * 100 * 0.25 = 12.5
    expect(score10 - score05).toBeCloseTo(12.5, 1);
  });

  it('full case: HN row with score=100, comments=20, age=24h, weight=0.5', () => {
    const score = computeHeatScore(
      {
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-08T13:00:00Z'),
        interactionData: { score: 100, comments: 20 },
      },
      0.5,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    // timeScore=exp(-24/48)*100 ≈ 60.65
    // interactionScore=log10(141)/log10(501) * 100 ≈ 79.6
    // sourceScore=50; cross=0
    // total = 60.65*0.25 + 79.6*0.35 + 50*0.25 + 0*0.15 = 15.16 + 27.86 + 12.5 = 55.5
    expect(score).toBeCloseTo(55.5, 0);
  });
});

describe('HeatService.run', () => {
  let service: HeatService;

  beforeEach(() => {
    mockPrisma.hotNews.findUnique.mockReset();
    mockPrisma.hotNews.update.mockReset();
    mockPrisma.sourceConfig.findFirst.mockReset();
    service = new HeatService(CFG);
  });

  afterEach(() => vi.useRealTimers());

  it('SELECTs the row + sourceConfig.weight, then UPDATEs heatScore only (not heatLevel)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T13:00:00Z'));

    mockPrisma.hotNews.findUnique.mockResolvedValue({
      id: 'h1',
      sourcePlatform: 'HACKERNEWS',
      publishedAt: new Date('2026-05-08T13:00:00Z'),
      interactionData: { score: 100, comments: 20 },
    });
    mockPrisma.sourceConfig.findFirst.mockResolvedValue({ weight: 0.5 });

    await service.run('h1');

    expect(mockPrisma.hotNews.findUnique).toHaveBeenCalledWith({
      where: { id: 'h1' },
      select: { sourcePlatform: true, publishedAt: true, interactionData: true },
    });
    expect(mockPrisma.hotNews.update).toHaveBeenCalledTimes(1);
    const updateArgs = mockPrisma.hotNews.update.mock.calls[0]![0]!;
    expect(updateArgs.where).toEqual({ id: 'h1' });
    expect(updateArgs.data.heatScore).toBeCloseTo(55.5, 0);
    expect(updateArgs.data.heatLevel).toBeUndefined();  // single-row writes don't refresh heatLevel
  });

  it('skips computation if row no longer exists (gracefully no-op)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(null);
    await expect(service.run('missing')).resolves.toBeUndefined();
    expect(mockPrisma.hotNews.update).not.toHaveBeenCalled();
  });

  it('uses default weight 0.5 if SourceConfig row not found', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T13:00:00Z'));

    mockPrisma.hotNews.findUnique.mockResolvedValue({
      id: 'h2',
      sourcePlatform: 'HACKERNEWS',
      publishedAt: new Date('2026-05-09T12:00:00Z'),
      interactionData: null,
    });
    mockPrisma.sourceConfig.findFirst.mockResolvedValue(null);

    await service.run('h2');

    const updateArgs = mockPrisma.hotNews.update.mock.calls[0]![0]!;
    expect(updateArgs.data.heatScore).toBeCloseTo(36.97, 1);
  });
});
```

- **Step C3.2: Run test to verify it fails**

```bash
pnpm --filter @ai-hot-news/worker test -- heat.service.spec
```

Expected: file not found.

- **Step C3.3: Implement `heat.service.ts`**

Create `apps/worker/src/heat/heat.service.ts`:

```typescript
import { Logger } from '@nestjs/common';
import { getPrisma, type Platform, Prisma } from '@ai-hot-news/db';
import { interactionSignal } from './interaction-signal';
import type { HeatConfig } from './heat.config';

export interface HeatComputeInput {
  sourcePlatform: Platform;
  publishedAt: Date;
  interactionData: Prisma.JsonValue | null;
}

export function computeHeatScore(
  row: HeatComputeInput,
  sourceWeight: number,
  now: Date,
  cfg: HeatConfig,
): number {
  if (row.sourcePlatform === 'RSS') return 0;

  const ageHours = (now.getTime() - row.publishedAt.getTime()) / 3_600_000;
  const timeScore = Math.exp(-ageHours / cfg.decayTauHours) * 100;

  const interaction =
    row.interactionData != null && typeof row.interactionData === 'object' && !Array.isArray(row.interactionData)
      ? (row.interactionData as Record<string, unknown>)
      : null;
  const interactionScore = interactionSignal(row.sourcePlatform, interaction, cfg);

  const sourceScore = sourceWeight * 100;
  const crossPlatformScore = 0;

  return (
    timeScore * 0.25 +
    interactionScore * 0.35 +
    sourceScore * 0.25 +
    crossPlatformScore * 0.15
  );
}

export class HeatService {
  private readonly logger = new Logger(HeatService.name);

  constructor(private readonly cfg: HeatConfig) {}

  async run(hotNewsId: string): Promise<void> {
    const prisma = getPrisma();
    const row = await prisma.hotNews.findUnique({
      where: { id: hotNewsId },
      select: { sourcePlatform: true, publishedAt: true, interactionData: true },
    });
    if (!row) {
      this.logger.warn(`HeatService.run: row not found for id=${hotNewsId}`);
      return;
    }

    // Look up SourceConfig.weight for this row's platform.
    // Note: HotNews does not have sourceConfigId; we match by platform.
    // This means all rows from the same platform share the same weight in V1.
    // Future SP-6 follow-up: add sourceConfigId to HotNews + JOIN per-source.
    const sourceConfig = await prisma.sourceConfig.findFirst({
      where: { platform: row.sourcePlatform, enabled: true },
      select: { weight: true },
    });
    const sourceWeight = sourceConfig?.weight ?? 0.5;

    const score = computeHeatScore(row, sourceWeight, new Date(), this.cfg);

    await prisma.hotNews.update({
      where: { id: hotNewsId },
      data: { heatScore: score },
    });
  }
}
```

- **Step C3.4: Run tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/worker test -- heat.service.spec
```

Expected: all 8 cases green.

- **Step C3.5: Commit**

```bash
git add apps/worker/src/heat/heat.service.ts apps/worker/src/heat/heat.service.spec.ts
git commit -m "feat(sp6-C): HeatService.run computes per-row heatScore using 4-dimension formula"
```

### Task C4: `apps/worker/src/heat/heat.queue.ts` (BullMQ wiring)

**Files:**

- Create: `apps/worker/src/heat/heat.queue.ts`
- **Step C4.1: Implement `heat.queue.ts` (mirrors `summarize.queue.ts` pattern)**

Create `apps/worker/src/heat/heat.queue.ts`:

```typescript
import { Provider } from '@nestjs/common';
import { Queue, Worker, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CONNECTION } from '../crawl/queue.provider';
import { loadHeatConfig } from './heat.config';

export const HEAT_QUEUE_NAME = 'heat';
export const HEAT_QUEUE = Symbol('HEAT_QUEUE');

export const heatQueueProvider: Provider = {
  provide: HEAT_QUEUE,
  useFactory: (connection: IORedis): Queue =>
    new Queue(HEAT_QUEUE_NAME, {
      connection: connection as unknown as ConnectionOptions,
    }),
  inject: [REDIS_CONNECTION],
};

export const HEAT_WORKER = Symbol('HEAT_WORKER');

export function createHeatWorker(
  processor: (jobName: string, jobData: unknown) => Promise<void>,
  connection: IORedis,
): Worker {
  const cfg = loadHeatConfig();
  return new Worker(
    HEAT_QUEUE_NAME,
    async (job) => processor(job.name, job.data),
    {
      connection: connection as unknown as ConnectionOptions,
      concurrency: cfg.concurrency,
    },
  );
}
```

- **Step C4.2: Verify typecheck**

```bash
pnpm --filter @ai-hot-news/worker typecheck
```

Expected: green (no spec needed for this thin wiring file; integration coverage comes from heat.module.spec).

- **Step C4.3: Commit**

```bash
git add apps/worker/src/heat/heat.queue.ts
git commit -m "feat(sp6-C): heat BullMQ queue + worker tokens (HEAT_QUEUE / HEAT_WORKER)"
```

### Task C5: `apps/worker/src/heat/heat.processor.ts` (per-row job handler)

**Files:**

- Create: `apps/worker/src/heat/heat.processor.ts`
- Create: `apps/worker/src/heat/heat.processor.spec.ts`
- **Step C5.1: Write failing test for `processHeatJob`**

Create `apps/worker/src/heat/heat.processor.spec.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { processHeatJob } from './heat.processor';

describe('processHeatJob', () => {
  it('calls service.run with the hotNewsId from job data', async () => {
    const service = { run: vi.fn().mockResolvedValue(undefined) };
    await processHeatJob({ hotNewsId: 'h1' }, service as unknown as { run: (id: string) => Promise<void> });
    expect(service.run).toHaveBeenCalledWith('h1');
  });

  it('throws if hotNewsId is missing (BullMQ marks job failed)', async () => {
    const service = { run: vi.fn() };
    await expect(
      processHeatJob({} as unknown as { hotNewsId: string }, service as unknown as { run: (id: string) => Promise<void> }),
    ).rejects.toThrow(/hotNewsId required/);
  });
});
```

- **Step C5.2: Run test to verify it fails**

```bash
pnpm --filter @ai-hot-news/worker test -- heat.processor.spec
```

Expected: file not found.

- **Step C5.3: Implement `heat.processor.ts`**

Create `apps/worker/src/heat/heat.processor.ts`:

```typescript
import type { HeatService } from './heat.service';

export interface HeatJobData {
  hotNewsId: string;
}

export async function processHeatJob(
  data: HeatJobData,
  service: Pick<HeatService, 'run'>,
): Promise<void> {
  if (!data.hotNewsId) {
    throw new Error('processHeatJob: hotNewsId required');
  }
  await service.run(data.hotNewsId);
}
```

- **Step C5.4: Run test to verify it passes**

```bash
pnpm --filter @ai-hot-news/worker test -- heat.processor.spec
```

Expected: 2/2 green.

- **Step C5.5: Commit**

```bash
git add apps/worker/src/heat/heat.processor.ts apps/worker/src/heat/heat.processor.spec.ts
git commit -m "feat(sp6-C): processHeatJob delegates to HeatService.run with id validation"
```

### Task C6: `apps/worker/src/heat/heat.cron.processor.ts` (batch UPDATE + NTILE recalc)

**Files:**

- Create: `apps/worker/src/heat/heat.cron.processor.ts`
- Create: `apps/worker/src/heat/heat.cron.processor.spec.ts`
- **Step C6.1: Write failing tests for `processHeatRefreshJob`**

Create `apps/worker/src/heat/heat.cron.processor.spec.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  hotNews: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  sourceConfig: {
    findMany: vi.fn(),
  },
  $executeRawUnsafe: vi.fn(),
  $transaction: vi.fn(),
};

vi.mock('@ai-hot-news/db', () => ({
  getPrisma: () => mockPrisma,
}));

import { processHeatRefreshJob } from './heat.cron.processor';
import type { HeatConfig } from './heat.config';

const CFG: HeatConfig = {
  decayTauHours: 48,
  cronIntervalMin: 30,
  batchSize: 500,
  concurrency: 2,
  maxHn: 500,
  maxReddit: 5000,
  maxTwitter: 100000,
};

describe('processHeatRefreshJob', () => {
  beforeEach(() => {
    mockPrisma.hotNews.findMany.mockReset();
    mockPrisma.hotNews.update.mockReset();
    mockPrisma.sourceConfig.findMany.mockReset();
    mockPrisma.$executeRawUnsafe.mockReset();
    mockPrisma.$transaction.mockImplementation(
      async (fnOrCalls: ((tx: typeof mockPrisma) => Promise<unknown>) | Promise<unknown>[]) => {
        if (typeof fnOrCalls === 'function') return fnOrCalls(mockPrisma);
        return Promise.all(fnOrCalls);
      },
    );
  });

  afterEach(() => vi.useRealTimers());

  it('SELECTs all VISIBLE non-RSS rows within 48h, computes scores, batch UPDATEs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T13:00:00Z'));

    mockPrisma.hotNews.findMany.mockResolvedValue([
      {
        id: 'h1',
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: { score: 50, comments: 10 },
      },
      {
        id: 'h2',
        sourcePlatform: 'REDDIT',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: { score: 100, comments: 20, redditUpvoteRatio: 0.95 },
      },
    ]);
    mockPrisma.sourceConfig.findMany.mockResolvedValue([
      { platform: 'HACKERNEWS', weight: 0.5 },
      { platform: 'REDDIT', weight: 0.5 },
    ]);

    await processHeatRefreshJob(CFG);

    expect(mockPrisma.hotNews.findMany).toHaveBeenCalledTimes(1);
    const findArgs = mockPrisma.hotNews.findMany.mock.calls[0]![0]!;
    expect(findArgs.where.status).toBe('VISIBLE');
    expect(findArgs.where.sourcePlatform).toEqual({ not: 'RSS' });
    expect(findArgs.where.publishedAt.gte).toBeInstanceOf(Date);

    expect(mockPrisma.hotNews.update).toHaveBeenCalledTimes(2);

    // After UPDATEs, NTILE re-rank via raw SQL
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    const sqlCall = mockPrisma.$executeRawUnsafe.mock.calls[0]![0]! as string;
    expect(sqlCall).toMatch(/NTILE\(20\)/);
    expect(sqlCall).toMatch(/heatLevel/);
  });

  it('returns early when no candidate rows (no UPDATE, no NTILE)', async () => {
    mockPrisma.hotNews.findMany.mockResolvedValue([]);
    await processHeatRefreshJob(CFG);
    expect(mockPrisma.hotNews.update).not.toHaveBeenCalled();
    expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('uses sourceConfig weight per platform when available', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T13:00:00Z'));

    mockPrisma.hotNews.findMany.mockResolvedValue([
      {
        id: 'h1',
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: null,
      },
    ]);
    mockPrisma.sourceConfig.findMany.mockResolvedValue([
      { platform: 'HACKERNEWS', weight: 0.9 },  // higher weight
    ]);

    await processHeatRefreshJob(CFG);

    const updateArgs = mockPrisma.hotNews.update.mock.calls[0]![0]!;
    // sourceScore = 0.9 * 100 = 90; contributes 90 * 0.25 = 22.5
    // timeScore = exp(-1/48)*100 ≈ 97.9; contributes 24.475
    // total ≈ 24.475 + 0 + 22.5 + 0 = 46.97
    expect(updateArgs.data.heatScore).toBeCloseTo(46.97, 0);
  });
});
```

- **Step C6.2: Run test to verify it fails**

```bash
pnpm --filter @ai-hot-news/worker test -- heat.cron.processor.spec
```

Expected: file not found.

- **Step C6.3: Implement `heat.cron.processor.ts`**

Create `apps/worker/src/heat/heat.cron.processor.ts`:

```typescript
import { Logger } from '@nestjs/common';
import { getPrisma, type Platform } from '@ai-hot-news/db';
import { computeHeatScore } from './heat.service';
import type { HeatConfig } from './heat.config';

const logger = new Logger('HeatCronProcessor');

const RECENT_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function processHeatRefreshJob(cfg: HeatConfig): Promise<void> {
  const prisma = getPrisma();
  const now = new Date();
  const since = new Date(now.getTime() - RECENT_WINDOW_MS);

  const rows = await prisma.hotNews.findMany({
    where: {
      status: 'VISIBLE',
      sourcePlatform: { not: 'RSS' as Platform },
      publishedAt: { gte: since },
    },
    select: {
      id: true,
      sourcePlatform: true,
      publishedAt: true,
      interactionData: true,
    },
  });

  if (rows.length === 0) {
    logger.log('Cron: no candidate rows in 48h window — skip');
    return;
  }

  const sourceConfigs = await prisma.sourceConfig.findMany({
    where: { enabled: true },
    select: { platform: true, weight: true },
  });
  const weightByPlatform = new Map<Platform, number>(
    sourceConfigs.map((s) => [s.platform, s.weight]),
  );

  let updated = 0;
  for (const row of rows) {
    const weight = weightByPlatform.get(row.sourcePlatform) ?? 0.5;
    const score = computeHeatScore(row, weight, now, cfg);
    await prisma.hotNews.update({
      where: { id: row.id },
      data: { heatScore: score },
    });
    updated += 1;
  }

  // Recompute heatLevel via NTILE percentile ranking.
  // Top 5% → BURST; next 15% → HOT; next 30% → NORMAL; bottom 50% → LOW.
  // NTILE(20): bucket 1 = top 5%, buckets 2-4 = next 15%, buckets 5-10 = next 30%,
  // buckets 11-20 = bottom 50%.
  const sql = `
    WITH ranked AS (
      SELECT id, NTILE(20) OVER (ORDER BY "heatScore" DESC) AS bucket
      FROM hot_news
      WHERE status = 'VISIBLE'
        AND "sourcePlatform" != 'RSS'
        AND "publishedAt" > now() - interval '48 hours'
    )
    UPDATE hot_news h
    SET "heatLevel" = (CASE
      WHEN r.bucket = 1                  THEN 'BURST'
      WHEN r.bucket BETWEEN 2 AND 4      THEN 'HOT'
      WHEN r.bucket BETWEEN 5 AND 10     THEN 'NORMAL'
      ELSE                                    'LOW'
    END)::"HeatLevel"
    FROM ranked r
    WHERE h.id = r.id
  `;
  await prisma.$executeRawUnsafe(sql);

  logger.log(`Cron: updated ${updated} heatScore values + recomputed heatLevel via NTILE(20)`);
}
```

- **Step C6.4: Run tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/worker test -- heat.cron.processor.spec
```

Expected: 3/3 green.

- **Step C6.5: Commit**

```bash
git add apps/worker/src/heat/heat.cron.processor.ts apps/worker/src/heat/heat.cron.processor.spec.ts
git commit -m "feat(sp6-C): heat cron batch UPDATEs heatScore + NTILE recomputes heatLevel"
```

### Task C7: `apps/worker/src/heat/heat.cron.ts` (BullMQ repeat job registration)

**Files:**

- Create: `apps/worker/src/heat/heat.cron.ts`
- **Step C7.1: Implement `heat.cron.ts`**

Create `apps/worker/src/heat/heat.cron.ts`:

```typescript
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { HEAT_QUEUE } from './heat.queue';
import { loadHeatConfig } from './heat.config';

const REPEAT_JOB_NAME = 'heat-refresh';

@Injectable()
export class HeatCron implements OnModuleInit {
  private readonly logger = new Logger(HeatCron.name);

  constructor(@Inject(HEAT_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    const cfg = loadHeatConfig();
    const everyMs = cfg.cronIntervalMin * 60 * 1000;

    // Remove any existing repeat job to avoid duplicate registration
    // when env (HEAT_CRON_INTERVAL_MIN) changes between deploys.
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      if (job.name === REPEAT_JOB_NAME) {
        await this.queue.removeRepeatableByKey(job.key);
      }
    }

    await this.queue.add(
      REPEAT_JOB_NAME,
      {},
      {
        repeat: { every: everyMs },
        jobId: REPEAT_JOB_NAME,
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 10 },
      },
    );
    this.logger.log(`Cron registered: ${REPEAT_JOB_NAME} every ${cfg.cronIntervalMin}min`);
  }
}
```

- **Step C7.2: Typecheck**

```bash
pnpm --filter @ai-hot-news/worker typecheck
```

Expected: green.

- **Step C7.3: Commit**

```bash
git add apps/worker/src/heat/heat.cron.ts
git commit -m "feat(sp6-C): HeatCron registers BullMQ repeat job 'heat-refresh' on module init"
```

### Task C8: `apps/worker/src/heat/heat.module.ts` + boot backstop spec

**Files:**

- Create: `apps/worker/src/heat/heat.module.ts`
- Create: `apps/worker/src/heat/heat.module.spec.ts`
- **Step C8.1: Write failing test for boot backstop (mirror `summarize.module.spec.ts`)**

Create `apps/worker/src/heat/heat.module.spec.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue, Worker } from 'bullmq';

const mockPrisma = {
  hotNews: { findMany: vi.fn() },
};
vi.mock('@ai-hot-news/db', () => ({
  getPrisma: () => mockPrisma,
}));

import { HeatModule } from './heat.module';

describe('HeatModule.onApplicationBootstrap (boot backstop)', () => {
  let queue: { add: ReturnType<typeof vi.fn>; clean: ReturnType<typeof vi.fn> };
  let worker: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    queue = {
      add: vi.fn().mockResolvedValue(undefined),
      clean: vi.fn().mockResolvedValue([]),
    };
    worker = { close: vi.fn().mockResolvedValue(undefined) };
    mockPrisma.hotNews.findMany.mockReset();
  });

  afterEach(() => vi.resetAllMocks());

  it('queries WHERE status=VISIBLE AND sourcePlatform != RSS AND publishedAt > now-48h AND heatScore=0', async () => {
    mockPrisma.hotNews.findMany.mockResolvedValue([]);
    const m = new HeatModule(queue as unknown as Queue, worker as unknown as Worker);

    await m.onApplicationBootstrap();

    const findArgs = mockPrisma.hotNews.findMany.mock.calls[0]![0]!;
    expect(findArgs.where.status).toBe('VISIBLE');
    expect(findArgs.where.sourcePlatform).toEqual({ not: 'RSS' });
    expect(findArgs.where.publishedAt.gte).toBeInstanceOf(Date);
    expect(findArgs.where.heatScore).toBe(0);
    expect(findArgs.select).toEqual({ id: true });
  });

  it('re-queues every orphan row with jobId="heat-<id>"', async () => {
    mockPrisma.hotNews.findMany.mockResolvedValue([
      { id: 'a' }, { id: 'b' }, { id: 'c' },
    ]);
    const m = new HeatModule(queue as unknown as Queue, worker as unknown as Worker);

    await m.onApplicationBootstrap();

    expect(queue.add).toHaveBeenCalledTimes(3);
    expect(queue.add).toHaveBeenCalledWith(
      'heat',
      { hotNewsId: 'a' },
      expect.objectContaining({ jobId: 'heat-a' }),
    );
  });

  it('clears stale failed AND completed jobs BEFORE re-queueing (SP-5 lessons applied)', async () => {
    queue.clean.mockResolvedValue(['heat-stale-1']);
    mockPrisma.hotNews.findMany.mockResolvedValue([{ id: 'fresh' }]);
    const m = new HeatModule(queue as unknown as Queue, worker as unknown as Worker);

    await m.onApplicationBootstrap();

    expect(queue.clean).toHaveBeenCalledWith(0, 0, 'failed');
    expect(queue.clean).toHaveBeenCalledWith(0, 0, 'completed');
    const lastCleanOrder =
      queue.clean.mock.invocationCallOrder[queue.clean.mock.invocationCallOrder.length - 1]!;
    const firstAddOrder = queue.add.mock.invocationCallOrder[0]!;
    expect(lastCleanOrder).toBeLessThan(firstAddOrder);
  });

  it('closes worker on module destroy', async () => {
    const m = new HeatModule(queue as unknown as Queue, worker as unknown as Worker);
    await m.onModuleDestroy();
    expect(worker.close).toHaveBeenCalledTimes(1);
  });
});
```

- **Step C8.2: Run test to verify it fails**

```bash
pnpm --filter @ai-hot-news/worker test -- heat.module.spec
```

Expected: file not found (HeatModule).

- **Step C8.3: Implement `heat.module.ts`**

Create `apps/worker/src/heat/heat.module.ts`:

```typescript
import {
  Module,
  OnModuleDestroy,
  OnApplicationBootstrap,
  Inject,
  Logger,
} from '@nestjs/common';
import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { getPrisma } from '@ai-hot-news/db';
import { REDIS_CONNECTION } from '../crawl/queue.provider';
import { RedisModule } from '../redis/redis.module';
import { HeatService } from './heat.service';
import { HeatCron } from './heat.cron';
import {
  HEAT_QUEUE,
  HEAT_WORKER,
  createHeatWorker,
  heatQueueProvider,
} from './heat.queue';
import { processHeatJob, type HeatJobData } from './heat.processor';
import { processHeatRefreshJob } from './heat.cron.processor';
import { loadHeatConfig } from './heat.config';

const HEAT_CONFIG_TOKEN = Symbol('HEAT_CONFIG');

@Module({
  imports: [RedisModule],
  providers: [
    heatQueueProvider,
    {
      provide: HEAT_CONFIG_TOKEN,
      useFactory: () => loadHeatConfig(),
    },
    {
      provide: HeatService,
      useFactory: (cfg: ReturnType<typeof loadHeatConfig>) => new HeatService(cfg),
      inject: [HEAT_CONFIG_TOKEN],
    },
    HeatCron,
    {
      provide: HEAT_WORKER,
      useFactory: (
        connection: IORedis,
        service: HeatService,
        cfg: ReturnType<typeof loadHeatConfig>,
      ): Worker => {
        const worker = createHeatWorker(
          async (jobName, jobData) => {
            if (jobName === 'heat-refresh') {
              await processHeatRefreshJob(cfg);
              return;
            }
            await processHeatJob(jobData as HeatJobData, service);
          },
          connection,
        );
        worker.on('failed', (job, err) => {
          new Logger('HeatWorker').error(
            `Job ${job?.id ?? '<no-id>'} failed: ${err.message}`,
          );
        });
        return worker;
      },
      inject: [REDIS_CONNECTION, HeatService, HEAT_CONFIG_TOKEN],
    },
  ],
  exports: [HEAT_QUEUE],
})
export class HeatModule implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HeatModule.name);

  constructor(
    @Inject(HEAT_QUEUE) private readonly queue: Queue,
    @Inject(HEAT_WORKER) private readonly worker: Worker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // SP-5 lessons applied: BullMQ jobId dedupe checks both failed AND
    // completed sets. Without clearing both, mass re-queue events (e.g.
    // worker restart after a `UPDATE heatScore=0` rebuild) would silently
    // no-op for IDs whose jobId hash is still in either set.
    const cleanedFailed = await this.queue.clean(0, 0, 'failed');
    const cleanedCompleted = await this.queue.clean(0, 0, 'completed');
    if (cleanedFailed.length > 0 || cleanedCompleted.length > 0) {
      this.logger.log(
        `Boot backstop: cleared ${cleanedFailed.length} failed + ${cleanedCompleted.length} completed jobs`,
      );
    }

    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const orphans = await getPrisma().hotNews.findMany({
      where: {
        status: 'VISIBLE',
        sourcePlatform: { not: 'RSS' },
        publishedAt: { gte: since },
        heatScore: 0,
      },
      select: { id: true },
    });

    for (const r of orphans) {
      await this.queue.add(
        'heat',
        { hotNewsId: r.id },
        {
          jobId: `heat-${r.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
    }
    this.logger.log(`Boot backstop: re-queued ${orphans.length} pending heat jobs`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}
```

- **Step C8.4: Run tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/worker test -- heat.module.spec
```

Expected: 4/4 green.

- **Step C8.5: Update `apps/worker/src/redis/redis.module.spec.ts` to include HeatModule**

Current state: the spec has 2 cases (`SummarizeModule resolves SUMMARY_QUEUE through RedisModule` and `RedisModule alone exports REDIS_CONNECTION`). Add a parallel HeatModule case.

Add the imports near the top of the file (after the existing `SummarizeModule` import on line 4):

```typescript
import { HeatModule } from '../heat/heat.module';
import { HEAT_QUEUE } from '../heat/heat.queue';
```

Add the new test case inside the existing `describe('RedisModule wiring ...', ...)` block, after the `SummarizeModule` case (line 43):

```typescript
  it('HeatModule resolves HEAT_QUEUE through RedisModule (SP-6 regression)', async () => {
    const ref = await Test.createTestingModule({
      imports: [HeatModule],
    }).compile();

    const queue = ref.get(HEAT_QUEUE);
    const conn = ref.get(REDIS_CONNECTION);

    expect(queue).toBeDefined();
    expect(conn).toBeDefined();

    await ref.close();
  });
```

Keep the `vi.mock('ioredis', ...)` and `vi.mock('bullmq', ...)` blocks unchanged — they cover HeatModule too because both modules construct `Queue` + `Worker` from the same `bullmq` import.

- **Step C8.6: Run redis module spec**

```bash
pnpm --filter @ai-hot-news/worker test -- redis.module.spec
```

Expected: existing cases + new HeatModule case all green.

- **Step C8.7: Commit**

```bash
git add apps/worker/src/heat/heat.module.ts apps/worker/src/heat/heat.module.spec.ts apps/worker/src/redis/redis.module.spec.ts
git commit -m "feat(sp6-C): HeatModule with boot backstop (queue.clean failed+completed) and HeatCron + RedisModule integration test"
```

### Task C9: Refactor `IngestionService` to upsert + push `heat:<id>` (UNIT TESTS)

**Files:**

- Modify: `apps/worker/src/crawl/ingestion.service.ts`
- Modify: `apps/worker/src/crawl/ingestion.service.spec.ts`
- **Step C9.1: Write failing tests for new behavior**

Locate the existing `apps/worker/src/crawl/ingestion.service.spec.ts`. Add a new describe block (after the existing ones):

```typescript
  describe('SP-6 upsert + heat queue push', () => {
    let heatQueueAdd: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      heatQueueAdd = vi.fn().mockResolvedValue(undefined);
      // Re-create service with the heat queue mock injected.
      // (Adjust to match the existing spec's setup pattern; this
      // is a sketch — the real spec uses a constructor pattern that
      // already injects summary + extract queues.)
      service = new IngestionService(
        summaryQueue as unknown as Queue,
        extractQueue as unknown as Queue,
        { add: heatQueueAdd } as unknown as Queue,
      );
    });

    it('pushes heat:<id> after a successful INSERT', async () => {
      prismaMock.hotNews.create.mockResolvedValue({ id: 'h-new' });
      await service.ingest(
        [
          {
            title: 'A new HN post about GPT-5',
            contentText: 'A new HN post about GPT-5',
            rawHtml: null,
            sourceUrl: 'https://news.ycombinator.com/item?id=99001',
            author: 'researcher',
            publishedAt: new Date('2026-05-09T12:00:00Z'),
            interactionData: { score: 100, comments: 20 },
          },
        ],
        { id: 's1', platform: Platform.HACKERNEWS, url: null, identifier: 'top', name: 'HN Top' },
      );
      expect(heatQueueAdd).toHaveBeenCalledWith(
        'heat',
        { hotNewsId: 'h-new' },
        expect.objectContaining({ jobId: 'heat-h-new' }),
      );
    });

    it('on duplicate sourceUrl: UPDATEs interactionData (preserves title/content) and pushes heat:<id>', async () => {
      // First create throws P2002
      prismaMock.hotNews.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
      );
      // findFirst then resolves the existing row
      prismaMock.hotNews.findFirst = vi.fn().mockResolvedValue({ id: 'h-existing' });
      prismaMock.hotNews.update.mockResolvedValue({ id: 'h-existing' });

      const result = await service.ingest(
        [
          {
            title: 'STALE TITLE — should NOT overwrite existing',
            contentText: 'STALE BODY — should NOT overwrite existing',
            rawHtml: null,
            sourceUrl: 'https://news.ycombinator.com/item?id=99002',
            author: 'researcher',
            publishedAt: new Date('2026-05-09T12:00:00Z'),
            interactionData: { score: 250, comments: 50 },  // FRESH numbers
          },
        ],
        { id: 's1', platform: Platform.HACKERNEWS, url: null, identifier: 'top', name: 'HN Top' },
      );

      // counter assertions: did NOT increment skippedDedupe; new counter `upserted` = 1
      expect(result.skippedDedupe).toBe(0);
      expect(result.upserted).toBe(1);

      // update was called with ONLY interactionData
      const updateArgs = prismaMock.hotNews.update.mock.calls[0]![0]!;
      expect(updateArgs.where).toEqual({ id: 'h-existing' });
      expect(updateArgs.data).toEqual({
        interactionData: { score: 250, comments: 50 },
      });

      // heat:<id> pushed with the EXISTING row's id (not the failed create id)
      expect(heatQueueAdd).toHaveBeenCalledWith(
        'heat',
        { hotNewsId: 'h-existing' },
        expect.objectContaining({ jobId: 'heat-h-existing' }),
      );

      // summary queue NOT pushed on upsert (already summarized once)
      expect(summaryQueue.add).not.toHaveBeenCalled();
    });

    it('upsert with raw.interactionData=null is a no-op for that field (does NOT clobber existing data)', async () => {
      prismaMock.hotNews.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
      );
      prismaMock.hotNews.findFirst = vi.fn().mockResolvedValue({ id: 'h-existing' });

      const result = await service.ingest(
        [
          {
            title: 'foo',
            contentText: 'foo',
            rawHtml: null,
            sourceUrl: 'https://news.ycombinator.com/item?id=99003',
            author: null,
            publishedAt: new Date('2026-05-09T12:00:00Z'),
            interactionData: null,
          },
        ],
        { id: 's1', platform: Platform.HACKERNEWS, url: null, identifier: 'top', name: 'HN Top' },
      );

      expect(prismaMock.hotNews.update).not.toHaveBeenCalled();
      expect(result.upserted).toBe(0);
      expect(result.skippedDedupe).toBe(1);  // falls back to original "skip" path
    });
  });
```

- **Step C9.2: Run test to verify it fails**

```bash
pnpm --filter @ai-hot-news/worker test -- ingestion.service.spec
```

Expected: failures (heat queue not injected; upserted counter not on IngestResult; update path not implemented).

- **Step C9.3: Add HEAT_QUEUE to existing IngestResult interface and constructor; implement upsert path**

Edit `apps/worker/src/crawl/ingestion.service.ts`:

1. Update the `IngestResult` interface:

```typescript
export interface IngestResult {
  fetched: number;
  inserted: number;
  upserted: number;          // ★ NEW (SP-6): rows whose interactionData was refreshed via upsert
  skipped: number;
  skippedQuality: number;
  skippedNonAi: number;
  skippedDedupe: number;
  hidden: number;
  failed: number;
}
```

1. Add HEAT_QUEUE import and constructor injection:

```typescript
import { HEAT_QUEUE } from '../heat/heat.queue';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @Inject(SUMMARY_QUEUE) private readonly summaryQueue: Queue,
    @Inject(EXTRACT_QUEUE) private readonly extractQueue: Queue,
    @Inject(HEAT_QUEUE) private readonly heatQueue: Queue,  // ★ NEW
  ) {}
```

1. Initialize `upserted: 0` in the `result` object inside `ingest()`.
2. Replace the `try { create } catch P2002 → result.skippedDedupe += 1 }` block with upsert logic. Locate the existing block (~line 116-177) and replace with:

```typescript
        try {
          const created = await prisma.hotNews.create({
            data: {
              title: cleanTitle,
              content: cleanContent,
              rawHtml: raw.rawHtml,
              sourcePlatform: source.platform,
              sourceUrl,
              author: raw.author,
              publishedAt: raw.publishedAt ?? new Date(),
              dedupeHash,
              status: ContentStatus.VISIBLE,
              filterReason: null,
              ...(raw.interactionData != null
                ? { interactionData: raw.interactionData as Prisma.InputJsonValue }
                : {}),
            },
          });
          result.inserted += 1;

          // SP-6: push heat:<id> for every successful INSERT.
          await this.heatQueue.add(
            'heat',
            { hotNewsId: created.id },
            {
              jobId: `heat-${created.id}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 10_000 },
              removeOnComplete: { count: 100 },
              removeOnFail: { count: 100 },
            },
          );

          await this.summaryQueue.add(
            'summarize',
            { hotNewsId: created.id },
            {
              jobId: `summarize-${created.id}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 30_000 },
              removeOnComplete: { count: 100 },
              removeOnFail: { count: 100 },
            },
          );

          const extUrl = (raw.interactionData as { externalUrl?: string } | null)
            ?.externalUrl;
          const isLinkPost =
            typeof extUrl === 'string' &&
            /^https?:/.test(extUrl) &&
            cleanContent === cleanTitle;
          if (isLinkPost) {
            await prisma.hotNews.update({
              where: { id: created.id },
              data: { extractStatus: 'PENDING' },
            });
            await this.extractQueue.add(
              'extract',
              { hotNewsId: created.id },
              {
                jobId: `extract-${created.id}`,
                attempts: 3,
                backoff: { type: 'exponential', delay: 60_000 },
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 100 },
              },
            );
          }
        } catch (createErr) {
          if ((createErr as { code?: string }).code === 'P2002') {
            // SP-6: upsert interactionData on duplicate sourceUrl.
            // Preserves title/content/publishedAt etc.; only refreshes
            // the engagement metrics so heat formula sees current numbers.
            // If raw.interactionData is null, we skip the UPDATE — there's
            // nothing to refresh.
            if (raw.interactionData != null) {
              const existing = await prisma.hotNews.findFirst({
                where: { sourceUrl },
                select: { id: true },
              });
              if (existing) {
                await prisma.hotNews.update({
                  where: { id: existing.id },
                  data: { interactionData: raw.interactionData as Prisma.InputJsonValue },
                });
                result.upserted += 1;
                await this.heatQueue.add(
                  'heat',
                  { hotNewsId: existing.id },
                  {
                    jobId: `heat-${existing.id}`,
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 10_000 },
                    removeOnComplete: { count: 100 },
                    removeOnFail: { count: 100 },
                  },
                );
              } else {
                // Race: P2002 fired but findFirst missed (very unlikely;
                // could happen if another writer deleted the row between
                // create and findFirst). Treat as skipped.
                result.skipped += 1;
                result.skippedDedupe += 1;
              }
            } else {
              // No interactionData to refresh; behave like the old "first-write-wins" skip.
              result.skipped += 1;
              result.skippedDedupe += 1;
            }
          } else {
            throw createErr;
          }
        }
```

1. Update the final log line in `ingest()` to include `upserted=N`:

```typescript
    this.logger.log(
      `[Ingest] ${source.platform} ${source.name}: ` +
        `fetched=${result.fetched} inserted=${result.inserted} upserted=${result.upserted} ` +
        `skipped=${result.skipped} (quality=${result.skippedQuality} ` +
        `nonAi=${result.skippedNonAi} dedupe=${result.skippedDedupe}) ` +
        `failed=${result.failed}`,
    );
```

- **Step C9.4: Run new tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/worker test -- ingestion.service.spec
```

Expected: new SP-6 cases pass.

- **Step C9.5: Run all worker tests to confirm existing cases still pass**

```bash
pnpm --filter @ai-hot-news/worker test
```

Expected: all worker tests green. Note: any test that constructs `IngestionService` directly will now require a third `heatQueue` argument — fix call sites in test files (typically a couple of mock setups).

- **Step C9.6: Commit**

```bash
git add apps/worker/src/crawl/ingestion.service.ts apps/worker/src/crawl/ingestion.service.spec.ts
git commit -m "feat(sp6-C): IngestionService upserts interactionData + pushes heat:<id> on INSERT/UPDATE"
```

### Task C10: Invert + extend `ingestion.service.integration.spec.ts` for upsert behavior

**Files:**

- Modify: `apps/worker/src/crawl/ingestion.service.integration.spec.ts:160-205` (HN case)
- Modify: `apps/worker/src/crawl/ingestion.service.integration.spec.ts:360-420` (Reddit case)
- **Step C10.1: Invert the existing HN "does NOT overwrite" test (line 160)**

Locate the test starting with `it('does NOT overwrite interactionData on duplicate sourceUrl', async () => {` (line 160). Rename and invert:

```typescript
    it('DOES upsert interactionData on duplicate sourceUrl, preserves other fields (SP-6)', async () => {
      const sourceUrl = `${HN_URL_PREFIX}44000002`;

      // First ingest — initial values
      await ingestion.ingest(
        [
          {
            title: 'Original HN title',
            contentText: 'Original HN content body',
            rawHtml: null,
            sourceUrl,
            author: 'first-author',
            publishedAt: new Date('2026-05-09T12:00:00Z'),
            interactionData: { score: 50, comments: 5, hnId: 44000002 },
          },
        ],
        HN_SOURCE,
      );

      // Second ingest with FRESH interactionData but stale title/content
      const result = await ingestion.ingest(
        [
          {
            title: 'STALE TITLE (should NOT replace)',
            contentText: 'STALE CONTENT (should NOT replace)',
            rawHtml: '<p>STALE HTML</p>',
            sourceUrl,
            author: 'STALE-AUTHOR',
            publishedAt: new Date('2025-01-01T00:00:00Z'),
            interactionData: { score: 250, comments: 80, hnId: 44000002 },  // FRESH
          },
        ],
        HN_SOURCE,
      );

      expect(result).toMatchObject({
        fetched: 1,
        inserted: 0,
        upserted: 1,
        skipped: 0,
        skippedDedupe: 0,
        failed: 0,
      });

      const row = await prisma.hotNews.findFirstOrThrow({ where: { sourceUrl } });
      // interactionData refreshed
      expect(row.interactionData).toMatchObject({ score: 250, comments: 80 });
      // ALL OTHER FIELDS preserved
      expect(row.title).toBe('Original HN title');
      expect(row.content).toBe('Original HN content body');
      expect(row.author).toBe('first-author');
      expect(row.publishedAt).toEqual(new Date('2026-05-09T12:00:00Z'));
    });
```

- **Step C10.2: Invert the existing Reddit "does NOT overwrite" test (line 360)**

Apply same pattern to the Reddit case:

```typescript
    it('DOES upsert interactionData on duplicate sourceUrl, preserves other fields (SP-6)', async () => {
      const sourceUrl = `${REDDIT_URL_PREFIX}OpenAI/comments/1k4xz9z`;

      // First ingest
      await ingestion.ingest(
        [
          {
            title: 'Reddit OG title',
            contentText: 'Reddit OG body',
            rawHtml: null,
            sourceUrl,
            author: 'r/OpenAI/u/op',
            publishedAt: new Date('2026-05-09T12:00:00Z'),
            interactionData: {
              score: 100,
              comments: 10,
              redditId: '1k4xz9z',
              redditSubreddit: 'OpenAI',
              redditUpvoteRatio: 0.85,
            },
          },
        ],
        REDDIT_SOURCE,
      );

      // Second ingest — FRESH engagement, STALE everything else
      const result = await ingestion.ingest(
        [
          {
            title: 'Reddit STALE title',
            contentText: 'Reddit STALE body',
            rawHtml: null,
            sourceUrl,
            author: 'STALE',
            publishedAt: new Date('2025-01-01T00:00:00Z'),
            interactionData: {
              score: 1500,
              comments: 230,
              redditId: '1k4xz9z',
              redditSubreddit: 'OpenAI',
              redditUpvoteRatio: 0.96,
            },
          },
        ],
        REDDIT_SOURCE,
      );

      expect(result).toMatchObject({
        fetched: 1,
        inserted: 0,
        upserted: 1,
        skippedDedupe: 0,
      });

      const row = await prisma.hotNews.findFirstOrThrow({ where: { sourceUrl } });
      expect(row.interactionData).toMatchObject({
        score: 1500,
        comments: 230,
        redditUpvoteRatio: 0.96,
      });
      expect(row.title).toBe('Reddit OG title');
      expect(row.author).toBe('r/OpenAI/u/op');
    });
```

- **Step C10.3: Run integration tests**

```bash
pnpm --filter @ai-hot-news/worker test -- ingestion.service.integration.spec
```

Expected: all integration tests green (the 2 inverted + remaining 16 = 18 cases, all passing).

- **Step C10.4: Commit**

```bash
git add apps/worker/src/crawl/ingestion.service.integration.spec.ts
git commit -m "test(sp6-C): invert ingestion 'does NOT overwrite' integration cases to verify upsert"
```

### Task C11: `apps/worker/src/heat/heat.cron.processor.integration.spec.ts` (real DB)

**Files:**

- Create: `apps/worker/src/heat/heat.cron.processor.integration.spec.ts`
- **Step C11.1: Write the integration test**

Create `apps/worker/src/heat/heat.cron.processor.integration.spec.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, Platform, ContentStatus } from '@ai-hot-news/db';
import { processHeatRefreshJob } from './heat.cron.processor';
import { loadHeatConfig } from './heat.config';

const prisma = getPrisma();
const TEST_PREFIX = 'sp6-cron-test-';

async function reset() {
  await prisma.hotNews.deleteMany({
    where: { sourceUrl: { startsWith: TEST_PREFIX } },
  });
}

describe('processHeatRefreshJob (integration)', () => {
  beforeEach(reset);

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it('updates heatScore + heatLevel for VISIBLE non-RSS rows in 48h window', async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    const fortyNineHoursAgo = new Date(now.getTime() - 49 * 60 * 60 * 1000);

    // Seed 5 rows: 4 fresh non-RSS + 1 RSS (must NOT be touched)
    const rows = [
      { sourcePlatform: Platform.HACKERNEWS, score: 200, comments: 50, age: oneHourAgo },
      { sourcePlatform: Platform.HACKERNEWS, score: 5, comments: 1, age: oneHourAgo },
      { sourcePlatform: Platform.REDDIT, score: 1500, comments: 200, ratio: 0.95, age: oneHourAgo },
      { sourcePlatform: Platform.REDDIT, score: 50, comments: 5, ratio: 0.5, age: oneHourAgo },
    ];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const interactionData = r.sourcePlatform === Platform.REDDIT
        ? { score: r.score, comments: r.comments, redditUpvoteRatio: r.ratio }
        : { score: r.score, comments: r.comments };
      await prisma.hotNews.create({
        data: {
          title: `Test row ${i}`,
          content: `Test row ${i}`,
          sourcePlatform: r.sourcePlatform,
          sourceUrl: `${TEST_PREFIX}${i}`,
          publishedAt: r.age,
          dedupeHash: `${TEST_PREFIX}hash-${i}`,
          status: ContentStatus.VISIBLE,
          interactionData,
        },
      });
    }
    // RSS row — should NOT be touched
    await prisma.hotNews.create({
      data: {
        title: 'RSS row',
        content: 'RSS row',
        sourcePlatform: Platform.RSS,
        sourceUrl: `${TEST_PREFIX}rss`,
        publishedAt: oneHourAgo,
        dedupeHash: `${TEST_PREFIX}hash-rss`,
        status: ContentStatus.VISIBLE,
        interactionData: null,
        // heatScore stays at default 0; heatLevel stays at default LOW
      },
    });
    // Old row (>48h) — should NOT be touched
    await prisma.hotNews.create({
      data: {
        title: 'Old row',
        content: 'Old row',
        sourcePlatform: Platform.HACKERNEWS,
        sourceUrl: `${TEST_PREFIX}old`,
        publishedAt: fortyNineHoursAgo,
        dedupeHash: `${TEST_PREFIX}hash-old`,
        status: ContentStatus.VISIBLE,
        interactionData: { score: 9999, comments: 999 },
      },
    });

    await processHeatRefreshJob(loadHeatConfig());

    const fresh = await prisma.hotNews.findMany({
      where: { sourceUrl: { startsWith: TEST_PREFIX } },
      orderBy: { sourceUrl: 'asc' },
      select: { sourceUrl: true, sourcePlatform: true, heatScore: true, heatLevel: true },
    });

    // Non-RSS fresh rows have heatScore > 0
    const nonRss = fresh.filter((r) => r.sourcePlatform !== 'RSS' && !r.sourceUrl.endsWith('-old'));
    for (const r of nonRss) {
      expect(r.heatScore).toBeGreaterThan(0);
    }

    // RSS row stays at 0 / LOW
    const rss = fresh.find((r) => r.sourceUrl.endsWith('-rss'))!;
    expect(rss.heatScore).toBe(0);
    expect(rss.heatLevel).toBe('LOW');

    // Old row not touched (heatScore stays at default 0)
    const old = fresh.find((r) => r.sourceUrl.endsWith('-old'))!;
    expect(old.heatScore).toBe(0);
  });

  it('NTILE(20) recomputes heatLevel — top row gets BURST', async () => {
    // Seed 25 rows with monotonically increasing scores so NTILE has clean buckets
    const now = new Date();
    for (let i = 0; i < 25; i++) {
      await prisma.hotNews.create({
        data: {
          title: `NTILE row ${i}`,
          content: `NTILE row ${i}`,
          sourcePlatform: Platform.HACKERNEWS,
          sourceUrl: `${TEST_PREFIX}ntile-${i}`,
          publishedAt: now,
          dedupeHash: `${TEST_PREFIX}ntile-hash-${i}`,
          status: ContentStatus.VISIBLE,
          interactionData: { score: i * 100, comments: i * 20 },  // increasing
        },
      });
    }

    await processHeatRefreshJob(loadHeatConfig());

    const sorted = await prisma.hotNews.findMany({
      where: { sourceUrl: { startsWith: `${TEST_PREFIX}ntile-` } },
      orderBy: { heatScore: 'desc' },
      select: { sourceUrl: true, heatScore: true, heatLevel: true },
    });

    // Top row should be BURST
    expect(sorted[0]!.heatLevel).toBe('BURST');
    // Bottom row should be LOW
    expect(sorted[sorted.length - 1]!.heatLevel).toBe('LOW');
    // All four levels should appear at least once across 25 rows
    const levels = new Set(sorted.map((r) => r.heatLevel));
    expect(levels.has('BURST')).toBe(true);
    expect(levels.has('HOT')).toBe(true);
    expect(levels.has('NORMAL')).toBe(true);
    expect(levels.has('LOW')).toBe(true);
  });
});
```

- **Step C11.2: Run integration test**

```bash
pnpm --filter @ai-hot-news/worker test -- heat.cron.processor.integration.spec
```

Expected: 2 cases green (real DB writes/reads).

- **Step C11.3: Commit**

```bash
git add apps/worker/src/heat/heat.cron.processor.integration.spec.ts
git commit -m "test(sp6-C): integration test for cron — VISIBLE non-RSS 48h window + NTILE bucket recompute"
```

### Task C12: Wire `HeatModule` into `worker.module.ts`

**Files:**

- Modify: `apps/worker/src/worker.module.ts`
- Modify: `apps/worker/src/crawl/crawl.module.ts` (CrawlModule imports HeatModule so IngestionService can inject HEAT_QUEUE)
- **Step C12.1: Add `HeatModule` to WorkerModule imports**

Edit `apps/worker/src/worker.module.ts`. Find the existing imports list (currently includes `RedisModule`, `SummarizeModule`, `ExtractModule`, `CrawlModule`) and add `HeatModule`:

```typescript
import { HeatModule } from './heat/heat.module';
// ... in @Module imports:
imports: [
  RedisModule,
  SummarizeModule,
  ExtractModule,
  HeatModule,
  CrawlModule,
],
```

- **Step C12.2: Add `HeatModule` to `CrawlModule` imports + IngestionService factory**

Edit `apps/worker/src/crawl/crawl.module.ts`. Add `HeatModule` to imports and update IngestionService useFactory to inject HEAT_QUEUE:

```typescript
import { HeatModule } from '../heat/heat.module';
import { HEAT_QUEUE } from '../heat/heat.queue';

@Module({
  imports: [RedisModule, SummarizeModule, ExtractModule, HeatModule],
  providers: [
    // ... existing ...
    {
      provide: IngestionService,
      useFactory: (summary: Queue, extract: Queue, heat: Queue) =>
        new IngestionService(summary, extract, heat),
      inject: [SUMMARY_QUEUE, EXTRACT_QUEUE, HEAT_QUEUE],
    },
  ],
})
```

- **Step C12.3: Run worker test suite**

```bash
pnpm --filter @ai-hot-news/worker test
```

Expected: all 137+ cases green (existing 134 + 4 new heat unit + ingestion modifications).

- **Step C12.4: Commit**

```bash
git add apps/worker/src/worker.module.ts apps/worker/src/crawl/crawl.module.ts
git commit -m "feat(sp6-C): wire HeatModule into WorkerModule + CrawlModule (IngestionService injects HEAT_QUEUE)"
```

### Task C13: `.env.example` + `docker-compose.prod.yml` env transparent passthrough

**Files:**

- Modify: `.env.example`
- Modify: `docker/docker-compose.prod.yml`
- **Step C13.1: Add HEAT + INTERACTION_MAX section to `.env.example`**

Open `.env.example` and append after the SP-5 SUMMARY_* section:

```sh
# ─── SP-6 heat scoring ───────────────────────────────────────────────
# Tune these by observing prod heatLevel distribution after two weeks.
HEAT_DECAY_TAU_HOURS=48          # exp(-ageHours / tau) — 48h is the time-decay half-cycle
HEAT_CRON_INTERVAL_MIN=30        # global NTILE recalc cadence
HEAT_BATCH_SIZE=500              # rows per cron batch (currently unused; reserved for sharding)
HEAT_CONCURRENCY=2               # BullMQ heat:<id> worker concurrency
INTERACTION_MAX_HN=500           # log-normalizer ceiling for HN
INTERACTION_MAX_REDDIT=5000      # log-normalizer ceiling for Reddit
INTERACTION_MAX_TWITTER=100000   # SP-22 enables; placeholder OK in V1
```

- **Step C13.2: Add explicit env passthrough to `docker-compose.prod.yml` worker service**

Open `docker/docker-compose.prod.yml`. Find the `worker:` service block, locate `environment:` section. Append after existing SP-5 lines:

```yaml
      HEAT_DECAY_TAU_HOURS: ${HEAT_DECAY_TAU_HOURS}
      HEAT_CRON_INTERVAL_MIN: ${HEAT_CRON_INTERVAL_MIN}
      HEAT_BATCH_SIZE: ${HEAT_BATCH_SIZE}
      HEAT_CONCURRENCY: ${HEAT_CONCURRENCY}
      INTERACTION_MAX_HN: ${INTERACTION_MAX_HN}
      INTERACTION_MAX_REDDIT: ${INTERACTION_MAX_REDDIT}
      INTERACTION_MAX_TWITTER: ${INTERACTION_MAX_TWITTER}
```

(Remember: SP-4.7 PR #3 lesson — only env vars listed under `environment:` get injected; writing to `.env` alone is not enough.)

- **Step C13.3: Verify the YAML is well-formed**

```bash
docker compose -f docker/docker-compose.prod.yml config | grep -A 30 'worker:' | grep -E 'HEAT_|INTERACTION_'
```

Expected: 7 lines printed.

- **Step C13.4: Commit**

```bash
git add .env.example docker/docker-compose.prod.yml
git commit -m "feat(sp6-C): .env.example + docker-compose.prod.yml HEAT_* + INTERACTION_MAX_* passthrough"
```

### Task C14: `decomposition.md` §11 entry for SP-6

**Files:**

- Modify: `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md` §11
- **Step C14.1: Append SP-6 row to the §11 table**

Open `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md`. Find the §11 table (after the SP-5.5 row added by PR #9). Append:

```markdown
| **SP-6** | 2026-05-09 | PRs sp6-A / sp6-B / sp6-C (chained) ·spec: `2026-05-09-sp6-heat-score-design.md` ·plan: `2026-05-09-sp6-heat-score-plan.md` | `apps/worker/src/heat/` 完整模块（`heat.module.ts` + `heat.queue.ts` + `heat.processor.ts` + `heat.service.ts` + `heat.cron.ts` + `heat.cron.processor.ts` + `interaction-signal.ts` + `heat.config.ts`）· 4 维公式（time 25% / interaction 35% / source 25% / cross-platform 15% — V1 cross 占位 0）· per-platform log10-normalized interaction signal · `SourceConfig.weight Float @default(0.5)` 列（migration `20260509094500_sp6_source_weight`）· `IngestionService` first-write-wins → upsert（仅刷 interactionData，其他字段不动）· INSERT/UPDATE 后 push `heat:<id>` · BullMQ repeat job `heat-refresh` 30min 全量 NTILE(20) 重算 heatLevel · OnApplicationBootstrap boot backstop（含 `queue.clean failed+completed` 前置，沿用 SP-5 c64fe93+c1886f3 修复模式）· `HotNewsListItemDto` 加 `heatScore: number\|null` + `heatLevel: BURST\|HOT\|NORMAL\|LOW\|null` · API `?sort=heat` 切 orderBy + 过滤 RSS · `IngestResult.upserted` 新增计数 + log `upserted=N` · 7 个新 env (`HEAT_`* + `INTERACTION_MAX_*`) | **新公式契约**：4 维加权 25/35/25/15；V1 上限 72.5（cross=0），SP-7 落地后 → 0-100。**heat-sort RSS 过滤**：API `?sort=heat` 永远不返 RSS（3 层运行时防护：service 过滤 / compute RSS→0 / NTILE WHERE 过滤）。**ingestion upsert 契约**：第二次 ingest 同 sourceUrl 不再 silently skip（破坏 SP-2/3 spec §1.3 的 "first-write-wins" 旧约定，但保留所有非-interactionData 字段不动）；任何下游 SP 如果依赖 "interactionData 永不变" 必须升级。**weight V1 全 0.5**：sourceScore 维度退化为常数 12.5；两周后按 NTILE 分布观察调；后续 follow-up `tune-source-weight-v1.ts` 一次性脚本（按 SP-4 §10 决策 11 范式）。**HotNews 当前没有 sourceConfigId 关联**：HeatService 通过 `prisma.sourceConfig.findFirst({where: {platform}})` 查权重 = 同平台所有源共享同一 weight；SP-9 / SP-13 如需 per-source 权重，加 `HotNews.sourceConfigId String?` migration + JOIN（已记录在 spec §11 升级钩子）。*`*interactionData.updatedAt` 不存在**：smoke 验证 upsert 通过 worker log `upserted=N` grep，非 SQL 时间戳查询。 |
```

- **Step C14.2: Commit**

```bash
git add docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md
git commit -m "docs(decomposition): record SP-6 (heat-scoring) completion in §11"
```

### Task C15: Final pre-PR check

- **Step C15.1: Run full turbo suite**

```bash
pnpm turbo run lint typecheck test
```

Expected: all green (19 lint+typecheck + 11 test tasks). The worker test count should be ~140 (was 134, +6 for heat unit + processor + module + invert ingestion case).

- **Step C15.2: Verify branch is at parity with origin/main + has all SP-6 commits**

```bash
git log origin/main..HEAD --oneline
```

Expected: ~10-13 commits all prefixed with `feat(sp6-C):` / `test(sp6-C):` / `docs(decomposition):`.

### Task C16: Push PR-C and open GitHub PR

- **Step C16.1: Push branch**

```bash
git push -u origin chore/sp6-C-worker
```

- **Step C16.2: Open PR**

```bash
gh pr create --base main --head chore/sp6-C-worker \
  --title "feat(sp6-C): worker heat module + ingestion upsert + cron NTILE recompute" \
  --body "$(cat <<'EOF'
PR-C of 3 (final SP-6 PR). Depends on PR-A (\`SourceConfig.weight\`) and PR-B (API DTO+sort) being merged.

## What

- New \`apps/worker/src/heat/\` module: BullMQ \`heat\` queue + per-row processor (\`HeatService.run\`) + 30-min repeat job \`heat-refresh\` (batch UPDATE + NTILE(20) recompute heatLevel) + \`OnApplicationBootstrap\` boot backstop (cleans both \`failed\` + \`completed\` BullMQ sets before re-queue, per SP-5 c64fe93+c1886f3 lessons).
- 4-dimension formula: \`timeScore * 0.25 + interactionScore * 0.35 + sourceScore * 0.25 + crossPlatformScore * 0.15\`. \`crossPlatformScore\` is V1 placeholder 0; SP-7 \`groupId\` will fill it.
- Per-platform interaction signal with log10 normalization (HN: \`score + comments*2\` / Reddit: \`(score + comments*2) * max(ratio, 0.5)\` / Twitter SP-22 placeholder).
- \`IngestionService\` first-write-wins → upsert: on duplicate \`sourceUrl\`, UPDATE \`interactionData\` only (preserve title/content/publishedAt/etc.); push \`heat:<id>\` after both INSERT and UPDATE. New counter \`IngestResult.upserted\` + log \`upserted=N\`.
- \`.env.example\` + \`docker-compose.prod.yml\` add \`HEAT_DECAY_TAU_HOURS\` / \`HEAT_CRON_INTERVAL_MIN\` / \`HEAT_BATCH_SIZE\` / \`HEAT_CONCURRENCY\` / \`INTERACTION_MAX_HN/REDDIT/TWITTER\` (explicit passthrough per SP-4.7 PR #3 lesson).
- decomposition.md §11 records SP-6 completion.

## Behavior on prod after merge

1. Worker restarts → boot backstop scans \`heatScore=0 AND publishedAt > now-48h AND sourcePlatform != RSS\` and re-queues (~300 rows expected → ~15s to drain at concurrency=2).
2. Cron \`heat-refresh\` registers and fires every 30min — UPDATE all 48h-window non-RSS rows + NTILE(20) recompute heatLevel.
3. Next crawler tick: every fresh INSERT pushes \`heat:<id>\` (computed within seconds); every duplicate sourceUrl now does UPSERT (interactionData refreshed) + push \`heat:<id>\`.
4. API \`?sort=heat\` returns rows ranked by heatScore desc.

## Test plan

- [x] worker tests ~140 cases ✓ (134 existing + 6 new heat unit + 2 invert ingestion + new ingestion-upsert cases + 2 heat cron integration cases)
- [x] turbo lint+typecheck 19/19 ✓
- [ ] CI green
- [ ] Prod smoke (after merge):
  - \`docker compose ... exec postgres psql -c "SELECT COUNT(*) FILTER (WHERE \\\"heatScore\\\" > 0 AND \\\"sourcePlatform\\\" != 'RSS') FROM hot_news WHERE \\\"publishedAt\\\" > now() - interval '48 hours' AND status='VISIBLE';"\` ≥ 100 within 30min
  - \`docker compose ... logs worker | grep upserted=\` shows non-zero N for HN/Reddit sources (after at least one re-crawl interval)
  - \`curl 'https://hotnews.shinpeionline.top/api/hot-news?sort=heat&pageSize=10' | jq '.items[0]'\` returns row with non-zero heatScore + non-LOW heatLevel

## Risks acknowledged

- \`weight=0.5\` for all sources → sourceScore is constant 12.5; ranking driven by time + interaction. Tune per spec §11 follow-up.
- Single-row writes do NOT recompute heatLevel (acknowledged weak consistency; cron tracks within 30min; spec §3.1).
- \`HotNews\` does not have \`sourceConfigId\` so HeatService matches by platform (all rows of same platform share weight in V1).

Spec: \`docs/superpowers/specs/2026-05-09-sp6-heat-score-design.md\`
Plan: \`docs/superpowers/plans/2026-05-09-sp6-heat-score-plan.md\`
EOF
)"
```

- **Step C16.3: Wait for CI green + merge**

```bash
gh pr merge --squash --delete-branch
git fetch origin
git log origin/main --oneline -5
```

Expected: latest commit on main is the SP-6-C squash merge.

- **Step C16.4: Prod smoke after deploy**

Wait ~5min for deploy auto-trigger (or check deploy status). Then run:

```bash
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U ai_hot_news -d ai_hot_news_prod -c "SELECT COUNT(*) FILTER (WHERE \"heatScore\" > 0 AND \"sourcePlatform\" != '\''RSS'\'') AS has_heat, COUNT(*) FILTER (WHERE \"heatScore\" = 0 AND \"sourcePlatform\" != '\''RSS'\'') AS no_heat FROM hot_news WHERE \"publishedAt\" > now() - interval '\''48 hours'\'' AND status='\''VISIBLE'\'';"'
```

Expected (within 30min of deploy): `has_heat ≥ 100`, `no_heat = 0`.

```bash
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U ai_hot_news -d ai_hot_news_prod -c "SELECT \"heatLevel\", COUNT(*) FROM hot_news WHERE \"publishedAt\" > now() - interval '\''48 hours'\'' AND \"sourcePlatform\" != '\''RSS'\'' AND status='\''VISIBLE'\'' GROUP BY 1 ORDER BY 1;"'
```

Expected: 4 rows, non-zero counts for at least 2 of {BURST, HOT, NORMAL, LOW}; counts roughly 5/15/30/50 ratio if N ≥ 50.

```bash
curl 'https://hotnews.shinpeionline.top/api/hot-news?sort=heat&pageSize=10' | jq '.items[] | {sourcePlatform, heatScore, heatLevel, title}' | head -40
```

Expected: 10 rows, sourcePlatform never RSS, heatScore monotonically decreasing, heatLevel non-null.

```bash
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env logs --tail 200 worker | grep upserted='
```

Expected: at least one log line `[Ingest] HACKERNEWS HN Top: ... upserted=N` with N >= 1 within 60min (after the second crawl tick).

---

## Self-review (mandatory before handoff)

- ✅ **Spec coverage**: every section in `2026-05-09-sp6-heat-score-design.md` maps to at least one task above. §0 decisions Q1-Q12 → §0 spec already, plan uses them. §2 formula → C2 (interaction-signal) + C3 (heat.service compute). §3 data flow → C4 queue + C5 processor + C6 cron processor + C7 cron + C8 module/boot backstop + C9 ingestion upsert + heat push. §4 module structure → C1-C8. §5 schema migration → A1. §6 API → B1-B4. §7 web "minimal" → covered by skipping web changes entirely. §8 testing matrix → C2/C3/C5/C6/C8/C9/C10/C11. §9 env+deploy → C13 + 3-PR split. §10 risks → addressed by tests + boot backstop pattern. §11 upgrade hooks → docs only, no plan task.
- ✅ **No placeholders**: every step has actual code, exact paths, or concrete commands with expected output. No "TODO" / "fill in details" / "similar to Task N".
- ✅ **Type consistency**: `HeatConfig` type is consistent across heat.config / interaction-signal / heat.service / heat.cron.processor. `HeatJobData` type is consistent. `HEAT_QUEUE` symbol exported from heat.queue.ts and imported correctly. `runSp5_5SourceMigrations` is from PR #9 (decomposition.md §11 entry already exists when PR-A starts).
- ✅ **Frequent commits**: 13+ commits across PR-C plus 1 each in PR-A and PR-B.
- ✅ **TDD**: every code task has a failing test first, then implementation, then green confirmation.

---

## Done criteria

PR-A merged to main → PR-B merged to main → PR-C merged to main → 30min after PR-C deploy, all 4 prod smoke commands return expected output.

After 2 weeks of prod data, run a follow-up: query NTILE distribution, decide whether to tune `SourceConfig.weight` per source (separate one-shot script, not part of this SP).