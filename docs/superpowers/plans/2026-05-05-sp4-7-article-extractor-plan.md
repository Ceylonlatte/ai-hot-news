# SP-4.7 ArticleExtractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 SP-3 留下的 link-post 哨兵（`interactionData.externalUrl != null AND content == title`）提供异步、可降级、可观测的外链正文抽取，使 SP-5 摘要能基于真正文工作；不影响 ingest 主链路吞吐 / 不破坏 SP-4 / SP-4.5 已交付契约。

**Architecture:** 三段独立模块 + 一处 ingest 钩子：(a) `apps/worker/src/extract/` 新模块 — Firecrawl Cloud (优先) + Jina r.jina.ai (fallback) chain + ExtractService + 独立 BullMQ worker；(b) `apps/worker/src/summarize/` stub — 仅 SUMMARY_QUEUE token + 极简 Module（SP-5 后续扩展）；(c) `IngestionService` 入库后追加：`status=VISIBLE` 行总入 summary 队列、link-post 行额外入 extract 队列 + 同事务标 `extractStatus='PENDING'`。Schema 加 2 列 + partial index。

**Tech Stack:** NestJS · BullMQ · Prisma · Postgres (partial index) · Firecrawl `/v1/scrape` REST · Jina `r.jina.ai` REST · vitest · `vi.stubGlobal('fetch')` mock 套路（同 hackernews.crawler.spec）· `scripts/run-prod-oneshot.sh` 一次性脚本范式（SP-4 standard）。

**Spec:** `docs/superpowers/specs/2026-05-05-sp4-7-article-extractor-design.md`

---

## Pre-flight: assumptions about codebase state

These were verified before plan creation. If any have shifted, stop and re-verify before coding:

- `IngestionService` 在 `apps/worker/src/crawl/ingestion.service.ts` 没有 constructor，需要在 Task 11 加入两个 queue 注入。
- `ContentStatus`、`Platform`、`getPrisma`、`Prisma` 都从 `@ai-hot-news/db` 包名导出（`@ai-hot-news/db/src/index.ts` re-exports `./generated`）。
- `apps/worker/src/crawl/queue.provider.ts` 导出 `REDIS_CONNECTION` Symbol token + `redisProvider` 与 `queueProvider`；新模块 reuse `REDIS_CONNECTION` 即可，不重新建连接。
- 测试 mock fetch 全仓统一用 `vi.stubGlobal('fetch', fetchMock)` + `vi.unstubAllGlobals()` afterEach（参 `apps/worker/src/crawl/crawlers/hackernews.crawler.spec.ts`）。
- `apps/worker/Dockerfile` 已经 `COPY packages/db/scripts`（SP-4.5 落地）；prod 一次性脚本走 `scripts/run-prod-oneshot.sh <pkg> <relative-path-to-script>` 即可。
- `packages/db/scripts/cleanup-rss-pre-window.ts` 是 dual-mode entrypoint 的范式（SP-4.5）；新 wipe 脚本对齐它。
- `packages/db/vitest.config.ts` 设了 `fileParallelism: false`（SP-4.5 引入），新 wipe spec 不需要再独立配置。
- `apps/worker/src/worker.module.ts` 当前只 import `CrawlModule`；Task 12 需扩展。
- `.env` 在 prod 由 `/srv/ai-hot-news/.env` 提供，`docker compose --env-file .env`；`FIRECRAWL_API_KEY` / `JINA_API_KEY` 须在落地前 ssh 写入（Task 14 pre-flight）。

---

## Task 1: Prisma schema + migration (extractStatus + extractAttempts + partial index)

**Goal:** 给 `HotNews` 加两列 + partial index `WHERE extractStatus IN ('PENDING','FAILED')`，本地 migrate 通过。

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_sp4_7_extract_status/migration.sql`

- [ ] **Step 1.1: Modify `schema.prisma` — 加两列到 `HotNews` model**

定位 `model HotNews` 的 `filterReason String?` 行，紧接其后添加：

```prisma
model HotNews {
  // ... existing fields above (preserved verbatim) ...
  filterReason    String?
  extractStatus   String?
  extractAttempts Int      @default(0)
  // ... existing fields below (preserved verbatim) ...
}
```

不要动 `@@index` 段（partial index 用 SQL 写在 migration 里，prisma DSL 不支持 partial）。

- [ ] **Step 1.2: 跑 prisma migrate dev 生成 migration 文件**

```bash
cd packages/db
pnpm prisma migrate dev --name sp4_7_extract_status --skip-seed
```

期望输出含：
- `Applied migration: <timestamp>_sp4_7_extract_status`
- `Generated Prisma Client`

migration.sql 此时只含 ALTER TABLE 两行。

- [ ] **Step 1.3: 在生成的 migration.sql 末尾追加 partial index**

打开 `packages/db/prisma/migrations/<timestamp>_sp4_7_extract_status/migration.sql`，**追加**：

```sql
-- SP-4.7: partial index for worker boot backstop scan + ops backfill query.
-- VISIBLE/EXTRACTED rows (the vast majority) skip the index entirely.
CREATE INDEX "hot_news_extract_pending_idx"
  ON "hot_news" ("extractStatus")
  WHERE "extractStatus" IN ('PENDING', 'FAILED');
```

- [ ] **Step 1.4: Reset + reapply 让 partial index 入库（dev 容器）**

```bash
cd packages/db
pnpm prisma migrate reset --force --skip-seed --skip-generate
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c "\d hot_news"
```

期望 `\d hot_news` 输出包含：
- `extractStatus    | text`
- `extractAttempts  | integer | not null default 0`
- `"hot_news_extract_pending_idx" btree ("extractStatus") WHERE "extractStatus" = ANY (ARRAY['PENDING'::text, 'FAILED'::text])`

- [ ] **Step 1.5: 跑 db 包自身测试，确保现存 fixtures / spec 没被打破**

```bash
pnpm --filter @ai-hot-news/db run lint typecheck test
```

期望全绿（应无失败 — 加列不破坏既有 spec）。

- [ ] **Step 1.6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(sp4.7): add extractStatus + extractAttempts to HotNews + partial index"
```

---

## Task 2: One-shot wipe script (`packages/db/scripts/wipe-hot-news-pre-ai.ts`)

**Goal:** AI 阶段开机一次性脚本：清空 `hot_news` 表（KeywordHit 由 onDelete cascade 自动处理）。dual-mode entrypoint 与 SP-4.5 `cleanup-rss-pre-window.ts` 对齐。

**Files:**
- Create: `packages/db/scripts/wipe-hot-news-pre-ai.ts`
- Create: `packages/db/scripts/wipe-hot-news-pre-ai.spec.ts`

- [ ] **Step 2.1: Write the failing tests**

新建 `packages/db/scripts/wipe-hot-news-pre-ai.spec.ts`：

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Platform, getPrisma } from '@ai-hot-news/db';
import { runWipe } from './wipe-hot-news-pre-ai';

const prisma = getPrisma();

