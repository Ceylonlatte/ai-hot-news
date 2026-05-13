# SP-7 pgvector Cross-Platform Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让"同一事件的多平台报道"在 `/news` 列表上可视化合并。新增 `apps/worker/src/embed/` 模块（OpenAI `text-embedding-3-small`、1536 维），SP-5 摘要完成后自动 push `embed:<id>`，EmbedService 拿到 row 后写 embedding + 跑 GroupService 用 pgvector 余弦相似度 + tag 加成 + 7d 候选窗口分配 `groupId`。API 在 `findMany` 后用单次 `groupBy` 聚合 `groupSize`，Web 列表卡片底部渲染 `🔗 N 个平台报道` badge。一次性 backfill 脚本把历史 165 行 embedding 灌入 + 建 ivfflat 索引。

**Architecture:** 2 个独立 PR-α / PR-β 串行（α 是 backend full-stack，β 是 API+UI 暴露）：
- **PR-α** `feat/sp7-A-embed-worker` — 新模块 + SP-5 push hook + backfill 脚本 + env 透传 + ivfflat index migration（可选）。落地后 prod 已开始算 embedding + groupId，但 API/UI 还看不见。
- **PR-β** `feat/sp7-B-api-ui` — DTO `groupId/groupSize`、`HotNewsService.list()` `groupBy` 聚合、Web `news-item.tsx` badge。落地后用户看到 "🔗 N 个平台报道" 标记。

**Tech Stack:** NestJS · BullMQ · Prisma · pgvector (cosine `<=>` 操作符 + ivfflat 索引) · OpenAI `/v1/embeddings` REST API · ioredis · vitest · `vi.stubGlobal('fetch')` mock 套路（同 `llm-client.spec.ts` / `hackernews.crawler.spec.ts`）· `scripts/run-prod-oneshot.sh` 一次性脚本范式（SP-4 §10 决策 11）· esbuild bundle 同 `@ai-hot-news/utils` 形态。

**Spec:** `docs/superpowers/specs/2026-05-08-sp7-pgvector-cross-platform-merge-design.md`

**预计工作量：~2 天**（worker 模块骨架 4h + summarize push hook 0.5h + backfill 脚本 3h + API/DTO 2h + Web 0.5h + env/compose 0.3h + prod 部署 + smoke 1.5h ≈ 12h ≈ 1.5 个工作日，含 ~20 个 vitest case）。

---

## Pre-flight: codebase state on origin/main (VERIFIED 2026-05-13)

这些前提是写 plan 前查过的；如果你开始执行前 main 已变化（特别是 SP-6 PR-A/B/C 已并入），停下来重新对齐：

**已存在（不要重复创建）：**

- `apps/worker/src/redis/redis.module.ts` —— 共享 `RedisModule` 导出 `REDIS_CONNECTION`（SP-4.7 PR #2 引入）。**EmbedModule 必须 `imports: [RedisModule]`** —— SP-4.7 漏写导致 prod crash-loop 的教训已固化为 `redis.module.spec.ts` 回归测试。
- `apps/worker/src/redis/redis.module.spec.ts` —— **Task 2.7 必须把 `EmbedModule` 加进这个 spec 的 `[SummarizeModule]` import 列表**，回归测试覆盖到。
- `apps/worker/src/summarize/summarize.queue.ts` —— SP-5 BullMQ wiring 模板（Symbol queue token + queueProvider + WORKER token + factory function + concurrency 读 env）。**EmbedModule 完全 mirror 这个形态**，95% copy-rename。
- `apps/worker/src/summarize/summarize.module.ts` —— SP-5 模块模板：含 `OnApplicationBootstrap` boot backstop + `OnModuleDestroy` worker.close + `queue.clean(0,0,'failed'+'completed')` 前置（SP-5 v3.3/v3.5 修过的 BullMQ jobId dedupe stuck bug，**EmbedModule boot backstop 必须 mirror 同款 2 行 clean**）。
- `apps/worker/src/summarize/summarize.module.spec.ts` —— boot backstop 测试模板，95% copy-rename 到 `embed.module.spec.ts`。
- `apps/worker/src/summarize/summarize.service.ts` —— **SP-7 改这里**：line 67-78 `prisma.hotNews.update({ summary, titleZh, aiTags })` 成功后追加 `await this.embedQueue.add('embed', { hotNewsId }, { jobId: 'embed-<id>', ... })`。需要在 constructor 注入 `EMBED_QUEUE`。
- `apps/worker/src/summarize/summarize.service.spec.ts` —— **SP-7 在这里加 1 个新 case**：assert 写完 summary 后 `embedQueue.add` 被调用且 jobId 正确。已有 7 个 case 全绿，不要破。
- `apps/worker/src/crawl/queue.provider.ts` —— 导出 `REDIS_CONNECTION` Symbol。**embed.queue.ts 仅 import 这个 token，不重新建连接**。
- `packages/db/prisma/schema.prisma` `HotNews.embedding Unsupported("vector(1536)")?` 已就位（SP-0 落地，line 75）+ `groupId String?` 已就位（line 78）+ `@@index([groupId])` 已就位（line 90）。**SP-7 不改 schema**，仅可能加 ivfflat partial index（Task 4 决策）。
- `packages/db/scripts/wipe-hot-news-pre-ai.ts` / `packages/db/scripts/cleanup-rss-pre-window.ts` —— dual-mode entrypoint 范式（`require.main` + `argv[1].endsWith`）。**Task 4 的 `backfill-embeddings-sp7.ts` 对齐它们**。
- `packages/db/vitest.config.ts` 设 `fileParallelism: false` —— `packages/db/scripts/` 下的 integration spec 共享 dev DB，新 backfill spec 不需要再独立配置（自动继承）。
- `apps/worker/Dockerfile` 已 `COPY packages/db/scripts`（SP-4.5 引入），prod 一次性脚本走 `scripts/run-prod-oneshot.sh packages/db scripts/backfill-embeddings-sp7.ts`。
- `apps/worker/src/worker.module.ts` 当前 imports `[ConfigModule, SummarizeModule, ExtractModule, CrawlModule]` —— **Task 2.6 追加** `EmbedModule` 到 imports 数组。
- `.env.example` 含 SP-4.7 段（FIRECRAWL/JINA/EXTRACT_CONCURRENCY）+ SP-5 段（OPENROUTER_API_KEY / SUMMARY_MODEL / LLM_BASE_URL / SUMMARY_CONCURRENCY）—— **SP-7 新增独立段**（`OPENAI_API_KEY` / `EMBED_MODEL` / `EMBED_CONCURRENCY`）。
- `docker/docker-compose.prod.yml` worker.environment 已显式透传 SP-4.7/SP-5 keys —— **SP-7 加 3 个显式透传**（`OPENAI_API_KEY` / `EMBED_MODEL` / `EMBED_CONCURRENCY`）。**仅写 `.env` 不够**（SP-4.7 PR #3 hot fix 教训）。

**还没有（本 SP 创建/扩展）：**

- `apps/worker/src/embed/` —— 整个目录不存在（embed.queue / embed-client / embed.service / group.service / embed.processor / embed.module + 5 个 spec）。
- `packages/db/scripts/backfill-embeddings-sp7.ts` + `.spec.ts` —— 一次性 backfill 脚本不存在。
- `packages/db/prisma/migrations/<timestamp>_sp7_embedding_ivfflat/` —— **可选**，如果 prod backfill 后 165 行查询 < 50ms 不加；超过 50ms 走 Task 4 决策建 ivfflat。
- `packages/types/src/dtos.ts` `HotNewsListItemDto` 需加 `groupId: string | null` + `groupSize: number` —— PR-β 改这里。
- `apps/api/src/hot-news/hot-news.service.ts` `list()` 需 select `groupId` + 跑 `groupBy` 聚合 size + map 到 DTO —— PR-β 改这里。
- `apps/web/app/news/_components/news-item.tsx` 需加 `groupSize > 1` 时的 badge —— PR-β 改这里。
- prod `/srv/ai-hot-news/.env` 未含 `OPENAI_API_KEY` / `EMBED_MODEL` / `EMBED_CONCURRENCY`（与 SP-5 OpenRouter key 并存，**OpenAI 直 API 用于 embedding，OpenRouter 仍用于 summary**）。

**契约信号（不要破坏）：**