describe('wipe-hot-news-pre-ai', () => {
  beforeEach(async () => {
    await prisma.keywordHit.deleteMany({});
    await prisma.hotNews.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('deletes all hot_news rows regardless of platform / status', async () => {
    await prisma.hotNews.createMany({
      data: [
        {
          sourcePlatform: Platform.HACKERNEWS,
          sourceId: 'hn-1',
          sourceUrl: 'https://news.ycombinator.com/item?id=1',
          title: 'a',
          content: 'a',
          rawHtml: null,
          publishedAt: new Date('2026-05-01'),
          dedupeHash: 'h1',
          status: 'VISIBLE',
        },
        {
          sourcePlatform: Platform.RSS,
          sourceId: 'rss-1',
          sourceUrl: 'https://example.com/post',
          title: 'b',
          content: 'b',
          rawHtml: null,
          publishedAt: new Date('2026-05-02'),
          dedupeHash: 'h2',
          status: 'HIDDEN',
        },
      ],
    });
    const before = await prisma.hotNews.count();
    expect(before).toBe(2);

    const result = await runWipe();

    expect(result.before).toBe(2);
    expect(result.deleted).toBe(2);
    expect(result.after).toBe(0);
  });

  it('does not touch source_configs', async () => {
    const sourcesBefore = await prisma.sourceConfig.count();
    await runWipe();
    const sourcesAfter = await prisma.sourceConfig.count();
    expect(sourcesAfter).toBe(sourcesBefore);
  });

  it('returns 0/0/0 when called against an empty table', async () => {
    const result = await runWipe();
    expect(result).toEqual({ before: 0, deleted: 0, after: 0 });
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

```bash
pnpm --filter @ai-hot-news/db run test -- wipe-hot-news-pre-ai
```

期望 FAIL：`Cannot find module './wipe-hot-news-pre-ai'`.

- [ ] **Step 2.3: Implement `wipe-hot-news-pre-ai.ts`**

新建 `packages/db/scripts/wipe-hot-news-pre-ai.ts`：

```ts
import { getPrisma } from '@ai-hot-news/db';

export interface WipeResult {
  before: number;
  deleted: number;
  after: number;
}

export async function runWipe(): Promise<WipeResult> {
  const prisma = getPrisma();
  const before = await prisma.hotNews.count();
  console.log(`[wipe-pre-ai] Before: ${before} rows`);

  const result = await prisma.hotNews.deleteMany({});
  const after = await prisma.hotNews.count();
  console.log(`[wipe-pre-ai] Deleted ${result.count} rows, after: ${after}`);

  return { before, deleted: result.count, after };
}

async function main(): Promise<void> {
  const stats = await runWipe();
  console.log(JSON.stringify(stats, null, 2));
}

const isMainEntry =
  typeof require !== 'undefined' && require.main === module;
const isTsxEntry = process.argv[1]?.endsWith('wipe-hot-news-pre-ai.ts');

if (isMainEntry || isTsxEntry) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/db run test -- wipe-hot-news-pre-ai
```

期望 PASS（3/3 绿）。

- [ ] **Step 2.5: Commit**

```bash
git add packages/db/scripts/wipe-hot-news-pre-ai.ts packages/db/scripts/wipe-hot-news-pre-ai.spec.ts
git commit -m "feat(sp4.7): one-shot wipe script for AI-stage clean start"
```

---

## Task 3: Provider interface (`extract/providers/provider.interface.ts`)

**Goal:** 定义 `ExtractProvider` interface 和三个 fallback 决策用 Error 类型；下游 Firecrawl/Jina/Chain 共用。

**Files:**
- Create: `apps/worker/src/extract/providers/provider.interface.ts`

- [ ] **Step 3.1: Implement the interface file**

新建 `apps/worker/src/extract/providers/provider.interface.ts`：

```ts
export interface ExtractedArticle {
  contentText: string;
  rawHtml: string | null;
  /**
   * 三方可能返回更准确的标题；SP-4.7 不强制覆盖 HotNews.title。
   * 仅作日志 / 调试观察用，extract.service 不消费。
   */
  title?: string | null;
}

export interface ExtractProvider {
  readonly name: 'firecrawl' | 'jina';
  extract(url: string, signal: AbortSignal): Promise<ExtractedArticle>;
}

/**
 * 三类错误用于 chain.ts 的不同 fallback 决策：
 *  - QuotaExceededError    → fallback 到下一 provider
 *  - TransientFetchError   → fallback；都失败时让 BullMQ retry
 *  - PermanentFetchError   → 立即终止整个 chain（4xx 不会变成 200）
 */
export class QuotaExceededError extends Error {
  constructor(public provider: 'firecrawl' | 'jina') {
    super(`${provider} quota / rate exceeded`);
    this.name = 'QuotaExceededError';
  }
}

export class TransientFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientFetchError';
  }
}

export class PermanentFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentFetchError';
  }
}
```

- [ ] **Step 3.2: Typecheck**

```bash
pnpm --filter @ai-hot-news/worker run typecheck
```

期望 PASS。

- [ ] **Step 3.3: Commit**

```bash
git add apps/worker/src/extract/providers/provider.interface.ts
git commit -m "feat(sp4.7): extract provider interface + 3 fallback error types"
```

---

## Task 4: Firecrawl provider (TDD)

**Goal:** 实现 Firecrawl `/v1/scrape` REST client，正确分类 200/402/429/401/403/404/410/5xx。

**Files:**
- Create: `apps/worker/src/extract/providers/firecrawl.provider.ts`
- Create: `apps/worker/src/extract/providers/firecrawl.provider.spec.ts`

- [ ] **Step 4.1: Write the failing tests**

新建 `apps/worker/src/extract/providers/firecrawl.provider.spec.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirecrawlProvider } from './firecrawl.provider';
import {
  QuotaExceededError,
  TransientFetchError,
  PermanentFetchError,
} from './provider.interface';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('FirecrawlProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const provider = new FirecrawlProvider();

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = 'fc-test';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
    delete process.env.FIRECRAWL_API_KEY;
  });

  it('returns ExtractedArticle on 200', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          markdown: '# Hello\n\nworld'.repeat(50),
          html: '<h1>Hello</h1>',
          metadata: { title: 'Hello' },
        },
      }),
    );

    const result = await provider.extract(
      'https://example.com/post',
      new AbortController().signal,
    );

    expect(result.contentText).toMatch(/^# Hello/);
    expect(result.rawHtml).toBe('<h1>Hello</h1>');
    expect(result.title).toBe('Hello');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v1/scrape',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer fc-test',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('throws QuotaExceededError on 402', async () => {
    fetchMock.mockResolvedValue(new Response('payment required', { status: 402 }));
    await expect(
      provider.extract('https://example.com/x', new AbortController().signal),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('throws QuotaExceededError on 429 (rate limit treated as quota for fallback purposes)', async () => {
    fetchMock.mockResolvedValue(new Response('rate', { status: 429 }));
    await expect(
      provider.extract('https://example.com/x', new AbortController().signal),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('throws PermanentFetchError on 401 / 403 / 404 / 410', async () => {
    for (const status of [401, 403, 404, 410]) {
      fetchMock.mockResolvedValue(new Response('nope', { status }));
      await expect(
        provider.extract('https://example.com/x', new AbortController().signal),
      ).rejects.toBeInstanceOf(PermanentFetchError);
    }
  });

  it('throws TransientFetchError on 5xx', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 503 }));
    await expect(
      provider.extract('https://example.com/x', new AbortController().signal),
    ).rejects.toBeInstanceOf(TransientFetchError);
  });

  it('throws when FIRECRAWL_API_KEY not set', async () => {
    delete process.env.FIRECRAWL_API_KEY;
    await expect(
      provider.extract('https://example.com/x', new AbortController().signal),
    ).rejects.toThrow(/FIRECRAWL_API_KEY/);
  });
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

```bash
pnpm --filter @ai-hot-news/worker run test -- firecrawl.provider
```

期望 FAIL：找不到 `./firecrawl.provider`。

- [ ] **Step 4.3: Implement `firecrawl.provider.ts`**

新建 `apps/worker/src/extract/providers/firecrawl.provider.ts`：

```ts
import {
  ExtractProvider,
  ExtractedArticle,
  QuotaExceededError,
  TransientFetchError,
  PermanentFetchError,
} from './provider.interface';

export class FirecrawlProvider implements ExtractProvider {
  readonly name = 'firecrawl' as const;

  async extract(url: string, signal: AbortSignal): Promise<ExtractedArticle> {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY not configured');

    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'html'],
        onlyMainContent: true,
      }),
      signal,
    });

    if (res.status === 402 || res.status === 429) {
      throw new QuotaExceededError('firecrawl');
    }
    if (res.status === 401 || res.status === 403) {
      throw new PermanentFetchError(`firecrawl auth ${res.status}`);
    }
    if (res.status === 404 || res.status === 410) {
      throw new PermanentFetchError(`firecrawl ${res.status}`);
    }
    if (!res.ok) {
      throw new TransientFetchError(`firecrawl ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      data?: { markdown?: string; html?: string; metadata?: { title?: string } };
    };
    return {
      contentText: data?.data?.markdown ?? '',
      rawHtml: data?.data?.html ?? null,
      title: data?.data?.metadata?.title ?? null,
    };
  }
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/worker run test -- firecrawl.provider
```

期望 PASS（6/6 绿）。

- [ ] **Step 4.5: Commit**

```bash
git add apps/worker/src/extract/providers/firecrawl.provider.ts apps/worker/src/extract/providers/firecrawl.provider.spec.ts
git commit -m "feat(sp4.7): firecrawl /v1/scrape provider with status code dispatch"
```

---

## Task 5: Jina provider (TDD)

**Goal:** 实现 `r.jina.ai/<url>` REST client，正确分类 200/402/429/404/410/5xx。

**Files:**
- Create: `apps/worker/src/extract/providers/jina.provider.ts`
- Create: `apps/worker/src/extract/providers/jina.provider.spec.ts`

- [ ] **Step 5.1: Write the failing tests**

新建 `apps/worker/src/extract/providers/jina.provider.spec.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JinaProvider } from './jina.provider';
import {
  QuotaExceededError,
  TransientFetchError,
  PermanentFetchError,
} from './provider.interface';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('JinaProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const provider = new JinaProvider();

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
    delete process.env.JINA_API_KEY;
  });

  it('returns ExtractedArticle on 200 (anonymous)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { content: 'body text', title: 'Title' } }),
    );
    const result = await provider.extract(
      'https://example.com/post',
      new AbortController().signal,
    );
    expect(result).toEqual({ contentText: 'body text', rawHtml: null, title: 'Title' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://r.jina.ai/https://example.com/post',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/json' }),
      }),
    );
  });

  it('sends Authorization header when JINA_API_KEY is set', async () => {
    process.env.JINA_API_KEY = 'jina-test';
    fetchMock.mockResolvedValue(jsonResponse({ data: { content: 'x' } }));
    await provider.extract('https://example.com/x', new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jina-test' }),
      }),
    );
  });

  it('throws QuotaExceededError on 402 / 429', async () => {
    for (const status of [402, 429]) {
      fetchMock.mockResolvedValue(new Response('quota', { status }));
      await expect(
        provider.extract('https://example.com/x', new AbortController().signal),
      ).rejects.toBeInstanceOf(QuotaExceededError);
    }
  });

  it('throws PermanentFetchError on 404 / 410', async () => {
    for (const status of [404, 410]) {
      fetchMock.mockResolvedValue(new Response('gone', { status }));
      await expect(
        provider.extract('https://example.com/x', new AbortController().signal),
      ).rejects.toBeInstanceOf(PermanentFetchError);
    }
  });

  it('throws TransientFetchError on 5xx', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 502 }));
    await expect(
      provider.extract('https://example.com/x', new AbortController().signal),
    ).rejects.toBeInstanceOf(TransientFetchError);
  });
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

```bash
pnpm --filter @ai-hot-news/worker run test -- jina.provider
```

期望 FAIL：找不到模块。

- [ ] **Step 5.3: Implement `jina.provider.ts`**

新建 `apps/worker/src/extract/providers/jina.provider.ts`：

```ts
import {
  ExtractProvider,
  ExtractedArticle,
  QuotaExceededError,
  TransientFetchError,
  PermanentFetchError,
} from './provider.interface';

export class JinaProvider implements ExtractProvider {
  readonly name = 'jina' as const;

  async extract(url: string, signal: AbortSignal): Promise<ExtractedArticle> {
    const apiKey = process.env.JINA_API_KEY;
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal,
    });

    if (res.status === 402 || res.status === 429) {
      throw new QuotaExceededError('jina');
    }
    if (res.status === 404 || res.status === 410) {
      throw new PermanentFetchError(`jina ${res.status}`);
    }
    if (!res.ok) {
      throw new TransientFetchError(`jina ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      data?: { content?: string; title?: string };
    };
    return {
      contentText: data?.data?.content ?? '',
      rawHtml: null,
      title: data?.data?.title ?? null,
    };
  }
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/worker run test -- jina.provider
```

期望 PASS（5/5 绿）。

- [ ] **Step 5.5: Commit**

```bash
git add apps/worker/src/extract/providers/jina.provider.ts apps/worker/src/extract/providers/jina.provider.spec.ts
git commit -m "feat(sp4.7): jina r.jina.ai provider with status code dispatch"
```

---

## Task 6: ExtractChain — Firecrawl → Jina fallback (TDD)

**Goal:** 编排两个 provider，按 `QuotaExceededError` / `TransientFetchError` 退化到下一家；`PermanentFetchError` 立即抛；抽到 < 200 字算失败试下一家。

**Files:**
- Create: `apps/worker/src/extract/providers/chain.ts`
- Create: `apps/worker/src/extract/providers/chain.spec.ts`

- [ ] **Step 6.1: Write the failing tests**

新建 `apps/worker/src/extract/providers/chain.spec.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { ExtractChain } from './chain';
import {
  ExtractProvider,
  ExtractedArticle,
  QuotaExceededError,
  TransientFetchError,
  PermanentFetchError,
} from './provider.interface';

function fakeProvider(
  name: 'firecrawl' | 'jina',
  impl: () => Promise<ExtractedArticle>,
): ExtractProvider {
  return { name, extract: vi.fn(impl) as ExtractProvider['extract'] };
}

const longText = 'a'.repeat(500);

describe('ExtractChain', () => {
  it('returns first provider success without calling second', async () => {
    const second = vi.fn();
    const chain = new ExtractChain([
      fakeProvider('firecrawl', async () => ({
        contentText: longText,
        rawHtml: null,
      })),
      { name: 'jina', extract: second },
    ]);

    const out = await chain.extract('https://example.com');

    expect(out.usedProvider).toBe('firecrawl');
    expect(out.result.contentText).toBe(longText);
    expect(second).not.toHaveBeenCalled();
  });

  it('falls back to second provider on QuotaExceededError', async () => {
    const chain = new ExtractChain([
      fakeProvider('firecrawl', async () => {
        throw new QuotaExceededError('firecrawl');
      }),
      fakeProvider('jina', async () => ({
        contentText: longText,
        rawHtml: null,
      })),
    ]);

    const out = await chain.extract('https://example.com');

    expect(out.usedProvider).toBe('jina');
  });

  it('falls back to second provider on TransientFetchError', async () => {
    const chain = new ExtractChain([
      fakeProvider('firecrawl', async () => {
        throw new TransientFetchError('boom');
      }),
      fakeProvider('jina', async () => ({
        contentText: longText,
        rawHtml: null,
      })),
    ]);

    const out = await chain.extract('https://example.com');
    expect(out.usedProvider).toBe('jina');
  });

  it('throws PermanentFetchError immediately, does NOT try second provider', async () => {
    const second = vi.fn();
    const chain = new ExtractChain([
      fakeProvider('firecrawl', async () => {
        throw new PermanentFetchError('404');
      }),
      { name: 'jina', extract: second },
    ]);

    await expect(chain.extract('https://example.com')).rejects.toBeInstanceOf(
      PermanentFetchError,
    );
    expect(second).not.toHaveBeenCalled();
  });

  it('falls back when first provider returns content shorter than 200 chars', async () => {
    const chain = new ExtractChain([
      fakeProvider('firecrawl', async () => ({
        contentText: 'too short',
        rawHtml: null,
      })),
      fakeProvider('jina', async () => ({
        contentText: longText,
        rawHtml: null,
      })),
    ]);

    const out = await chain.extract('https://example.com');
    expect(out.usedProvider).toBe('jina');
  });

  it('throws last error when all providers fail', async () => {
    const chain = new ExtractChain([
      fakeProvider('firecrawl', async () => {
        throw new QuotaExceededError('firecrawl');
      }),
      fakeProvider('jina', async () => {
        throw new QuotaExceededError('jina');
      }),
    ]);

    await expect(chain.extract('https://example.com')).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
  });
});
```

- [ ] **Step 6.2: Run tests to verify they fail**

```bash
pnpm --filter @ai-hot-news/worker run test -- chain.spec
```

期望 FAIL：找不到 `./chain`。

- [ ] **Step 6.3: Implement `chain.ts`**

新建 `apps/worker/src/extract/providers/chain.ts`：

```ts
import {
  ExtractProvider,
  ExtractedArticle,
  PermanentFetchError,
  TransientFetchError,
} from './provider.interface';

const MIN_CONTENT_LENGTH = 200;
const TOTAL_TIMEOUT_MS = 45_000;

export interface ChainResult {
  result: ExtractedArticle;
  usedProvider: 'firecrawl' | 'jina';
}

export class ExtractChain {
  constructor(private readonly providers: ExtractProvider[]) {}

  async extract(url: string): Promise<ChainResult> {
    const signal = AbortSignal.timeout(TOTAL_TIMEOUT_MS);
    let lastErr: Error | null = null;

    for (const p of this.providers) {
      try {
        const result = await p.extract(url, signal);
        if (!result.contentText || result.contentText.length < MIN_CONTENT_LENGTH) {
          lastErr = new TransientFetchError(
            `${p.name} content too short (${result.contentText.length} chars)`,
          );
          continue;
        }
        return { result, usedProvider: p.name };
      } catch (err) {
        lastErr = err as Error;
        if (err instanceof PermanentFetchError) throw err;
      }
    }
    throw lastErr ?? new TransientFetchError('All providers failed');
  }
}
```

- [ ] **Step 6.4: Run tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/worker run test -- chain.spec
```

期望 PASS（6/6 绿）。

- [ ] **Step 6.5: Commit**

```bash
git add apps/worker/src/extract/providers/chain.ts apps/worker/src/extract/providers/chain.spec.ts
git commit -m "feat(sp4.7): firecrawl→jina fallback chain"
```

---

## Task 7: Stub `summarize/` module (queue.ts + module.ts)

**Goal:** 给 ExtractModule import 用的 SUMMARY_QUEUE token + 极简 SummarizeModule。SP-5 后续会扩展同一个 `summarize.module.ts` 加 worker / service / strategy。

**Files:**
- Create: `apps/worker/src/summarize/summarize.queue.ts`
- Create: `apps/worker/src/summarize/summarize.module.ts`

- [ ] **Step 7.1: Implement `summarize.queue.ts`**

新建 `apps/worker/src/summarize/summarize.queue.ts`：

```ts
import { Provider } from '@nestjs/common';
import { Queue, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CONNECTION } from '../crawl/queue.provider';

export const SUMMARY_QUEUE_NAME = 'summary';
export const SUMMARY_QUEUE = Symbol('SUMMARY_QUEUE');

export const summaryQueueProvider: Provider = {
  provide: SUMMARY_QUEUE,
  useFactory: (connection: IORedis): Queue =>
    new Queue(SUMMARY_QUEUE_NAME, {
      connection: connection as unknown as ConnectionOptions,
    }),
  inject: [REDIS_CONNECTION],
};
```

- [ ] **Step 7.2: Implement `summarize.module.ts` (stub)**

新建 `apps/worker/src/summarize/summarize.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { SUMMARY_QUEUE, summaryQueueProvider } from './summarize.queue';

/**
 * SP-4.7 阶段：仅暴露 SUMMARY_QUEUE token。
 * SP-5 ship 时会扩展本 module，加 SUMMARY_WORKER + SummarizeService + Strategy +
 * OnApplicationBootstrap (boot backstop 扫 summary IS NULL 入队)。
 */
@Module({
  providers: [summaryQueueProvider],
  exports: [SUMMARY_QUEUE],
})
export class SummarizeModule {}
```

- [ ] **Step 7.3: Typecheck**

```bash
pnpm --filter @ai-hot-news/worker run typecheck
```

期望 PASS。

- [ ] **Step 7.4: Commit**

```bash
git add apps/worker/src/summarize/
git commit -m "feat(sp4.7): stub SummarizeModule with SUMMARY_QUEUE token (SP-5 will extend)"
```

---

## Task 8: ExtractQueue + ExtractProcessor (lightweight glue)

**Goal:** Queue/Worker 工厂 + processor。无独立测试（被 module 集成测试覆盖）。

**Files:**
- Create: `apps/worker/src/extract/extract.queue.ts`
- Create: `apps/worker/src/extract/extract.processor.ts`

- [ ] **Step 8.1: Implement `extract.queue.ts`**

新建 `apps/worker/src/extract/extract.queue.ts`：

```ts
import { Provider } from '@nestjs/common';
import { Queue, Worker, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CONNECTION } from '../crawl/queue.provider';

export const EXTRACT_QUEUE_NAME = 'extract';
export const EXTRACT_QUEUE = Symbol('EXTRACT_QUEUE');
export const EXTRACT_WORKER = Symbol('EXTRACT_WORKER');

export const extractQueueProvider: Provider = {
  provide: EXTRACT_QUEUE,
  useFactory: (connection: IORedis): Queue =>
    new Queue(EXTRACT_QUEUE_NAME, {
      connection: connection as unknown as ConnectionOptions,
    }),
  inject: [REDIS_CONNECTION],
};

export function createExtractWorker(
  processor: (jobName: string, jobData: unknown) => Promise<void>,
  connection: IORedis,
): Worker {
  const concurrency = parseInt(process.env.EXTRACT_CONCURRENCY ?? '2', 10);
  return new Worker(
    EXTRACT_QUEUE_NAME,
    async (job) => processor(job.name, job.data),
    {
      connection: connection as unknown as ConnectionOptions,
      concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 2,
    },
  );
}
```

- [ ] **Step 8.2: Implement `extract.processor.ts`**

新建 `apps/worker/src/extract/extract.processor.ts`：

```ts
import { ExtractService } from './extract.service';

export interface ExtractJobData {
  hotNewsId: string;
}

export async function processExtractJob(
  data: ExtractJobData,
  service: ExtractService,
): Promise<void> {
  await service.run(data.hotNewsId);
}
```

注：`ExtractService` 在 Task 9 落地，typecheck 在 Task 9 step 9.4 后才会全绿。这里先把 file 落盘。

- [ ] **Step 8.3: Commit**

```bash
git add apps/worker/src/extract/extract.queue.ts apps/worker/src/extract/extract.processor.ts
git commit -m "feat(sp4.7): extract queue + processor scaffolding"
```

---

## Task 9: ExtractService — core flow (TDD)

**Goal:** 拉 row → check status → chain.extract → UPDATE content+rawHtml+summary=NULL+aiTags=[]+extractStatus → push summary:<id>。失败时累 attempts，attempts ≥ 3 或 PermanentFetchError 时置 'FAILED'；TransientFetchError 中间态抛错让 BullMQ retry。

**Files:**
- Create: `apps/worker/src/extract/extract.service.ts`
- Create: `apps/worker/src/extract/extract.service.spec.ts`

- [ ] **Step 9.1: Write the failing tests**

新建 `apps/worker/src/extract/extract.service.spec.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { ExtractService } from './extract.service';
import {
  PermanentFetchError,
  TransientFetchError,
} from './providers/provider.interface';

const mockPrisma = {
  hotNews: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};
vi.mock('@ai-hot-news/db', () => ({
  getPrisma: () => mockPrisma,
}));

describe('ExtractService', () => {
  let chain: { extract: ReturnType<typeof vi.fn> };
  let summaryQueue: { add: ReturnType<typeof vi.fn> };
  let service: ExtractService;

  beforeEach(() => {
    chain = { extract: vi.fn() };
    summaryQueue = { add: vi.fn().mockResolvedValue(undefined) };
    service = new ExtractService(
      chain as unknown as import('./providers/chain').ExtractChain,
      summaryQueue as unknown as Queue,
    );
    mockPrisma.hotNews.findUnique.mockReset();
    mockPrisma.hotNews.update.mockReset();
  });

  afterEach(() => vi.resetAllMocks());

  const baseRow = {
    id: 'hn-1',
    title: 'A',
    content: 'A',
    extractStatus: 'PENDING',
    extractAttempts: 0,
    interactionData: { externalUrl: 'https://example.com/post' },
  };

  it('updates content + rawHtml + summary=null + aiTags=[] + extractStatus=EXTRACTED on success, then enqueues summary', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(baseRow);
    chain.extract.mockResolvedValue({
      result: { contentText: 'real article body', rawHtml: '<p>x</p>', title: 'A' },
      usedProvider: 'firecrawl',
    });

    await service.run('hn-1');

    expect(mockPrisma.hotNews.update).toHaveBeenCalledWith({
      where: { id: 'hn-1' },
      data: expect.objectContaining({
        content: 'real article body',
        rawHtml: '<p>x</p>',
        summary: null,
        aiTags: [],
        extractStatus: 'EXTRACTED',
        extractAttempts: 1,
      }),
    });
    expect(summaryQueue.add).toHaveBeenCalledWith(
      'summarize',
      { hotNewsId: 'hn-1' },
      expect.objectContaining({ jobId: 'summarize-hn-1' }),
    );
  });

  it('marks FAILED on PermanentFetchError without throwing (no BullMQ retry)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(baseRow);
    chain.extract.mockRejectedValue(new PermanentFetchError('404'));

    await expect(service.run('hn-1')).resolves.toBeUndefined();

    expect(mockPrisma.hotNews.update).toHaveBeenCalledWith({
      where: { id: 'hn-1' },
      data: { extractStatus: 'FAILED', extractAttempts: 1 },
    });
    expect(summaryQueue.add).not.toHaveBeenCalled();
  });

  it('throws to let BullMQ retry on first TransientFetchError (attempts < 3)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({ ...baseRow, extractAttempts: 0 });
    chain.extract.mockRejectedValue(new TransientFetchError('boom'));

    await expect(service.run('hn-1')).rejects.toBeInstanceOf(TransientFetchError);

    expect(mockPrisma.hotNews.update).toHaveBeenCalledWith({
      where: { id: 'hn-1' },
      data: { extractStatus: 'PENDING', extractAttempts: 1 },
    });
  });

  it('marks FAILED when TransientFetchError reaches attempts >= 3 (no rethrow)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({ ...baseRow, extractAttempts: 2 });
    chain.extract.mockRejectedValue(new TransientFetchError('still boom'));

    await expect(service.run('hn-1')).resolves.toBeUndefined();

    expect(mockPrisma.hotNews.update).toHaveBeenCalledWith({
      where: { id: 'hn-1' },
      data: { extractStatus: 'FAILED', extractAttempts: 3 },
    });
  });

  it('skips when row.extractStatus is already EXTRACTED', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({
      ...baseRow,
      extractStatus: 'EXTRACTED',
    });

    await service.run('hn-1');

    expect(chain.extract).not.toHaveBeenCalled();
    expect(mockPrisma.hotNews.update).not.toHaveBeenCalled();
  });

  it('skips when row.extractStatus is FAILED (terminal)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({ ...baseRow, extractStatus: 'FAILED' });
    await service.run('hn-1');
    expect(chain.extract).not.toHaveBeenCalled();
  });

  it('clears extractStatus when externalUrl is missing/invalid (sentinel broken)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({
      ...baseRow,
      interactionData: { externalUrl: 'mailto:nope' }, // not http(s)
    });

    await service.run('hn-1');

    expect(chain.extract).not.toHaveBeenCalled();
    expect(mockPrisma.hotNews.update).toHaveBeenCalledWith({
      where: { id: 'hn-1' },
      data: { extractStatus: null },
    });
  });

  it('skips when row not found', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(null);
    await service.run('missing');
    expect(chain.extract).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 9.2: Run tests to verify they fail**

```bash
pnpm --filter @ai-hot-news/worker run test -- extract.service
```

期望 FAIL：找不到 `./extract.service`。

- [ ] **Step 9.3: Implement `extract.service.ts`**

新建 `apps/worker/src/extract/extract.service.ts`：

```ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { getPrisma } from '@ai-hot-news/db';
import { ExtractChain } from './providers/chain';
import { PermanentFetchError } from './providers/provider.interface';
import { SUMMARY_QUEUE } from '../summarize/summarize.queue';

const MAX_ATTEMPTS = 3;
const MAX_CONTENT_CHARS = 50_000;

@Injectable()
export class ExtractService {
  private readonly logger = new Logger(ExtractService.name);

  constructor(
    private readonly chain: ExtractChain,
    @Inject(SUMMARY_QUEUE) private readonly summaryQueue: Queue,
  ) {}

  async run(hotNewsId: string): Promise<void> {
    const prisma = getPrisma();
    const row = await prisma.hotNews.findUnique({
      where: { id: hotNewsId },
      select: {
        id: true,
        title: true,
        content: true,
        extractStatus: true,
        extractAttempts: true,
        interactionData: true,
      },
    });
    if (!row) {
      this.logger.warn(`Row ${hotNewsId} not found, skip`);
      return;
    }
    if (row.extractStatus === 'EXTRACTED') return;
    if (row.extractStatus === 'FAILED') return;

    const url = (row.interactionData as { externalUrl?: string } | null)?.externalUrl;
    if (!url || typeof url !== 'string' || !/^https?:/.test(url)) {
      await prisma.hotNews.update({
        where: { id: hotNewsId },
        data: { extractStatus: null },
      });
      return;
    }

    try {
      const { result, usedProvider } = await this.chain.extract(url);
      const cleanText = result.contentText
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, MAX_CONTENT_CHARS);

      await prisma.hotNews.update({
        where: { id: hotNewsId },
        data: {
          content: cleanText,
          rawHtml: result.rawHtml,
          summary: null,
          aiTags: [],
          extractStatus: 'EXTRACTED',
          extractAttempts: row.extractAttempts + 1,
        },
      });

      await this.summaryQueue.add(
        'summarize',
        { hotNewsId },
        {
          jobId: `summarize-${hotNewsId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );

      this.logger.log(
        `Extracted ${url} via ${usedProvider} (${cleanText.length} chars), re-summarize queued`,
      );
    } catch (err) {
      const attempts = row.extractAttempts + 1;
      const isPermanent = err instanceof PermanentFetchError;
      const reachedLimit = attempts >= MAX_ATTEMPTS;
      const finalStatus = (isPermanent || reachedLimit) ? 'FAILED' : 'PENDING';

      await prisma.hotNews.update({
        where: { id: hotNewsId },
        data: { extractStatus: finalStatus, extractAttempts: attempts },
      });

      const msg = (err as Error).message;
      if (finalStatus === 'PENDING') {
        this.logger.warn(
          `Extract attempt ${attempts}/${MAX_ATTEMPTS} failed for ${url}: ${msg}, will retry`,
        );
        throw err;
      }
      this.logger.warn(
        `Extract permanently failed for ${url} (${attempts}/${MAX_ATTEMPTS}): ${msg}`,
      );
    }
  }
}
```

- [ ] **Step 9.4: Run tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/worker run test -- extract.service
```

期望 PASS（8/8 绿）。

- [ ] **Step 9.5: Commit**

```bash
git add apps/worker/src/extract/extract.service.ts apps/worker/src/extract/extract.service.spec.ts
git commit -m "feat(sp4.7): ExtractService with attempts state machine + re-summarize trigger"
```

---

## Task 10: ExtractModule — boot backstop + worker wiring (TDD)

**Goal:** NestJS module 把 chain / service / queue / worker 串起来；`OnApplicationBootstrap` 扫 `extractStatus='PENDING'` 重新入队 (jobId 自然幂等)；`OnModuleDestroy` 关 worker。

**Files:**
- Create: `apps/worker/src/extract/extract.module.ts`
- Create: `apps/worker/src/extract/extract.module.spec.ts`

- [ ] **Step 10.1: Write the failing tests**

新建 `apps/worker/src/extract/extract.module.spec.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Queue, Worker } from 'bullmq';
import { ExtractModule } from './extract.module';

const mockPrisma = {
  hotNews: { findMany: vi.fn() },
};
vi.mock('@ai-hot-news/db', () => ({ getPrisma: () => mockPrisma }));

describe('ExtractModule.onApplicationBootstrap (boot backstop)', () => {
  let queue: { add: ReturnType<typeof vi.fn> };
  let worker: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    queue = { add: vi.fn().mockResolvedValue(undefined) };
    worker = { close: vi.fn().mockResolvedValue(undefined) };
    mockPrisma.hotNews.findMany.mockReset();
  });

  afterEach(() => vi.resetAllMocks());

  it('re-queues every PENDING row with jobId="extract-<id>"', async () => {
    mockPrisma.hotNews.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const m = new ExtractModule(queue as unknown as Queue, worker as unknown as Worker);

    await m.onApplicationBootstrap();

    expect(queue.add).toHaveBeenCalledTimes(3);
    expect(queue.add).toHaveBeenCalledWith(
      'extract',
      { hotNewsId: 'a' },
      expect.objectContaining({ jobId: 'extract-a' }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'extract',
      { hotNewsId: 'b' },
      expect.objectContaining({ jobId: 'extract-b' }),
    );
  });

  it('queries WHERE extractStatus=PENDING (does not pick up FAILED)', async () => {
    mockPrisma.hotNews.findMany.mockResolvedValue([]);
    const m = new ExtractModule(queue as unknown as Queue, worker as unknown as Worker);

    await m.onApplicationBootstrap();

    expect(mockPrisma.hotNews.findMany).toHaveBeenCalledWith({
      where: { extractStatus: 'PENDING' },
      select: { id: true },
    });
  });

  it('closes worker on module destroy', async () => {
    const m = new ExtractModule(queue as unknown as Queue, worker as unknown as Worker);
    await m.onModuleDestroy();
    expect(worker.close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 10.2: Run tests to verify they fail**

```bash
pnpm --filter @ai-hot-news/worker run test -- extract.module
```

期望 FAIL：找不到 `./extract.module`。

- [ ] **Step 10.3: Implement `extract.module.ts`**

新建 `apps/worker/src/extract/extract.module.ts`：

```ts
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
import { SummarizeModule } from '../summarize/summarize.module';
import { ExtractService } from './extract.service';
import {
  EXTRACT_QUEUE,
  EXTRACT_WORKER,
  createExtractWorker,
  extractQueueProvider,
} from './extract.queue';
import { processExtractJob, type ExtractJobData } from './extract.processor';
import { FirecrawlProvider } from './providers/firecrawl.provider';
import { JinaProvider } from './providers/jina.provider';
import { ExtractChain } from './providers/chain';