- `apps/worker/src/redis/redis.module.spec.ts` 必须保持绿（**EmbedModule 加入后必须出现在该 spec 的 import 列表内**）。
- `apps/worker/src/summarize/summarize.service.spec.ts` 现有 7 个 case 不能改语义。SP-7 加 1 case 后总数 ≥ 8 case 全绿。
- `apps/worker/src/crawl/ingestion.service.integration.spec.ts` 现有 case 不能改语义。
- SP-5 prompt 的 `summary` / `titleZh` 写入路径不动 —— SP-7 只在 update 成功后追加 push embed:<id>。
- BullMQ jobId 形式 `embed-<rowId>` 全局唯一（与 `summarize-<rowId>` / `extract-<rowId>` 平行命名空间）。
- 阈值常量集中在 `apps/worker/src/embed/group.service.ts` 模块顶端（`COSINE_THRESHOLD = 0.85` / `TAG_BOOST = 0.07` / `WINDOW_DAYS = 7` / `CANDIDATE_LIMIT = 5`），未来通过 env override 时改这里一处。

---

## Task 1: Verify pgvector op availability + Prisma raw SQL form

**Goal:** 确认 prod & dev 容器的 `vector` 类型 + `<=>` 操作符可用，并锁定 Prisma `$queryRaw` 注入 1536-d float 数组的正确语法（避免 PR-α 落地时才发现要改 SQL）。

**Files:**
- 只跑命令 + 读 pgvector docs，不创建文件。

- [ ] **Step 1.1: 确认 dev container 有 pgvector extension**

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c "SELECT extname, extversion FROM pg_extension WHERE extname='vector';"
```

期望输出含一行 `vector | 0.7.0` 或类似（SP-0 用 `pgvector/pgvector:pg16` 镜像，自带 0.7.x）。如果空，说明 dev DB 是 wipe 重建过但没跑 init.sql —— 重新 `docker compose -f docker/docker-compose.dev.yml down -v && up -d postgres`。

- [ ] **Step 1.2: 测试 1536-d float 数组的 raw SQL 写入语法**

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news <<'SQL'
CREATE TEMPORARY TABLE _vec_test (id text, emb vector(1536));
INSERT INTO _vec_test (id, emb) VALUES ('a', array_fill(0.1::float, ARRAY[1536])::vector);
INSERT INTO _vec_test (id, emb) VALUES ('b', array_fill(0.2::float, ARRAY[1536])::vector);
SELECT id, 1 - (emb <=> (SELECT emb FROM _vec_test WHERE id='a')) AS cosine FROM _vec_test;
SQL
```

期望输出 `a | 1` 和 `b | ~0.998..`。锁定结论：`Prisma.$executeRaw\`UPDATE hot_news SET embedding = ${vecArr}::vector ...\`` 形态——把 JS `number[]` 转字符串 `[0.1,0.2,...]` 然后 `::vector` 强转。**实际写法在 Task 2.3 验证**。

- [ ] **Step 1.3: 验证 prod 同款 pgvector 版本（不动 prod 数据）**

```bash
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T postgres \
 psql -U ai_hot_news -d ai_hot_news_prod -c "SELECT extname, extversion FROM pg_extension WHERE extname='\''vector'\'';"'
```

期望与 dev 同版本（或更新）。

- [ ] **Step 1.4: 不 commit，本 task 是验证（no-op on filesystem）**

---

## Task 2: `apps/worker/src/embed/` 模块骨架

**Goal:** 端到端建立 embed 模块：BullMQ 队列 + OpenAI embeddings client + EmbedService + GroupService + processor + module（boot backstop）。Mirror SummarizeModule 形态，零结构创新。

**Files:**
- Create: `apps/worker/src/embed/embed.queue.ts`
- Create: `apps/worker/src/embed/embed-client.ts` + `embed-client.spec.ts`
- Create: `apps/worker/src/embed/embed.service.ts` + `embed.service.spec.ts`
- Create: `apps/worker/src/embed/group.service.ts` + `group.service.spec.ts`
- Create: `apps/worker/src/embed/embed.processor.ts` + `embed.processor.spec.ts`
- Create: `apps/worker/src/embed/embed.module.ts` + `embed.module.spec.ts`
- Modify: `apps/worker/src/worker.module.ts`
- Modify: `apps/worker/src/redis/redis.module.spec.ts`

- [ ] **Step 2.1: Create branch from origin/main**

```bash
git fetch origin
git checkout -b feat/sp7-A-embed-worker origin/main
git status -sb
```

Expected: `## feat/sp7-A-embed-worker...origin/main`

- [ ] **Step 2.2: `embed.queue.ts` — BullMQ wiring (mirror summarize.queue.ts)**

新建 `apps/worker/src/embed/embed.queue.ts`：

```typescript
import { Provider } from '@nestjs/common';
import { Queue, Worker, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CONNECTION } from '../crawl/queue.provider';

export const EMBED_QUEUE_NAME = 'embed';
export const EMBED_QUEUE = Symbol('EMBED_QUEUE');

export const embedQueueProvider: Provider = {
  provide: EMBED_QUEUE,
  useFactory: (connection: IORedis): Queue =>
    new Queue(EMBED_QUEUE_NAME, {
      connection: connection as unknown as ConnectionOptions,
    }),
  inject: [REDIS_CONNECTION],
};

export const EMBED_WORKER = Symbol('EMBED_WORKER');

export function createEmbedWorker(
  processor: (jobName: string, jobData: unknown) => Promise<void>,
  connection: IORedis,
): Worker {
  const concurrency = parseInt(process.env.EMBED_CONCURRENCY ?? '2', 10);
  return new Worker(
    EMBED_QUEUE_NAME,
    async (job) => processor(job.name, job.data),
    {
      connection: connection as unknown as ConnectionOptions,
      concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 2,
    },
  );
}
```

`EMBED_CONCURRENCY` 默认 2（OpenAI v3-small 5000 RPM 充裕但保守，prod 实测可调）。

- [ ] **Step 2.3: `embed-client.ts` — OpenAI embeddings REST call**

新建 `apps/worker/src/embed/embed-client.ts`：

```typescript
export interface EmbedResult {
  vector: number[];
  tokensIn: number;
  durationMs: number;
}

export async function callEmbed(text: string): Promise<EmbedResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  const model = process.env.EMBED_MODEL ?? 'text-embedding-3-small';

  const start = Date.now();
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '<no body>');
    throw new Error(`OpenAI embeddings ${res.status}: ${errText.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    data: Array<{ embedding: number[] }>;
    usage: { prompt_tokens: number };
  };
  const vector = json.data[0]?.embedding;
  if (!vector || vector.length !== 1536) {
    throw new Error(
      `OpenAI embeddings returned invalid vector (len=${vector?.length ?? 'undef'})`,
    );
  }
  return {
    vector,
    tokensIn: json.usage.prompt_tokens,
    durationMs: Date.now() - start,
  };
}
```

新建 `apps/worker/src/embed/embed-client.spec.ts`（mirror `llm-client.spec.ts` 形态）：

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callEmbed } from './embed-client';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
  delete process.env.EMBED_MODEL;
});

describe('callEmbed', () => {
  it('throws if OPENAI_API_KEY missing', async () => {
    await expect(callEmbed('hello')).rejects.toThrow('OPENAI_API_KEY not configured');
  });

  it('returns vector + tokensIn on 200 OK', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const vec = Array.from({ length: 1536 }, (_, i) => i * 0.001);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: vec }], usage: { prompt_tokens: 42 } }),
      }),
    );
    const r = await callEmbed('Anthropic 推出 Claude 4.5');
    expect(r.vector).toHaveLength(1536);
    expect(r.tokensIn).toBe(42);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('throws on non-2xx', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve('rate limited'),
      }),
    );
    await expect(callEmbed('x')).rejects.toThrow(/429/);
  });

  it('throws if vector length != 1536', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: [0.1, 0.2] }], usage: { prompt_tokens: 1 } }),
      }),
    );
    await expect(callEmbed('x')).rejects.toThrow(/invalid vector/);
  });

  it('uses EMBED_MODEL env override', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.EMBED_MODEL = 'text-embedding-3-large';
    const vec = Array.from({ length: 1536 }, () => 0);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: vec }], usage: { prompt_tokens: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await callEmbed('x');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe('text-embedding-3-large');
  });
});
```

跑 `pnpm --filter @ai-hot-news/worker test -- embed-client.spec.ts`，期望 5/5 绿。

- [ ] **Step 2.4: `group.service.ts` — pgvector cosine + tag boost + 7d window**

新建 `apps/worker/src/embed/group.service.ts`：

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import { getPrisma, Prisma } from '@ai-hot-news/db';

// SP-7 constants (centralized for env override or future tuning)
export const COSINE_THRESHOLD = 0.85;
export const TAG_BOOST = 0.07;
export const WINDOW_DAYS = 7;
export const CANDIDATE_LIMIT = 5;

interface Candidate {
  id: string;
  groupId: string | null;
  aiTags: string[];
  cosine: number;
}

@Injectable()
export class GroupService {
  private readonly logger = new Logger(GroupService.name);