@Module({
  imports: [SummarizeModule],
  providers: [
    extractQueueProvider,
    {
      provide: ExtractChain,
      useFactory: () => new ExtractChain([new FirecrawlProvider(), new JinaProvider()]),
    },
    ExtractService,
    {
      provide: EXTRACT_WORKER,
      useFactory: (connection: IORedis, service: ExtractService): Worker => {
        const worker = createExtractWorker(
          async (_jobName, jobData) =>
            processExtractJob(jobData as ExtractJobData, service),
          connection,
        );
        worker.on('failed', (job, err) => {
          new Logger('ExtractWorker').error(
            `Job ${job?.id ?? '<no-id>'} failed: ${err.message}`,
          );
        });
        return worker;
      },
      inject: [REDIS_CONNECTION, ExtractService],
    },
  ],
  exports: [EXTRACT_QUEUE],
})
export class ExtractModule
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ExtractModule.name);

  constructor(
    @Inject(EXTRACT_QUEUE) private readonly queue: Queue,
    @Inject(EXTRACT_WORKER) private readonly worker: Worker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const orphans = await getPrisma().hotNews.findMany({
      where: { extractStatus: 'PENDING' },
      select: { id: true },
    });
    for (const r of orphans) {
      await this.queue.add(
        'extract',
        { hotNewsId: r.id },
        {
          jobId: `extract-${r.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
    }
    this.logger.log(`Boot backstop: re-queued ${orphans.length} PENDING extract jobs`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}
```

- [ ] **Step 10.4: Run tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/worker run test -- extract.module
```

期望 PASS（3/3 绿）。

- [ ] **Step 10.5: Commit**

```bash
git add apps/worker/src/extract/extract.module.ts apps/worker/src/extract/extract.module.spec.ts
git commit -m "feat(sp4.7): ExtractModule with boot backstop + chain DI"
```

---

## Task 11: IngestionService — enqueue extract + summary on insert (TDD)

**Goal:** `prisma.hotNews.create` 成功后：(a) `status=VISIBLE` → 总入 summary 队列；(b) link-post 哨兵命中 → 同步 update extractStatus='PENDING' + 入 extract 队列。两个 token 由 constructor 注入。HIDDEN 行不入任何队列。

**Files:**
- Modify: `apps/worker/src/crawl/ingestion.service.ts`
- Modify: `apps/worker/src/crawl/crawl.module.ts`
- Modify: `apps/worker/src/crawl/ingestion.service.integration.spec.ts`

- [ ] **Step 11.1: Read current `ingestion.service.spec.ts` + `ingestion.service.integration.spec.ts` 了解 mock 风格**

```bash
pnpm --filter @ai-hot-news/worker run test -- ingestion.service
```

确认现有 13 个 case 全绿，再开始改动。

- [ ] **Step 11.2: Write the failing integration tests**

打开 `apps/worker/src/crawl/ingestion.service.integration.spec.ts` 在已有 `describe(...)` 内新加一个块（详细 fixtures + setup 沿用文件已有 helpers；只展示新增段）：

```ts
describe('SP-4.7 enqueue contract', () => {
  it('VISIBLE link-post (HN s.url present, content==title) → extract + summary both enqueued, extractStatus=PENDING in DB', async () => {
    const linkPostItem: RawCrawledItem = {
      title: 'A cool blog post',
      contentText: 'A cool blog post', // == title (SP-3 link-post sentinel)
      rawHtml: null,
      sourceUrl: 'https://news.ycombinator.com/item?id=999',
      author: 'someone',
      publishedAt: new Date('2026-05-05T00:00:00Z'),
      filterReason: null,
      interactionData: { externalUrl: 'https://blog.example.com/post' },
    };
    await service.ingest([linkPostItem], { id: 's1', platform: Platform.HACKERNEWS, url: null, identifier: 'top', name: 'HN Top' });

    expect(extractQueueAdd).toHaveBeenCalledWith(
      'extract',
      expect.objectContaining({ hotNewsId: expect.any(String) }),
      expect.objectContaining({ jobId: expect.stringMatching(/^extract-/) }),
    );
    expect(summaryQueueAdd).toHaveBeenCalledWith(
      'summarize',
      expect.objectContaining({ hotNewsId: expect.any(String) }),
      expect.objectContaining({ jobId: expect.stringMatching(/^summarize-/) }),
    );

    const row = await prisma.hotNews.findFirst({
      where: { sourceUrl: 'https://news.ycombinator.com/item?id=999' },
    });
    expect(row?.extractStatus).toBe('PENDING');
  });

  it('VISIBLE self-post (no externalUrl) → only summary enqueued, extract not called, extractStatus=null', async () => {
    const selfPostItem: RawCrawledItem = {
      title: 'Ask HN: how do you',
      contentText: 'I have been wondering...',
      rawHtml: null,
      sourceUrl: 'https://news.ycombinator.com/item?id=998',
      author: 'someone',
      publishedAt: new Date('2026-05-05T00:00:00Z'),
      filterReason: null,
      interactionData: { externalUrl: null },
    };
    await service.ingest([selfPostItem], { id: 's1', platform: Platform.HACKERNEWS, url: null, identifier: 'ask', name: 'HN Ask' });

    expect(extractQueueAdd).not.toHaveBeenCalled();
    expect(summaryQueueAdd).toHaveBeenCalledTimes(1);

    const row = await prisma.hotNews.findFirst({
      where: { sourceUrl: 'https://news.ycombinator.com/item?id=998' },
    });
    expect(row?.extractStatus).toBeNull();
  });

  it('HIDDEN row (quality filterReason) → neither queue enqueued', async () => {
    const lowQuality: RawCrawledItem = {
      title: 'a',
      contentText: 'a',
      rawHtml: null,
      sourceUrl: 'https://example.com/short',
      author: null,
      publishedAt: new Date('2026-05-05T00:00:00Z'),
      filterReason: 'TITLE_TOO_SHORT', // pretend quality already triggered
      interactionData: { externalUrl: 'https://example.com/short' },
    };
    await service.ingest([lowQuality], { id: 's1', platform: Platform.HACKERNEWS, url: null, identifier: 'top', name: 'HN Top' });

    expect(extractQueueAdd).not.toHaveBeenCalled();
    expect(summaryQueueAdd).not.toHaveBeenCalled();
  });
});
```

注：spec 顶部需要在 `beforeEach` 创建 `extractQueueAdd` / `summaryQueueAdd` mock 并注入到 service：

```ts
let extractQueueAdd: ReturnType<typeof vi.fn>;
let summaryQueueAdd: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  extractQueueAdd = vi.fn().mockResolvedValue(undefined);
  summaryQueueAdd = vi.fn().mockResolvedValue(undefined);
  service = new IngestionService(
    { add: summaryQueueAdd } as unknown as Queue,
    { add: extractQueueAdd } as unknown as Queue,
  );
  // existing prisma cleanup ...
});
```

实际写时如果文件结构不一样：把已有的 `service = new IngestionService()` 替换成上面带参数的形式即可（依赖 Step 11.3 修改 constructor 后）。

- [ ] **Step 11.3: Run tests to verify they fail**

```bash
pnpm --filter @ai-hot-news/worker run test -- ingestion.service.integration
```

期望 FAIL：`IngestionService` 构造函数签名不匹配（无参 vs 两参）。

- [ ] **Step 11.4: Modify `ingestion.service.ts` — 加 constructor 注入两 queue + 入库后入队**

打开 `apps/worker/src/crawl/ingestion.service.ts`：

a) 文件顶部新增 imports：

```ts
import { Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { SUMMARY_QUEUE } from '../summarize/summarize.queue';
import { EXTRACT_QUEUE } from '../extract/extract.queue';
```

b) `@Injectable() export class IngestionService { ... }` 内加 constructor（已有 `private readonly logger = new Logger(...)`，constructor 紧跟其后）：

```ts
constructor(
  @Inject(SUMMARY_QUEUE) private readonly summaryQueue: Queue,
  @Inject(EXTRACT_QUEUE) private readonly extractQueue: Queue,
) {}
```

c) 找到 `prisma.hotNews.create({...})` 调用（约 line 90-110）后、`result.inserted += 1` 之后，**在 try block 内追加**：

```ts
if (status === ContentStatus.VISIBLE) {
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

  const extUrl = (raw.interactionData as { externalUrl?: string } | null)?.externalUrl;
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
}
```

注：`created` = `prisma.hotNews.create({ ... })` 的返回值；如果当前代码不解构成 `created` 而是直接 `await prisma.hotNews.create(...)` 不接收返回值，需要改成 `const created = await prisma.hotNews.create({ ... })` 才能拿到 `created.id`。

`cleanTitle` / `cleanContent` 是 SP-4 后已存在的局部变量；如果命名不同（e.g. `title` / `content`），改成对应名字。

- [ ] **Step 11.5: Modify `crawl.module.ts` — 加 imports + 注入 queue 到 IngestionService**

打开 `apps/worker/src/crawl/crawl.module.ts`，把：

```ts
import { Module, ... } from '@nestjs/common';
// ...
import { IngestionService } from './ingestion.service';
// ...
@Module({
  providers: [
    // ...
    IngestionService,
    // ...
  ],
  exports: [IngestionService],
})
export class CrawlModule ...
```

改成：

```ts
import { SummarizeModule } from '../summarize/summarize.module';
import { ExtractModule } from '../extract/extract.module';
import { SUMMARY_QUEUE } from '../summarize/summarize.queue';
import { EXTRACT_QUEUE } from '../extract/extract.queue';
import { Queue } from 'bullmq';
// ... existing imports ...

@Module({
  imports: [SummarizeModule, ExtractModule],
  providers: [
    // ... existing providers ...
    {
      provide: IngestionService,
      useFactory: (summaryQueue: Queue, extractQueue: Queue) =>
        new IngestionService(summaryQueue, extractQueue),
      inject: [SUMMARY_QUEUE, EXTRACT_QUEUE],
    },
    // ... rest ...
  ],
  exports: [IngestionService],
})
export class CrawlModule ...
```

把现有的 `IngestionService` provider 行替换成上面带 useFactory 的形式（避免 NestJS 自动 DI 不知道 Symbol token）。

- [ ] **Step 11.6: Run tests — integration + unit 全绿**

```bash
pnpm --filter @ai-hot-news/worker run test -- ingestion.service
pnpm --filter @ai-hot-news/worker run test -- ingestion.service.integration
```

期望两批全绿（含原 13 case + 新增 3 case）。

- [ ] **Step 11.7: Commit**

```bash
git add apps/worker/src/crawl/ingestion.service.ts apps/worker/src/crawl/crawl.module.ts apps/worker/src/crawl/ingestion.service.integration.spec.ts
git commit -m "feat(sp4.7): IngestionService enqueues extract+summary jobs on VISIBLE insert"
```

---

## Task 12: Wire `worker.module.ts` + `.env.example`

**Goal:** WorkerModule 顶层 import 三个新模块（让 Provider DI 正确）；`.env.example` 加 Firecrawl/Jina key 占位。

**Files:**
- Modify: `apps/worker/src/worker.module.ts`
- Modify: `.env.example`

- [ ] **Step 12.1: Modify `worker.module.ts`**

打开 `apps/worker/src/worker.module.ts`，把 imports 数组从：

```ts
imports: [ConfigModule.forRoot({...}), CrawlModule],
```

改为：

```ts
import { CrawlModule } from './crawl/crawl.module';
import { ExtractModule } from './extract/extract.module';
import { SummarizeModule } from './summarize/summarize.module';

// ...

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [APP_ENV, ROOT_ENV] }),
    SummarizeModule,
    ExtractModule,
    CrawlModule,
  ],
  providers: [LivenessService],
})
export class WorkerModule {}
```

注：`SummarizeModule` 在前面、`CrawlModule` 在最后是有意的 — CrawlModule import 它们俩，先让 Nest 解析依赖。

- [ ] **Step 12.2: Modify `.env.example`**

打开 `.env.example`，**在文件末尾**追加：

```bash

# === SP-4.7 Article Extractor ===
FIRECRAWL_API_KEY=                   # required, get from https://firecrawl.dev/app/api-keys
JINA_API_KEY=                        # optional, anonymous works at lower rate
EXTRACT_CONCURRENCY=2                # optional, defaults to 2
```

- [ ] **Step 12.3: Verify worker can boot locally (dry typecheck + build)**

```bash
pnpm --filter @ai-hot-news/worker run typecheck
pnpm --filter @ai-hot-news/worker run build
```

期望都 PASS。

- [ ] **Step 12.4: Commit**

```bash
git add apps/worker/src/worker.module.ts .env.example
git commit -m "feat(sp4.7): wire ExtractModule + SummarizeModule into WorkerModule, .env.example"
```

---

## Task 13: Local verify — full monorepo lint/typecheck/build/test

**Goal:** 全仓门槛全绿，确认 SP-4.7 没破坏 SP-2/3/4/4.5/4.6 任一交付。

- [ ] **Step 13.1: Run the full pipeline**

```bash
pnpm turbo run lint typecheck build test
```

期望全绿。如果有 lint 失败（比如 unused import），就地修；测试失败先 grep 错误 → 定位 → 修。

- [ ] **Step 13.2: 端到端本地烟测**

a) 拷贝你的 Firecrawl key 到本地 `.env`（暂时使用一个免费试用 key 即可）：

```bash
echo "FIRECRAWL_API_KEY=fc-<your-test-key>" >> .env
```

b) Reset DB 拿干净环境：

```bash
pnpm --filter @ai-hot-news/db run prisma migrate reset --force --skip-seed --skip-generate
pnpm --filter @ai-hot-news/db run db:seed
```

c) 启动 stack：

```bash
pnpm dev
```

d) 等 ~5-7 分钟后看 worker 日志，应有：

```
[Extract] Extracted https://blog.example.com/x via firecrawl (1834 chars), re-summarize queued
```

e) DB 查 `extractStatus` 分布：

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT \"extractStatus\", COUNT(*) FROM hot_news GROUP BY 1 ORDER BY 1 NULLS FIRST"
```