  /**
   * Assign a groupId to `hotNewsId` based on nearest neighbors within a 7d
   * publishedAt window. Idempotent: re-running on the same row either keeps
   * the existing groupId (if best candidate is unchanged) or migrates to a
   * better one (rare; only happens when prompt rewrites cause embedding shifts).
   */
  async assignGroup(hotNewsId: string): Promise<{ groupId: string | null; cosine: number }> {
    const prisma = getPrisma();
    const target = await prisma.hotNews.findUnique({
      where: { id: hotNewsId },
      select: { aiTags: true },
    });
    if (!target) return { groupId: null, cosine: 0 };

    const candidates = await prisma.$queryRaw<Candidate[]>(
      Prisma.sql`
        SELECT id, "groupId", "aiTags",
               1 - (embedding <=> (SELECT embedding FROM hot_news WHERE id = ${hotNewsId})) AS cosine
          FROM hot_news
         WHERE id <> ${hotNewsId}
           AND embedding IS NOT NULL
           AND status = 'VISIBLE'
           AND "publishedAt" > NOW() - INTERVAL '${Prisma.raw(`${WINDOW_DAYS} days`)}'
         ORDER BY embedding <=> (SELECT embedding FROM hot_news WHERE id = ${hotNewsId})
         LIMIT ${CANDIDATE_LIMIT}
      `,
    );

    if (candidates.length === 0) {
      return { groupId: null, cosine: 0 };
    }

    const targetTags = new Set(
      (target.aiTags ?? []).filter((t) => t.startsWith('company:') || t.startsWith('model:')),
    );
    const scored = candidates
      .map((c) => ({
        ...c,
        score:
          c.cosine + (c.aiTags.some((t) => targetTags.has(t)) ? TAG_BOOST : 0),
      }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];

    if (!best || best.score < COSINE_THRESHOLD) {
      this.logger.log(
        `assignGroup ${hotNewsId} → singleton (best=${best?.score.toFixed(3) ?? 'none'} below ${COSINE_THRESHOLD})`,
      );
      return { groupId: null, cosine: best?.cosine ?? 0 };
    }

    const groupId = best.groupId ?? `grp-${createId()}`;
    await prisma.$transaction([
      prisma.hotNews.update({ where: { id: hotNewsId }, data: { groupId } }),
      ...(best.groupId
        ? []
        : [prisma.hotNews.update({ where: { id: best.id }, data: { groupId } })]),
    ]);
    this.logger.log(
      `assignGroup ${hotNewsId} → ${groupId} (score=${best.score.toFixed(3)}, cosine=${best.cosine.toFixed(3)}, reused=${best.groupId !== null})`,
    );
    return { groupId, cosine: best.cosine };
  }
}
```

新建 `apps/worker/src/embed/group.service.spec.ts`（mock prisma 形态，参考 `summarize.service.spec.ts`）：

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupService, COSINE_THRESHOLD, TAG_BOOST } from './group.service';
import * as dbPkg from '@ai-hot-news/db';

const mockPrisma = {
  hotNews: { findUnique: vi.fn(), update: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
};

vi.mock('@ai-hot-news/db', async (orig) => {
  const actual = await orig<typeof import('@ai-hot-news/db')>();
  return { ...actual, getPrisma: () => mockPrisma };
});

beforeEach(() => {
  mockPrisma.hotNews.findUnique.mockReset();
  mockPrisma.hotNews.update.mockReset();
  mockPrisma.$queryRaw.mockReset();
  mockPrisma.$transaction.mockClear();
});

describe('GroupService.assignGroup', () => {
  const svc = new GroupService();

  it('returns null when target row missing', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce(null);
    const r = await svc.assignGroup('missing');
    expect(r.groupId).toBeNull();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns null when no candidates within 7d window', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({ aiTags: [] });
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);
    const r = await svc.assignGroup('lonely');
    expect(r.groupId).toBeNull();
  });

  it('returns null when best cosine below threshold and no tag boost', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({ aiTags: ['company:openai'] });
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'a', groupId: null, aiTags: ['company:anthropic'], cosine: 0.80 },
    ]);
    const r = await svc.assignGroup('me');
    expect(r.groupId).toBeNull();
    expect(mockPrisma.hotNews.update).not.toHaveBeenCalled();
  });

  it('applies tag boost to push cosine 0.79 over threshold (0.79 + 0.07 = 0.86)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({ aiTags: ['company:openai', 'model:gpt-5'] });
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'a', groupId: null, aiTags: ['company:openai'], cosine: 0.79 },
    ]);
    const r = await svc.assignGroup('me');
    expect(r.groupId).toMatch(/^grp-/);
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
  });

  it('reuses existing groupId when best candidate already in a group', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({ aiTags: [] });
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'a', groupId: 'grp-existing-xyz', aiTags: [], cosine: 0.90 },
    ]);
    const r = await svc.assignGroup('me');
    expect(r.groupId).toBe('grp-existing-xyz');
    // single UPDATE (self only), no second UPDATE for the existing-group candidate
    const ops = mockPrisma.$transaction.mock.calls[0]?.[0] as unknown[];
    expect(ops.length).toBe(1);
  });

  it('promotes singleton candidate to new group + propagates to self in one transaction', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({ aiTags: [] });
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'singleton', groupId: null, aiTags: [], cosine: 0.92 },
    ]);
    const r = await svc.assignGroup('me');
    expect(r.groupId).toMatch(/^grp-/);
    const ops = mockPrisma.$transaction.mock.calls[0]?.[0] as unknown[];
    expect(ops.length).toBe(2); // self + singleton both update
  });
});
```

跑 `pnpm --filter @ai-hot-news/worker test -- group.service.spec.ts`，期望 6/6 绿。

- [ ] **Step 2.5: `embed.service.ts` — fetch row + build input + persist embedding + assign group**

新建 `apps/worker/src/embed/embed.service.ts`：

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { getPrisma, Prisma } from '@ai-hot-news/db';
import { callEmbed } from './embed-client';
import { GroupService } from './group.service';

@Injectable()
export class EmbedService {
  private readonly logger = new Logger(EmbedService.name);

  constructor(private readonly groupService: GroupService) {}

  async run(hotNewsId: string): Promise<void> {
    const prisma = getPrisma();
    const row = await prisma.hotNews.findUnique({
      where: { id: hotNewsId },
      select: {
        id: true,
        title: true,
        titleZh: true,
        summary: true,
        status: true,
      },
    });
    if (!row) {
      this.logger.warn(`Row ${hotNewsId} not found, skip`);
      return;
    }
    if (row.status !== 'VISIBLE' || !row.summary) {
      this.logger.log(`embed skip ${hotNewsId} (not visible / no summary)`);
      return;
    }

    const input = `${row.titleZh ?? row.title}\n${row.summary}`;
    const result = await callEmbed(input);

    // pgvector: cast JS number[] → Postgres array literal → vector(1536)
    const literal = `[${result.vector.join(',')}]`;
    await prisma.$executeRaw(
      Prisma.sql`UPDATE hot_news SET embedding = ${literal}::vector(1536) WHERE id = ${hotNewsId}`,
    );

    const { groupId, cosine } = await this.groupService.assignGroup(hotNewsId);
    this.logger.log(
      `embed ${hotNewsId} → ${result.tokensIn} tokens (${result.durationMs}ms), group=${groupId ?? 'singleton'}${groupId ? ` cosine=${cosine.toFixed(3)}` : ''}`,
    );
  }
}
```

新建 `apps/worker/src/embed/embed.service.spec.ts`（mock callEmbed + GroupService + prisma）：

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbedService } from './embed.service';
import { GroupService } from './group.service';
import * as embedClient from './embed-client';

const mockPrisma = {
  hotNews: { findUnique: vi.fn() },
  $executeRaw: vi.fn(),
};

vi.mock('@ai-hot-news/db', async (orig) => {
  const actual = await orig<typeof import('@ai-hot-news/db')>();
  return { ...actual, getPrisma: () => mockPrisma };
});

beforeEach(() => {
  mockPrisma.hotNews.findUnique.mockReset();
  mockPrisma.$executeRaw.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('EmbedService.run', () => {
  const groupService = { assignGroup: vi.fn() } as unknown as GroupService;
  const svc = new EmbedService(groupService);

  it('skips when row missing', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce(null);
    await svc.run('missing');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('skips when status !== VISIBLE', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({
      id: 'a', title: 'x', titleZh: null, summary: 'y', status: 'HIDDEN',
    });
    await svc.run('a');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('skips when summary is null (boot backstop scan should not enqueue but defense-in-depth)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({
      id: 'a', title: 'x', titleZh: null, summary: null, status: 'VISIBLE',
    });
    await svc.run('a');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('uses titleZh ?? title for embed input + persists vector + calls assignGroup', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({
      id: 'a', title: 'Anthropic raises X', titleZh: 'Anthropic 融资 X', summary: '中文摘要', status: 'VISIBLE',
    });
    const vec = Array.from({ length: 1536 }, () => 0.1);
    vi.spyOn(embedClient, 'callEmbed').mockResolvedValueOnce({
      vector: vec, tokensIn: 30, durationMs: 200,
    });
    (groupService.assignGroup as any).mockResolvedValueOnce({ groupId: 'grp-xyz', cosine: 0.91 });

    await svc.run('a');

    expect(embedClient.callEmbed).toHaveBeenCalledWith('Anthropic 融资 X\n中文摘要');
    expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
    expect(groupService.assignGroup).toHaveBeenCalledWith('a');
  });

  it('falls back to title (English) when titleZh is null', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({
      id: 'a', title: 'Plain title', titleZh: null, summary: 'sum', status: 'VISIBLE',
    });
    const vec = Array.from({ length: 1536 }, () => 0);
    vi.spyOn(embedClient, 'callEmbed').mockResolvedValueOnce({
      vector: vec, tokensIn: 5, durationMs: 10,
    });
    (groupService.assignGroup as any).mockResolvedValueOnce({ groupId: null, cosine: 0 });

    await svc.run('a');
    expect(embedClient.callEmbed).toHaveBeenCalledWith('Plain title\nsum');
  });
});
```

跑 `pnpm --filter @ai-hot-news/worker test -- embed.service.spec.ts`，期望 5/5 绿。

- [ ] **Step 2.6: `embed.processor.ts` + spec + `embed.module.ts` + boot backstop spec**

新建 `apps/worker/src/embed/embed.processor.ts`：

```typescript
import { EmbedService } from './embed.service';

export interface EmbedJobData {
  hotNewsId: string;
}

export async function processEmbedJob(
  data: EmbedJobData,
  service: EmbedService,
): Promise<void> {
  await service.run(data.hotNewsId);
}
```

新建 `apps/worker/src/embed/embed.processor.spec.ts`（2 个 case：基本调用、传错 hotNewsId fallthrough）—— **完全 mirror `summarize.processor.spec.ts`**，2 行 import 改名即可。

新建 `apps/worker/src/embed/embed.module.ts`（mirror SummarizeModule，**关键：boot backstop 必须 clean failed + completed 两个集合**）：

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
import { EmbedService } from './embed.service';
import { GroupService } from './group.service';
import {
  EMBED_QUEUE,
  EMBED_WORKER,
  createEmbedWorker,
  embedQueueProvider,
} from './embed.queue';
import { processEmbedJob, type EmbedJobData } from './embed.processor';

@Module({
  imports: [RedisModule],
  providers: [
    embedQueueProvider,
    GroupService,
    {
      provide: EmbedService,
      useFactory: (gs: GroupService) => new EmbedService(gs),
      inject: [GroupService],
    },
    {
      provide: EMBED_WORKER,
      useFactory: (connection: IORedis, service: EmbedService): Worker => {
        const worker = createEmbedWorker(
          async (_jobName, jobData) =>
            processEmbedJob(jobData as EmbedJobData, service),
          connection,
        );
        worker.on('failed', (job, err) => {
          new Logger('EmbedWorker').error(
            `Job ${job?.id ?? '<no-id>'} failed: ${err.message}`,
          );
        });
        return worker;
      },
      inject: [REDIS_CONNECTION, EmbedService],
    },
  ],
  exports: [EMBED_QUEUE],
})
export class EmbedModule
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(EmbedModule.name);

  constructor(
    @Inject(EMBED_QUEUE) private readonly queue: Queue,
    @Inject(EMBED_WORKER) private readonly worker: Worker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // SP-7: same BullMQ jobId dedupe trap as SummarizeModule (see SP-5 v3.3/v3.5 fix).
    // Clear BOTH 'failed' and 'completed' zsets before re-queueing — both can hold
    // stale jobId hashes that silently no-op queue.add().
    const cleanedFailed = await this.queue.clean(0, 0, 'failed');
    const cleanedCompleted = await this.queue.clean(0, 0, 'completed');
    if (cleanedFailed.length > 0 || cleanedCompleted.length > 0) {
      this.logger.log(
        `Boot backstop: cleared ${cleanedFailed.length} failed + ${cleanedCompleted.length} completed jobs before re-queue`,
      );
    }

    // Scan rows that have a summary but no embedding yet.
    // Prisma's Unsupported("vector") column can't be projected; query existence via raw.
    const orphans = await getPrisma().$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM hot_news WHERE status='VISIBLE' AND summary IS NOT NULL AND embedding IS NULL`,
    );
    for (const r of orphans) {
      await this.queue.add(
        'embed',
        { hotNewsId: r.id },
        {
          jobId: `embed-${r.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
    }
    this.logger.log(`Boot backstop: re-queued ${orphans.length} pending embed jobs`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}
```

新建 `apps/worker/src/embed/embed.module.spec.ts`（mirror `summarize.module.spec.ts`）—— 测：
1. `onApplicationBootstrap` 调用 `queue.clean(0,0,'failed')` + `queue.clean(0,0,'completed')` 各一次
2. 扫到的每个 orphan id 都被 `queue.add('embed', {hotNewsId}, {jobId: 'embed-<id>'})`
3. `onModuleDestroy` 调用 `worker.close()`

参考 `summarize.module.spec.ts:1-100` 的 mock 形态（mock `getPrisma` 返 `$queryRawUnsafe` 而非 `findMany`）：

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockQueueClean = vi.fn().mockResolvedValue([]);
const mockQueueAdd = vi.fn().mockResolvedValue(undefined);
const mockWorkerClose = vi.fn().mockResolvedValue(undefined);
const mockQueryRawUnsafe = vi.fn();

vi.mock('@ai-hot-news/db', async (orig) => {
  const actual = await orig<typeof import('@ai-hot-news/db')>();
  return {
    ...actual,
    getPrisma: () => ({ $queryRawUnsafe: mockQueryRawUnsafe }),
  };
});

import { EmbedModule } from './embed.module';
import { EMBED_QUEUE, EMBED_WORKER } from './embed.queue';
import { Queue, Worker } from 'bullmq';

beforeEach(() => {
  mockQueueClean.mockReset().mockResolvedValue([]);
  mockQueueAdd.mockReset().mockResolvedValue(undefined);
  mockWorkerClose.mockReset().mockResolvedValue(undefined);
  mockQueryRawUnsafe.mockReset();
});

describe('EmbedModule boot backstop', () => {
  function makeModule() {
    const queue = { clean: mockQueueClean, add: mockQueueAdd } as unknown as Queue;
    const worker = { close: mockWorkerClose } as unknown as Worker;
    return new EmbedModule(queue, worker);
  }

  it('cleans both failed and completed before re-queue', async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]);
    await makeModule().onApplicationBootstrap();
    expect(mockQueueClean).toHaveBeenCalledTimes(2);
    expect(mockQueueClean).toHaveBeenCalledWith(0, 0, 'failed');
    expect(mockQueueClean).toHaveBeenCalledWith(0, 0, 'completed');
  });

  it('re-queues every orphan with jobId=embed-<id>', async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    await makeModule().onApplicationBootstrap();
    expect(mockQueueAdd).toHaveBeenCalledTimes(2);
    expect(mockQueueAdd).toHaveBeenNthCalledWith(
      1,
      'embed',
      { hotNewsId: 'a' },
      expect.objectContaining({ jobId: 'embed-a', attempts: 3 }),
    );
    expect(mockQueueAdd).toHaveBeenNthCalledWith(
      2,
      'embed',
      { hotNewsId: 'b' },
      expect.objectContaining({ jobId: 'embed-b' }),
    );
  });

  it('closes worker on destroy', async () => {
    await makeModule().onModuleDestroy();
    expect(mockWorkerClose).toHaveBeenCalledOnce();
  });
});
```

跑 `pnpm --filter @ai-hot-news/worker test -- "embed.*\.spec\.ts"`，期望 18/18+ 绿（embed-client 5 + group 6 + embed.service 5 + processor 2 + module 3 = 21）。

- [ ] **Step 2.7: Wire EmbedModule into worker.module.ts + RedisModule regression test**

编辑 `apps/worker/src/worker.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { LivenessService } from './liveness.service';
import { CrawlModule } from './crawl/crawl.module';
import { ExtractModule } from './extract/extract.module';
import { SummarizeModule } from './summarize/summarize.module';
import { EmbedModule } from './embed/embed.module';

const ROOT_ENV = join(__dirname, '..', '..', '..', '.env');
const APP_ENV = join(__dirname, '..', '.env');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [APP_ENV, ROOT_ENV] }),
    SummarizeModule,
    ExtractModule,
    EmbedModule,
    CrawlModule,
  ],
  providers: [LivenessService],
})
export class WorkerModule {}
```

编辑 `apps/worker/src/redis/redis.module.spec.ts` —— 加 EmbedModule resolve case：

```typescript
import { EmbedModule } from '../embed/embed.module';
import { EMBED_QUEUE } from '../embed/embed.queue';

// ... existing tests preserved ...

it('EmbedModule resolves EMBED_QUEUE through RedisModule', async () => {
  const ref = await Test.createTestingModule({
    imports: [EmbedModule],
  }).compile();
  expect(ref.get(EMBED_QUEUE)).toBeDefined();
  expect(ref.get(REDIS_CONNECTION)).toBeDefined();
  await ref.close();
});
```

跑 `pnpm --filter @ai-hot-news/worker test -- redis.module.spec.ts`，期望 3/3 绿（原 2 + 新 1）。

- [ ] **Step 2.8: Commit task 2**

```bash
pnpm --filter @ai-hot-news/worker run lint typecheck test
```

期望 worker 全包绿（含新增 ~21 case）。

```bash
git add apps/worker/src/embed/ apps/worker/src/worker.module.ts apps/worker/src/redis/redis.module.spec.ts
git commit -m "feat(sp7): embed module — OpenAI v3-small + pgvector cosine group assignment

- apps/worker/src/embed/{queue,client,service,processor,module} + GroupService
- COSINE_THRESHOLD=0.85, TAG_BOOST=0.07, WINDOW_DAYS=7
- Boot backstop scans hot_news WHERE summary IS NOT NULL AND embedding IS NULL,
  re-queues with jobId=embed-<id>. Mirrors SP-5 boot backstop (clean failed+completed)
  to avoid BullMQ jobId dedupe stuck bug.
- Wires EmbedModule into WorkerModule + RedisModule regression test."
```

---

## Task 3: SP-5 push embed:<id> hook + spec update

**Goal:** SP-5 `SummarizeService.run()` 在 `prisma.hotNews.update({ summary, titleZh, aiTags })` 成功后，push `embed:<id>` 到 EMBED_QUEUE。这是 SP-7 的核心连接点。

**Files:**
- Modify: `apps/worker/src/summarize/summarize.service.ts`
- Modify: `apps/worker/src/summarize/summarize.module.ts` （新依赖 EMBED_QUEUE）
- Modify: `apps/worker/src/summarize/summarize.service.spec.ts`

- [ ] **Step 3.1: Inject EMBED_QUEUE into SummarizeService**

编辑 `apps/worker/src/summarize/summarize.service.ts`：

```typescript
import { Injectable, Logger, Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { getPrisma } from '@ai-hot-news/db';
import {
  buildSystemPrompt,
  buildUserPrompt,
  parseSummarizeResponse,
} from '@ai-hot-news/prompts';
import { callLlm } from './llm-client';
import { SummarizationStrategy } from './strategies/strategy.interface';
import { EMBED_QUEUE } from '../embed/embed.queue';

@Injectable()
export class SummarizeService {
  private readonly logger = new Logger(SummarizeService.name);

  constructor(
    private readonly strategy: SummarizationStrategy,
    @Inject(EMBED_QUEUE) private readonly embedQueue: Queue,
  ) {}

  async run(hotNewsId: string): Promise<void> {
    // ... existing logic unchanged through line 75 (update call) ...

    try {
      await prisma.hotNews.update({
        where: { id: hotNewsId },
        data: {
          titleZh: parsed.titleZh,
          summary: parsed.summary,
          aiTags: parsed.aiTags,
        },
      });
      // SP-7: enqueue embedding job after successful summary write.
      // Same retry/backoff/dedupe policy as summary jobs.
      await this.embedQueue.add(
        'embed',
        { hotNewsId },
        {
          jobId: `embed-${hotNewsId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
    } catch (err) {
      if ((err as { code?: string }).code === 'P2025') return;
      throw err;
    }

    // ... existing log line unchanged ...
  }
}
```

注意把 `embedQueue.add` 放在 `update` 同一个 try 块内、紧跟 update 之后。如果 P2025（行被删）整个块 swallow。

- [ ] **Step 3.2: SummarizeModule provider 注入 EmbedService 依赖**

编辑 `apps/worker/src/summarize/summarize.module.ts` —— SummarizeService provider 改成需 EMBED_QUEUE：

```typescript
import { EMBED_QUEUE } from '../embed/embed.queue';