期望：null + EXTRACTED + 少量 PENDING；FAILED < 10%。

f) 抽 1 行 EXTRACTED 行检验 content 是真正文：

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT \"extractStatus\", LENGTH(title), LENGTH(content) FROM hot_news WHERE \"extractStatus\"='EXTRACTED' LIMIT 5"
```

期望：所有 EXTRACTED 行 `LENGTH(content) >> LENGTH(title)`。

- [ ] **Step 13.3: Commit if any inline fixes were made**

如果上一步有任何 lint/typecheck 修补，commit 它们：

```bash
git add -A
git commit -m "chore(sp4.7): post-implementation lint/typecheck cleanup"
```

如无改动，跳过。

---

## Task 14: PR + Production deployment + AI-stage wipe + smoke

**Goal:** 推 PR 走 CI，CI 绿后 merge 到 main 触发自动 deploy；ssh prod 写 env、stop worker、跑一次 wipe、start worker；30 分钟内确认线上 link-post 真正文已抽到。

- [ ] **Step 14.1: Push + Open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(sp4.7): ArticleExtractor — Firecrawl + Jina chain for HN/Reddit link-posts" --body "$(cat <<'EOF'
## Summary

落地 SP-4.7 ArticleExtractor：

- Firecrawl Cloud API (优先) → Jina r.jina.ai (fallback) chain 抽 HN/Reddit link-post 外链正文
- HotNews schema 加 extractStatus + extractAttempts 两列 + partial index
- 独立 BullMQ 队列 `extract` (concurrency=2) + 独立 worker
- IngestionService 入库后追加：VISIBLE 行入 summary 队列（SP-5 stub）；link-post 行额外入 extract 队列 + 同事务标 PENDING
- ExtractService 状态机：成功 → 写 content+rawHtml + 清 summary/aiTags 触发 SP-5 重摘；失败按 attempts < 3 PENDING 重试，attempts ≥ 3 或 PermanentFetchError 标 FAILED
- Boot backstop：worker 启动扫 extractStatus='PENDING' 重新入队，jobId 自然幂等
- Stub SummarizeModule（仅 SUMMARY_QUEUE token）— SP-5 后续扩展
- 一次性 wipe 脚本 packages/db/scripts/wipe-hot-news-pre-ai.ts（AI 阶段开机用）

## Test plan

- [x] 全仓 `pnpm turbo run lint typecheck build test` 全绿（新增 ~22 case）
- [x] 本地 dev 端到端烟测（FIRECRAWL_API_KEY 配齐后链路通）
- [ ] 部署后 30 分钟 prod psql 查 extractStatus 分布合理 + content 是真正文

Spec: docs/superpowers/specs/2026-05-05-sp4-7-article-extractor-design.md
Plan: docs/superpowers/plans/2026-05-05-sp4-7-article-extractor-plan.md
EOF
)"
```