// ... existing imports above ...

@Module({
  imports: [RedisModule],
  providers: [
    summaryQueueProvider,
    {
      provide: STRATEGY_TOKEN,
      useFactory: (): SummarizationStrategy => new SummarizeAllVisibleStrategy(),
    },
    {
      provide: SummarizeService,
      useFactory: (strategy: SummarizationStrategy, embedQueue: Queue) =>
        new SummarizeService(strategy, embedQueue),
      inject: [STRATEGY_TOKEN, EMBED_QUEUE],
    },
    // ... rest unchanged
  ],
  exports: [SUMMARY_QUEUE],
})
```

**问题：SummarizeModule 现在依赖 EmbedModule 导出的 EMBED_QUEUE。**两种解法：
- (A) SummarizeModule `imports: [RedisModule, EmbedModule]` — 干净，DI 自然解析。
- (B) WorkerModule imports order：`EmbedModule` 必须排在 `SummarizeModule` **之前**，并且依赖关系靠 WorkerModule 拼接。

**选 (A)**。 修改 `summarize.module.ts` imports：

```typescript
import { EmbedModule } from '../embed/embed.module';

@Module({
  imports: [RedisModule, EmbedModule],
  // ...
})
```

注意：EmbedModule 已经 `imports: [RedisModule]`，Nest 自动去重，连接还是单条。

- [ ] **Step 3.3: 更新 summarize.service.spec.ts — 注入 mock embedQueue + 验证 add 被调用**

打开 `apps/worker/src/summarize/summarize.service.spec.ts`，找到 SummarizeService 实例化处，加 mock：

```typescript
const mockEmbedQueue = {
  add: vi.fn().mockResolvedValue(undefined),
} as unknown as Queue;

// 改 instance 创建：
const svc = new SummarizeService(strategy, mockEmbedQueue);
```

每个现有 case 前 `beforeEach` 加 `mockEmbedQueue.add.mockClear()`。

**追加 1 个新 case**：

```typescript
it('SP-7: enqueues embed:<id> after successful summary write', async () => {
  // (setup: mock prisma + callLlm + parser as the happy path test does)
  // ...
  await svc.run('row-abc');
  expect(mockEmbedQueue.add).toHaveBeenCalledWith(
    'embed',
    { hotNewsId: 'row-abc' },
    expect.objectContaining({
      jobId: 'embed-row-abc',
      attempts: 3,
    }),
  );
});

it('SP-7: does not enqueue embed when summary write fails (P2025)', async () => {
  // (mock prisma.update to throw {code: 'P2025'})
  // ...
  await svc.run('row-deleted');
  expect(mockEmbedQueue.add).not.toHaveBeenCalled();
});
```

跑 `pnpm --filter @ai-hot-news/worker test -- summarize.service.spec.ts`，期望 9/9 绿（原 7 + 新 2）。

- [ ] **Step 3.4: Run worker全包测试 — 任何回归立即停下**

```bash
pnpm --filter @ai-hot-news/worker run lint typecheck test
```

注意 `redis.module.spec.ts` 现在测的 SummarizeModule 已间接依赖 EmbedModule —— 应仍绿（DI 容器自动解析）。

- [ ] **Step 3.5: Commit task 3**

```bash
git add apps/worker/src/summarize/
git commit -m "feat(sp7): push embed:<id> from SummarizeService after summary write

- SummarizeService.run() enqueues embed job after prisma.update succeeds.
- SummarizeModule imports EmbedModule (Nest auto-dedupes RedisModule provider).
- Adds 2 new SummarizeService test cases (happy path + P2025 row-deleted)."
```

---

## Task 4: Backfill script + integration test

**Goal:** 一次性脚本扫 `summary IS NOT NULL AND embedding IS NULL` 的所有行，批量调 OpenAI embeddings + 写入 + 跑 GroupService。输出 JSON stats（与 `cleanup-rss-pre-window.ts` 同款 dual-mode entrypoint）。

**Files:**
- Create: `packages/db/scripts/backfill-embeddings-sp7.ts`
- Create: `packages/db/scripts/backfill-embeddings-sp7.spec.ts`

- [ ] **Step 4.1: Write the failing test first**

新建 `packages/db/scripts/backfill-embeddings-sp7.spec.ts`：

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@ai-hot-news/db';
import { backfillEmbeddings } from './backfill-embeddings-sp7';

const PREFIX = 'backfill-sp7-test-';

async function cleanup() {
  const prisma = getPrisma();
  await prisma.hotNews.deleteMany({
    where: { sourceUrl: { startsWith: 'https://backfill-sp7-test.example.com/' } },
  });
}

beforeEach(cleanup);
afterEach(cleanup);

describe('backfillEmbeddings', () => {
  it('scans only rows with summary != NULL and embedding IS NULL, status=VISIBLE', async () => {
    const prisma = getPrisma();
    // Seed 4 rows: 1 candidate, 3 disqualified for different reasons
    await prisma.hotNews.createMany({
      data: [
        // candidate ✓
        { id: PREFIX + 'a', title: 't1', content: 'c', sourcePlatform: 'HACKERNEWS',
          sourceUrl: 'https://backfill-sp7-test.example.com/1', publishedAt: new Date(),
          dedupeHash: PREFIX + 'h1', summary: '中文摘要', titleZh: '中文标题', status: 'VISIBLE' },
        // no summary
        { id: PREFIX + 'b', title: 't2', content: 'c', sourcePlatform: 'HACKERNEWS',
          sourceUrl: 'https://backfill-sp7-test.example.com/2', publishedAt: new Date(),
          dedupeHash: PREFIX + 'h2', summary: null, status: 'VISIBLE' },
        // HIDDEN
        { id: PREFIX + 'c', title: 't3', content: 'c', sourcePlatform: 'HACKERNEWS',
          sourceUrl: 'https://backfill-sp7-test.example.com/3', publishedAt: new Date(),
          dedupeHash: PREFIX + 'h3', summary: 'sum', status: 'HIDDEN', filterReason: 'test' },
      ],
    });

    const fakeEmbed = async () => ({
      vector: Array.from({ length: 1536 }, () => 0.05),
      tokensIn: 30,
      durationMs: 1,
    });
    const fakeAssign = vi.fn().mockResolvedValue({ groupId: null, cosine: 0 });

    const stats = await backfillEmbeddings({
      embedFn: fakeEmbed,
      assignGroupFn: fakeAssign,
      batchSize: 10,
    });
    expect(stats.scanned).toBe(1);
    expect(stats.embedded).toBe(1);
    expect(fakeAssign).toHaveBeenCalledWith(PREFIX + 'a');
  });

  it('reports groupsFormed + multiPlatformGroups based on assignGroup return value', async () => {
    const prisma = getPrisma();
    await prisma.hotNews.createMany({
      data: [
        { id: PREFIX + 'x', title: 't', content: 'c', sourcePlatform: 'HACKERNEWS',
          sourceUrl: 'https://backfill-sp7-test.example.com/x', publishedAt: new Date(),
          dedupeHash: PREFIX + 'hx', summary: 's', status: 'VISIBLE' },
        { id: PREFIX + 'y', title: 't', content: 'c', sourcePlatform: 'REDDIT',
          sourceUrl: 'https://backfill-sp7-test.example.com/y', publishedAt: new Date(),
          dedupeHash: PREFIX + 'hy', summary: 's', status: 'VISIBLE' },
      ],
    });
    const fakeEmbed = async () => ({
      vector: Array.from({ length: 1536 }, () => 0.05),
      tokensIn: 5, durationMs: 1,
    });
    const fakeAssign = vi.fn()
      .mockResolvedValueOnce({ groupId: null, cosine: 0 })       // first row → singleton
      .mockResolvedValueOnce({ groupId: 'grp-shared', cosine: 0.91 }); // second → joins

    const stats = await backfillEmbeddings({
      embedFn: fakeEmbed,
      assignGroupFn: fakeAssign,
      batchSize: 10,
    });
    expect(stats.scanned).toBe(2);
    expect(stats.embedded).toBe(2);
    expect(stats.groupsFormed).toBe(1);     // one 'grp-shared'
  });

  it('is idempotent: re-running with already-embedded rows yields scanned=0', async () => {
    // After the first run, embedding is set; second invocation should find 0 candidates.
    // (This test creates a row, marks it embedded via raw SQL, then asserts scanned=0.)
    const prisma = getPrisma();
    await prisma.hotNews.create({
      data: { id: PREFIX + 'z', title: 't', content: 'c', sourcePlatform: 'HACKERNEWS',
        sourceUrl: 'https://backfill-sp7-test.example.com/z', publishedAt: new Date(),
        dedupeHash: PREFIX + 'hz', summary: 's', status: 'VISIBLE' },
    });
    const fakeVec = `[${Array.from({ length: 1536 }, () => 0).join(',')}]`;
    await prisma.$executeRawUnsafe(
      `UPDATE hot_news SET embedding = '${fakeVec}'::vector(1536) WHERE id = $1`,
      PREFIX + 'z',
    );
    const fakeEmbed = vi.fn();
    const fakeAssign = vi.fn();
    const stats = await backfillEmbeddings({
      embedFn: fakeEmbed,
      assignGroupFn: fakeAssign,
      batchSize: 10,
    });
    expect(stats.scanned).toBe(0);
    expect(fakeEmbed).not.toHaveBeenCalled();
  });
});
```

跑 `pnpm --filter @ai-hot-news/db test -- backfill-embeddings-sp7.spec.ts`，期望 3 红（脚本未实现）。

- [ ] **Step 4.2: Implement `backfill-embeddings-sp7.ts`**

新建 `packages/db/scripts/backfill-embeddings-sp7.ts`：

```typescript
#!/usr/bin/env node
import { getPrisma, Prisma } from '@ai-hot-news/db';

export interface BackfillStats {
  scanned: number;
  embedded: number;
  groupsFormed: number;
  multiPlatformGroups: number;
  failed: number;
  costUsd: string;
}

export interface BackfillOpts {
  embedFn: (text: string) => Promise<{ vector: number[]; tokensIn: number; durationMs: number }>;
  assignGroupFn: (hotNewsId: string) => Promise<{ groupId: string | null; cosine: number }>;
  batchSize?: number;
}

export async function backfillEmbeddings(opts: BackfillOpts): Promise<BackfillStats> {
  const prisma = getPrisma();
  const batchSize = opts.batchSize ?? 100;
  const stats: BackfillStats = {
    scanned: 0, embedded: 0, groupsFormed: 0, multiPlatformGroups: 0, failed: 0, costUsd: '$0.000',
  };
  const seenGroups = new Set<string>();
  let totalTokens = 0;

  // pgvector column can't be projected via Prisma findMany — query ids via raw.
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; title: string; titleZh: string | null; summary: string }>>(
    `SELECT id, title, "titleZh", summary FROM hot_news
      WHERE status='VISIBLE' AND summary IS NOT NULL AND embedding IS NULL
      ORDER BY "publishedAt" DESC`,
  );
  stats.scanned = rows.length;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    for (const r of batch) {
      try {
        const input = `${r.titleZh ?? r.title}\n${r.summary}`;
        const { vector, tokensIn } = await opts.embedFn(input);
        totalTokens += tokensIn;
        const literal = `[${vector.join(',')}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE hot_news SET embedding = '${literal}'::vector(1536) WHERE id = $1`,
          r.id,
        );
        const { groupId } = await opts.assignGroupFn(r.id);
        if (groupId && !seenGroups.has(groupId)) {
          seenGroups.add(groupId);
          stats.groupsFormed += 1;
        }
        stats.embedded += 1;
      } catch (err) {
        stats.failed += 1;
        console.error(`Row ${r.id} failed: ${(err as Error).message}`);
      }
    }
  }

  // multiPlatformGroups = groups where members span > 1 distinct sourcePlatform
  if (seenGroups.size > 0) {
    const multi = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM (
         SELECT "groupId" FROM hot_news
           WHERE "groupId" IS NOT NULL AND status='VISIBLE'
           GROUP BY "groupId"
           HAVING COUNT(DISTINCT "sourcePlatform") > 1
       ) sub`,
    );
    stats.multiPlatformGroups = Number(multi[0]?.count ?? 0);
  }

  // text-embedding-3-small: $0.02 per 1M tokens
  stats.costUsd = `$${((totalTokens / 1_000_000) * 0.02).toFixed(4)}`;
  return stats;
}