记下 PR URL。

- [ ] **Step 14.2: 等 CI 绿（GitHub Actions ci.yml）**

```bash
gh pr checks --watch
```

期望 ci 全绿（lint + typecheck + build + test）。

如果 CI 测试失败：本地复现 → 修 → push（不要 amend，新 commit）。

- [ ] **Step 14.3: Pre-flight ssh prod — 写 .env**

```bash
ssh deploy@<vps>
cd /srv/ai-hot-news

# 备份现有 .env
cp .env .env.bak.$(date +%Y%m%d-%H%M%S)

# 追加 SP-4.7 env
cat >> .env <<'EOF'

# === SP-4.7 Article Extractor ===
FIRECRAWL_API_KEY=fc-<actual-key-from-firecrawl-dashboard>
JINA_API_KEY=                          # optional, leave empty for anonymous
EXTRACT_CONCURRENCY=2
EOF

# 验证
grep FIRECRAWL_API_KEY .env
```

- [ ] **Step 14.4: Merge PR + 自动 deploy**

```bash
# 本地（merge 后 deploy.yml workflow 自动触发，应用 _sp4_7_extract_status migration + 重启 worker）
gh pr merge --squash --delete-branch
gh run watch  # 看 deploy.yml workflow 完成
```

期望 deploy.sh 输出含：
- `Applied migration sp4_7_extract_status`
- `Smoke /api/health: ok`
- `Smoke /api/hot-news?pageSize=1: ok`

- [ ] **Step 14.5: Stop worker → run wipe script → start worker**

> 注：deploy.sh 已经 restart 了 worker（带新代码 + migration），但**没**跑 wipe。这里是 AI 阶段开机第一次需要清空 hot_news 的关键步骤。

```bash
ssh deploy@<vps>
cd /srv/ai-hot-news

# 1) 停 worker 防止 wipe 期间 ingest 写入竞态
docker compose -f docker/docker-compose.prod.yml --env-file .env stop worker

# 2) wipe 历史 hot_news
bash scripts/run-prod-oneshot.sh packages/db scripts/wipe-hot-news-pre-ai.ts

# 期望日志：
#   [wipe-pre-ai] Before: <N> rows
#   [wipe-pre-ai] Deleted <N> rows, after: 0
#   {"before":<N>,"deleted":<N>,"after":0}

# 3) 启 worker：boot 后 crawler scheduler 会 ~30s 内拉一轮，新 link-post 进 extract 队列
docker compose -f docker/docker-compose.prod.yml --env-file .env start worker

# 4) 看 worker 日志
docker logs -f ai-hot-news-worker --tail 100
```

worker 日志期望：
- `Boot backstop: re-queued 0 PENDING extract jobs`（wipe 后干净）
- 5-10 分钟后开始出现 `Extracted https://... via firecrawl (... chars), re-summarize queued`

- [ ] **Step 14.6: 30 分钟后 smoke prod**

```bash
ssh deploy@<vps>

# extractStatus 分布
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT \"extractStatus\", COUNT(*) FROM hot_news GROUP BY 1 ORDER BY 1 NULLS FIRST"
```

期望：`null` 多（self-post + RSS）+ `EXTRACTED` 多 + 少量 `PENDING` (in-flight) + `FAILED` < 10%。

```bash
# 真正文样本：随机 5 条 EXTRACTED 行
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT \"extractStatus\", LENGTH(title) AS tlen, LENGTH(content) AS clen FROM hot_news WHERE \"extractStatus\"='EXTRACTED' ORDER BY publishedAt DESC LIMIT 5"
```

期望：每行 `clen >> tlen`（content 至少 500 字、title 50-150 字）。

```bash
# 不变量验证
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT COUNT(*) AS bad FROM hot_news WHERE \"extractStatus\"='EXTRACTED' AND content = title"
# 期望: 0

docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT COUNT(*) AS bad FROM hot_news WHERE status='VISIBLE' AND \"filterReason\" IS NOT NULL"
# 期望: 0
```

```bash
# UI 烟测
curl -s 'https://hotnews.shinpeionline.top/api/hot-news?platforms=HACKERNEWS&pageSize=5' | jq '.items[].sourceUrl'
```

挑一个 link-post id 直查 DB content：

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT id, title, LEFT(content, 200) FROM hot_news WHERE sourceUrl='<picked-url>'"
```

content 应是真正文片段，不是 title 兜底。

- [ ] **Step 14.7: Update decomposition design doc**

打开 `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md`，找 SP-4.7 行，把状态从 `PLANNED` 改为 `COMPLETED <YYYY-MM-DD>`，并在它的备注里追加：

```text
- spec: docs/superpowers/specs/2026-05-05-sp4-7-article-extractor-design.md
- plan: docs/superpowers/plans/2026-05-05-sp4-7-article-extractor-plan.md
- prod deploy: <YYYY-MM-DD HH:MM UTC+8>, deploy sha: <commit-sha>
- prod wipe: deleted <N> rows pre-AI
- smoke: extractStatus 分布合理 / content >> title / 0 不变量违反
```

提交：

```bash
git add docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md
git commit -m "docs(sp4.7): mark complete + record prod deploy + wipe smoke evidence"
git push
```

---

## Self-review checklist

After all 14 tasks done, run this self-review against the spec:

- [ ] Spec §1.4 硬验收 全部勾选（migration / wipe / 全测绿 / dev 烟测 / extractStatus 分布合理 / quota fallback 验证 / 不变量 1-2 都 0 / wipe 脚本 spec 绿 / CI 绿 / prod deploy 绿 / prod psql content >> title）
- [ ] Spec §1.3 Out-of-scope 一项也没误改（多媒体 / robots.txt / per-host rate limit / FAILED 自动重试 cron / dashboard / title 覆盖 等）
- [ ] Spec §3.3 不变量 1-7 全部成立（特别注意 4 = `EXTRACTED && content == title` 必须 0；5 = `extractStatus IS NULL && link-post sentinel` 必须 0）
- [ ] Spec §6 测试矩阵 ~22 case 全部对应到 plan task：
  - firecrawl.provider.spec (6) → Task 4
  - jina.provider.spec (5) → Task 5
  - chain.spec (6) → Task 6
  - extract.service.spec (8) → Task 9
  - extract.module.spec (3) → Task 10
  - ingestion.service.integration.spec 新增 (3) → Task 11
  - wipe-hot-news-pre-ai.spec (3) → Task 2
- [ ] Spec §7.4 应急回退 SQL 已记入 plan / spec（不需在 plan 里跑，但保留可执行知识）