// dual-mode entrypoint (mirror cleanup-rss-pre-window.ts)
async function mainCli(): Promise<void> {
  const { callEmbed } = await import(
    // @ts-expect-error worker package only included for prod oneshot via Dockerfile COPY
    '../../../apps/worker/src/embed/embed-client'
  );
  // GroupService 在 worker 包；oneshot 不引导 NestJS — 直接 inline 同款算法或导出纯函数。
  // 决策：assignGroup 在 oneshot 阶段是 no-op（写完 embedding 后由 worker boot backstop 拾起重算 groupId）。
  const stats = await backfillEmbeddings({
    embedFn: callEmbed,
    assignGroupFn: async () => ({ groupId: null, cosine: 0 }),
    batchSize: 100,
  });
  console.log(JSON.stringify(stats, null, 2));
}

if (require.main === module || process.argv[1]?.endsWith('backfill-embeddings-sp7.ts')) {
  mainCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

**重要决策（写进注释）**：oneshot 阶段 `assignGroup` 是 no-op；写完 embedding 后 worker 重启时 boot backstop 会扫到所有 `embedding IS NOT NULL AND groupId IS NULL` 的行并跑 group 分配。**等等** — 现 boot backstop 扫的是 `summary IS NOT NULL AND embedding IS NULL`，不会重跑 group。**修正**：oneshot 脚本里 inline 一个 fetch-only 版本的 assignGroup（直接 import GroupService 的纯函数，把 createId 也带上），让 oneshot 完成时 group 已经分好。

**Plan 决策**：把 GroupService 抽成 `apps/worker/src/embed/group.service.ts` 既导出 class 又导出**纯函数** `assignGroupCore(prisma, hotNewsId)` —— class 仅是 Nest 包装；oneshot 直接调纯函数。重做 Step 2.4 的 `group.service.ts` 顶部加：

```typescript
export async function assignGroupCore(
  prisma: ReturnType<typeof getPrisma>,
  hotNewsId: string,
  log?: (msg: string) => void,
): Promise<{ groupId: string | null; cosine: number }> {
  // ... same logic as GroupService.assignGroup but pure function ...
}
```

class `GroupService.assignGroup()` 就是 `return assignGroupCore(getPrisma(), id, msg => this.logger.log(msg))` 的薄包装。

oneshot 脚本 `assignGroupFn = (id) => assignGroupCore(getPrisma(), id)`。

- [ ] **Step 4.3: Re-run spec to green**

```bash
pnpm --filter @ai-hot-news/db test -- backfill-embeddings-sp7.spec.ts
```

期望 3/3 绿。

- [ ] **Step 4.4: Commit task 4**

```bash
git add packages/db/scripts/backfill-embeddings-sp7.ts packages/db/scripts/backfill-embeddings-sp7.spec.ts apps/worker/src/embed/group.service.ts
git commit -m "feat(sp7): backfill-embeddings-sp7 one-shot script + assignGroupCore export

- backfill-embeddings-sp7.ts: dual-mode entrypoint, batched call to OpenAI
  v3-small + raw SQL UPDATE + groupId assignment per row + JSON stats output
  (scanned/embedded/groupsFormed/multiPlatformGroups/failed/costUsd).
- group.service.ts: export pure assignGroupCore() for oneshot to bypass NestJS DI.
- 3 integration tests via packages/db vitest (file-parallelism=false safety)."
```

---

## Task 5: env + docker-compose 透传

**Goal:** 三个新 env 透传到 worker container。**仅写 `.env` 不够**（SP-4.7 PR #3 hot fix 教训）。

**Files:**
- Modify: `.env.example`
- Modify: `docker/docker-compose.prod.yml`

- [ ] **Step 5.1: `.env.example` 加 SP-7 段**

在 SP-5 段之后追加：

```bash
# ============================================================================
# SP-7: pgvector cross-platform merge (OpenAI direct, distinct from OpenRouter)
# ============================================================================
# OpenAI API key used for embeddings (NOT the OpenRouter key used for summary).
# Get one at https://platform.openai.com/api-keys. text-embedding-3-small is
# $0.02 per 1M tokens; 165 rows/day ≈ $0.005/month.
OPENAI_API_KEY=sk-proj-...

# Embedding model. Schema column is vector(1536), so any 1536-d model works
# (text-embedding-3-small is the v1 choice).
EMBED_MODEL=text-embedding-3-small

# Worker concurrency for the 'embed' BullMQ queue. OpenAI v3-small allows
# 5000 RPM, so 2 is conservatively safe for 165 rows/day ingestion bursts.
EMBED_CONCURRENCY=2
```

- [ ] **Step 5.2: `docker/docker-compose.prod.yml` worker.environment 加 3 行**

定位 `worker:` 段 `environment:` 列表，**逐项追加**（不要替换其他变量）：

```yaml
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      EMBED_MODEL: ${EMBED_MODEL}
      EMBED_CONCURRENCY: ${EMBED_CONCURRENCY}
```

- [ ] **Step 5.3: Commit task 5**

```bash
git add .env.example docker/docker-compose.prod.yml
git commit -m "chore(sp7): pass OPENAI_API_KEY / EMBED_MODEL / EMBED_CONCURRENCY into worker container

Worker.environment must explicitly list every env var (the SP-4.7 PR #3 lesson)."
```

---

## Task 6: PR-α — push, CI, merge, prod deploy + backfill

**Goal:** PR-α 闭环。Worker 在 prod 跑起来后开始算 embedding + groupId，但 API/UI 还看不见（PR-β 才暴露）。

- [ ] **Step 6.1: 在 prod `.env` 里写入 `OPENAI_API_KEY`**

```bash
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && cp .env .env.backup-$(date +%Y%m%d-%H%M%S)'
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && cat >> .env <<EOF
OPENAI_API_KEY=sk-proj-...
EMBED_MODEL=text-embedding-3-small
EMBED_CONCURRENCY=2
EOF'
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && grep -E "OPENAI_API_KEY|EMBED_" .env'
```

期望三行存在。**`OPENAI_API_KEY` 必须是你自己手动 paste 进去**（plan 里不留 key）。

- [ ] **Step 6.2: Push branch + open PR**

```bash
git push -u origin feat/sp7-A-embed-worker
gh pr create --title "feat(sp7-A): pgvector embed worker + summarize push hook + backfill script" --body "$(cat <<'EOF'
## Summary

PR-α of the 2-PR SP-7 chain (full design in `docs/superpowers/specs/2026-05-08-sp7-pgvector-cross-platform-merge-design.md`):

- New worker module `apps/worker/src/embed/` (queue + client + service + group service + processor + module) using OpenAI `text-embedding-3-small` (1536-d) + pgvector `<=>` cosine + 7d candidate window + +0.07 tag-overlap boost.
- SP-5 `SummarizeService` enqueues `embed:<id>` after `prisma.update({ summary, ... })` succeeds.
- One-shot backfill script `packages/db/scripts/backfill-embeddings-sp7.ts` (dual-mode entrypoint, JSON stats).
- env + docker-compose.prod.yml pass-through for `OPENAI_API_KEY` / `EMBED_MODEL` / `EMBED_CONCURRENCY`.
- ~21 new vitest cases covering each module + backfill integration.

**This PR alone does not change API/Web** — groupId is computed and stored, but `HotNewsListItemDto` doesn't yet expose `groupId` / `groupSize`. That comes in PR-β.

## Test plan

- [x] All embed module specs pass locally (`pnpm --filter @ai-hot-news/worker test -- embed`).
- [x] SummarizeService new cases (push embed + P2025 no-push) pass.
- [x] RedisModule regression spec includes `EmbedModule` import.
- [x] Backfill integration tests use `fileParallelism=false` shared dev DB (idempotency case proves scanned=0 on re-run).
- [ ] CI green.
- [ ] Prod deploy → boot backstop logs `re-queued N pending embed jobs`.
- [ ] Run `bash scripts/run-prod-oneshot.sh packages/db scripts/backfill-embeddings-sp7.ts` and capture JSON stats.
EOF
)"
```

- [ ] **Step 6.3: Wait for CI green, then `gh pr merge --squash --delete-branch`**

- [ ] **Step 6.4: Prod 部署后 30min 内观察 worker 日志**

```bash
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env logs --tail=200 worker' | grep -iE "embed|boot backstop"
```

期望看到 `EmbedModule] Boot backstop: re-queued N pending embed jobs` 以及若干 `embed <id> → ... tokens, group=...`。

- [ ] **Step 6.5: 跑 backfill 脚本（保险）**

```bash
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && bash scripts/run-prod-oneshot.sh packages/db scripts/backfill-embeddings-sp7.ts'
```

期望输出形如：

```json
{
  "scanned": 0,      ← boot backstop 已 catch up，第二次跑应 = 0
  "embedded": 0,
  "groupsFormed": 0,
  "multiPlatformGroups": 0,
  "failed": 0,
  "costUsd": "$0.0000"
}
```

如果第一次 boot backstop 没 catch up（worker 还没启动好），scanned 可能 > 0，没事。

- [ ] **Step 6.6: SQL 验证不变量**

```bash
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T postgres \
 psql -U ai_hot_news -d ai_hot_news_prod -v ON_ERROR_STOP=1 -c "
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE summary IS NOT NULL AND embedding IS NULL) AS missing_embed,
  COUNT(*) FILTER (WHERE \"groupId\" IS NOT NULL) AS in_group
FROM hot_news WHERE status=$$VISIBLE$$;
"'
```

期望 `missing_embed = 0`，`in_group > 0`（实测应有 10-30 个跨平台组）。

- [ ] **Step 6.7: 决定是否建 ivfflat 索引**

跑 EXPLAIN ANALYZE 看 GroupService 查询耗时：

```bash
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T postgres \
 psql -U ai_hot_news -d ai_hot_news_prod -c "
EXPLAIN ANALYZE
SELECT id, 1 - (embedding <=> (SELECT embedding FROM hot_news WHERE id = (SELECT id FROM hot_news WHERE embedding IS NOT NULL LIMIT 1))) AS cos
FROM hot_news
WHERE embedding IS NOT NULL AND status=$$VISIBLE$$
ORDER BY embedding <=> (SELECT embedding FROM hot_news WHERE id = (SELECT id FROM hot_news WHERE embedding IS NOT NULL LIMIT 1))
LIMIT 5;
"'
```

如 Execution Time > 50ms，独立 PR-α-2 加 ivfflat 索引：

```sql
CREATE INDEX hot_news_embedding_ivfflat_idx
  ON hot_news USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

否则跳过（YAGNI；165 行规模 seq scan 通常 < 5ms）。

---

## Task 7: PR-β — DTO + API + Web badge

**Goal:** 把 groupId/groupSize 暴露到 API + UI。

**Files:**
- Modify: `packages/types/src/dtos.ts`
- Modify: `apps/api/src/hot-news/hot-news.service.ts`
- Modify: `apps/api/src/hot-news/hot-news.service.spec.ts`
- Modify: `apps/web/app/news/_components/news-item.tsx`

- [ ] **Step 7.1: Branch + DTO**

```bash
git fetch origin
git checkout -b feat/sp7-B-api-ui origin/main
```

编辑 `packages/types/src/dtos.ts` `HotNewsListItemDto`：

```typescript
export interface HotNewsListItemDto {
  // ... existing fields ...
  groupId: string | null;
  groupSize: number;  // 1 when singleton or groupId=null
}
```

- [ ] **Step 7.2: API service — select + groupBy + DTO map**

编辑 `apps/api/src/hot-news/hot-news.service.ts` `list()`：

```typescript
const rows = await prisma.hotNews.findMany({
  where, skip, take, orderBy,
  select: {
    // ... existing fields ...
    groupId: true,   // ★ NEW
  },
});

const groupIds = [...new Set(rows.map(r => r.groupId).filter((g): g is string => g !== null))];
const counts = groupIds.length === 0 ? [] : await prisma.hotNews.groupBy({
  by: ['groupId'],
  where: { groupId: { in: groupIds }, status: 'VISIBLE' },
  _count: true,
});
const sizeMap = new Map(counts.map(c => [c.groupId!, c._count]));

return {
  items: rows.map(r => ({
    // ... existing fields ...
    groupId: r.groupId,
    groupSize: r.groupId ? (sizeMap.get(r.groupId) ?? 1) : 1,
  })),
  // ... total / page / pageSize unchanged ...
};
```

- [ ] **Step 7.3: API service spec — 3 new cases**

加到 `apps/api/src/hot-news/hot-news.service.spec.ts`：

```typescript
it('SP-7: singleton row → groupSize=1, groupId=null', async () => {
  // seed 1 row with groupId=null, call list(), assert item.groupSize === 1 && item.groupId === null
});

it('SP-7: cross-platform group of 3 → all members groupSize=3', async () => {
  // seed 3 rows sharing groupId='grp-shared' across HN+Reddit+RSS, call list(),
  // assert every item has groupSize === 3
});

it('SP-7: list() issues exactly ONE groupBy query regardless of N items', async () => {
  // spy on prisma.hotNews.groupBy, seed 10 rows in 2 groups, assert spy called once
});
```

跑 `pnpm --filter @ai-hot-news/api test -- hot-news.service.spec.ts`，期望 12+/12+ 绿。

- [ ] **Step 7.4: Web badge**

编辑 `apps/web/app/news/_components/news-item.tsx` —— 在卡片底部 (或现有 platform badge 旁边) 加：

```tsx
{item.groupSize > 1 && (
  <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[11px] font-medium text-purple-700">
    🔗 {item.groupSize} 个平台报道
  </span>
)}
```

- [ ] **Step 7.5: Build + commit + PR**

```bash
pnpm turbo run lint typecheck test
pnpm --filter @ai-hot-news/web build
git add packages/types apps/api apps/web
git commit -m "feat(sp7-B): expose groupId/groupSize through API + render group badge in /news"
git push -u origin feat/sp7-B-api-ui
gh pr create --title "feat(sp7-B): API + Web — '🔗 N 个平台报道' group badge" --body "..."
```

- [ ] **Step 7.6: Merge after CI green, smoke**

```bash
curl 'https://hotnews.shinpeionline.top/api/hot-news?pageSize=50' | jq '[.items[] | select(.groupSize > 1)] | length'
```

期望 ≥ 3 行（保守估计；prod 实际 1 周内的跨平台报道密度）。

---

## Task 8: Update decomposition design doc

**Goal:** 把 SP-7 加进 §11 状态追踪表 + 推进路线提示。

**Files:**
- Modify: `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md`

- [ ] **Step 8.1: 在 §11 追加 SP-7 行**

按现有格式（commit 范围、完成日期、关键产出、对后续 SP 的契约影响）追加。重点契约：
- `HotNewsListItemDto.groupId / groupSize` 新增字段（前向兼容）。
- `embedding` 列首次有数据 → SP-11 详情页"相关热点"可消费；SP-10 列表重做时可考虑 leader 折叠。
- backfill 一次性脚本范式 + 纯函数 `assignGroupCore` 导出 → 后续 prompt 版本 bump 触发 re-embed 时直接复用。

- [ ] **Step 8.2: 在末尾 "推进路线提示" 段加新 section**

```markdown
### 推进路线提示（更新于 SP-7 部署完成）

SP-7 已落地。下一步：
1. **SP-6（热度分计算）** — spec/plan 已就绪（PR #10 落地），可立即开 PR-A schema → PR-B API → PR-C worker 三段。
2. **SP-8（Aurora 视觉系统）→ MVP** — SP-6/SP-7 完工后启动；M5 MVP 里程碑。
3. **ivfflat 索引**（如 Task 6.7 未建）— hot_news 行数到 1000+ 时再 evaluate。
```

- [ ] **Step 8.3: Commit + PR or push to docs branch**

可以直接 push 到 main（pure docs），或开一个简短 docs PR。

---

## 5. 完成定义（DoD）

- 21+ 新 vitest case 全绿（embed 模块 + backfill + API + summarize push hook）。
- `pnpm turbo run lint typecheck test` 22/22+ 任务全绿。
- PR-α + PR-β 全部 merge 到 main，CI 全绿。
- prod 部署后 30min 内观察到：
  - 至少 1 条 worker 日志 `embed <id> → ... tokens, group=grp-... cosine=0.XX`
  - SQL `missing_embed = 0`
  - `/api/hot-news?pageSize=50` 至少 3 个 row 的 `groupSize > 1`
  - `/news` 页面手动浏览，看到至少 1 个 `🔗 N 个平台报道` 紫色 badge
- decomposition design doc 追加 SP-7 状态行 + 推进路线提示。

---

## 6. 已知未修隐患（write-up）

- **Group leader 切换不修复**（spec §5 风险表 row 3）：A 入了 group X，后来 B/C 跟 X 更像但 score < 0.85，导致 X 内部 cosine 分布不均。V1 接受这个 trade-off；如果 prod 实测看到 X 内最远两行 cosine < 0.7，再独立 SP 写 `GroupService.recompute`。
- **OpenAI v3-small 中文质量**：spec §3 决策 1 选 small 是赌跨平台报道的 titleZh+summary 字面重叠足够高（实测 SP-5 v3.4 的"腾讯 AI 速递"风格的确高重叠）。如果 prod 阈值 0.85 召回低于 80%，先调阈值（0.85→0.82），再考虑换 large（migration 列宽从 1536 改 3072）。
- **GroupService 查询性能**（spec §5 风险表 row 2）：165 行规模 seq scan 通常 < 5ms 不需要 ivfflat。当 hot_news 达 1000+ 行时回头跑 EXPLAIN ANALYZE 决定。
