# SP-1：RSS → 列表页端到端骨架 设计

- **日期**：2026-05-02
- **状态**：Draft，待用户审阅
- **所属**：Phase 1 / SP-1（详见 `2026-05-01-ai-hot-news-decomposition-design.md` 第 6 节）
- **预计工作量**：2-3 天
- **本文档定位**：单个子项目实现 spec，用户审阅通过后调用 `writing-plans` 生成 step-by-step 实施计划。

---

## 1. 目标、范围与验收标准

### 1.1 目标

把仓库从"5 个进程跑空环境"变成"一条 RSS 数据从外部源 → BullMQ → PostgreSQL → REST API → 浏览器列表页"端到端跑通，验证整个抓取-展示链路的骨架。**不做** AI 摘要、热度计算、跨平台合并、Aurora 视觉。

### 1.2 In-scope

| 模块 | 内容 |
|---|---|
| `packages/utils`（新增） | `normalizeUrl()` + `computeDedupeHash()` + 单元测试 |
| `packages/types`（扩展） | `HotNewsListItemDto`、`HotNewsListResponseDto`、`RawCrawledItem` 接口 |
| `packages/db`（扩展） | `@@unique([platform, url])` 索引 + Prisma seed 脚本（`prisma/seed.ts`） |
| `apps/worker`（扩展） | `Crawler` 接口、`RssCrawler` 实现、`IngestionService`（normalize+dedupe+入库）、BullMQ `rss-crawl` 队列、`CrawlScheduler`（启动注册 repeatable + boot 回填） |
| `apps/api`（扩展） | `HotNewsModule` + `HotNewsController` (`GET /hot-news`) + `HotNewsService` + DTO + 单元测试 |
| `apps/web`（扩展） | `/news` 路由（Server Component）+ 首页加 "→ 查看热点列表" 链接 |
| 部署文档 | `README.md` 增加"首次部署后跑 seed"步骤；`deploy.yml` smoke 增加 `/api/hot-news` 探针 |

### 1.3 Out-of-scope（明确不做）

- 任何 AI / embedding 调用
- 热度分计算、跨平台合并
- HN/Reddit/Twitter 抓取（SP-2/3/22）
- 列表过滤/排序（除默认 `publishedAt DESC`）/ 关键词搜索
- 详情页、详情 API、收藏、关键词监控
- Aurora 视觉、shadcn/ui
- Bull Board / 队列监控 UI
- 后台管理 UI（添加/删除 RSS 源）
- 测试容器化（testcontainers）
- 通知 / 告警

### 1.4 硬验收标准

```bash
# === 本地 dev 全流程 ===
pnpm install                                   # 0 错
pnpm docker:dev                                # pg + redis 起
pnpm db:migrate:deploy                         # 应用 schema 迁移（含 SP-1 新 migration）
pnpm db:seed                                   # 写入 RSS SourceConfig 候选
pnpm dev                                       # 三进程并行

# 等待 ~30 秒（worker boot 回填首抓）
curl localhost:3001/hot-news?pageSize=20       # 200 + JSON，items.length >= 10
curl localhost:3001/hot-news | jq '.total'     # 数字 >= 10
open http://localhost:3000/news                # 浏览器看到 ≥10 条真实标题

# === CI ===
# ci.yml 全绿（含新加的单元 + 集成测试）

# === 部署后（push 到 main 触发 deploy.yml）===
# 首次部署后 SSH 到 VPS 跑一次 db:seed（README 已记录）
curl https://<domain>/api/hot-news?pageSize=1  # 200，证书有效
curl https://<domain>/api/health               # 200（保持原有）
```

### 1.5 不会修改的内容

不动 SP-0 的 monorepo 结构、Docker Compose 拓扑、CI 矩阵、Prisma schema 字段（仅新增一个 `@@unique` 复合索引到 `source_configs`，通过迁移上线）。

---

## 2. 架构与数据流

### 2.1 数据流图

```text
┌──────────────────────────────────────────────────────────────────────┐
│                         Worker 进程 (NestJS standalone)              │
│                                                                      │
│  Bootstrap                                                           │
│   ├── 1. 从 DB 读 SourceConfig WHERE platform=RSS AND enabled=true   │
│   ├── 2. 为每个源注册 BullMQ repeatable                              │
│   │      job 名: 'rss-crawl', data: { sourceConfigId }               │
│   │      every: SourceConfig.crawlInterval * 1000                    │
│   └── 3. 立即触发一次（boot 回填）                                   │
│                                                                      │
│  CrawlProcessor.process(job)                                         │
│   ├── 读 SourceConfig                                                │
│   ├── new RssCrawler(sourceConfig).fetch() → RawCrawledItem[]        │
│   ├── IngestionService.ingest(items, sourceConfig)                   │
│   │   ├── 对每条:                                                    │
│   │   │   ├── normalizeUrl() + computeDedupeHash()                   │
│   │   │   ├── prisma.hotNews.upsert({ where: { sourceUrl }, ... })   │
│   │   │   └── 单条失败 → warn 日志 + continue                        │
│   │   └── 返回 { fetched, inserted, skipped, failed }                │
│   ├── 更新 SourceConfig.lastCrawledAt + status=NORMAL                │
│   └── 抓取/解析失败 → BullMQ 重试 (3 次指数退避)                     │
│                          └─ 终最失败 → status=FAILED + errorMessage  │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ 写入
                         ┌────────────────┐
                         │   PostgreSQL    │
                         │   hot_news 表    │
                         └────────────────┘
                                  ▲ 读取
                                  │
┌──────────────────────────────────────────────────────────────────────┐
│                          API 进程 (NestJS)                           │
│                                                                      │
│  GET /hot-news?page=1&pageSize=20                                    │
│   ├── HotNewsController                                              │
│   ├── HotNewsService.list(page, pageSize)                            │
│   │   ├── prisma.$transaction([ findMany, count ])                   │
│   │   └── 排序 publishedAt DESC                                      │
│   └── 返回 HotNewsListResponseDto                                    │
└──────────────────────────────────────────────────────────────────────┘
                                  ▲ HTTP fetch (Server Component)
                                  │
┌──────────────────────────────────────────────────────────────────────┐
│                          Web 进程 (Next.js 15)                       │
│                                                                      │
│  /news/page.tsx (Server Component, cache: 'no-store')                │
│   ├── fetch(API_URL + '/hot-news?page=N&pageSize=20')                │
│   ├── 渲染头部小卡片（total + lastCrawledAt 取自 items[0].crawledAt）│
│   ├── 渲染 <ul>，每项标题 → 跳 sourceUrl                             │
│   └── 渲染翻页 <a href="/news?page=N±1">                             │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 模块边界与职责

| 单元 | 输入 | 输出 | 依赖 |
|---|---|---|---|
| `Crawler`（接口，worker） | `SourceConfig` | `Promise<RawCrawledItem[]>` | — |
| `RssCrawler`（实现，worker） | RSS feed URL | 解析后的标准化条目 | `rss-parser` |
| `IngestionService`（worker） | `RawCrawledItem[]` + `SourceConfig` | `IngestResult` | `@ai-hot-news/db`、`@ai-hot-news/utils` |
| `CrawlProcessor`（worker） | BullMQ Job | 写库副作用 | `Crawler` 实现、`IngestionService` |
| `CrawlScheduler`（worker, OnModuleInit） | — | 注册 repeatable + 触发 boot 抓取 | BullMQ Queue、Prisma |
| `HotNewsService`（api） | page, pageSize | `HotNewsListResponseDto` | `@ai-hot-news/db` |
| `HotNewsController`（api） | HTTP request | HTTP response | `HotNewsService` |
| Web `/news` page | URL search params | HTML | API HTTP client |

### 2.3 关键接口签名

```ts
// packages/types/src/index.ts
export interface RawCrawledItem {
  title: string;
  contentText: string;
  rawHtml: string | null;
  sourceUrl: string;        // 未规范化，由 IngestionService 内部规范化
  author: string | null;
  publishedAt: Date | null; // 解析失败时为 null，由 ingestion 层 fallback
}

export interface HotNewsListItemDto {
  id: string;
  title: string;
  sourceUrl: string;
  sourcePlatform: 'TWITTER' | 'RSS' | 'HACKERNEWS' | 'REDDIT';
  author: string | null;
  publishedAt: string;  // ISO8601
  crawledAt: string;    // ISO8601
}

export interface HotNewsListResponseDto {
  items: HotNewsListItemDto[];
  page: number;
  pageSize: number;
  total: number;
}

// apps/worker/src/crawl/crawlers/crawler.interface.ts
export interface Crawler {
  fetch(): Promise<RawCrawledItem[]>;
}
```

### 2.4 配置与环境变量

| 变量 | 谁用 | 默认 | 说明 |
|---|---|---|---|
| `DATABASE_URL` | api / worker | SP-0 已有 | — |
| `REDIS_URL` | api / worker | SP-0 已有 | — |
| `NEXT_PUBLIC_API_URL` | web | SP-0 已有 | dev `http://localhost:3001`，prod `https://<domain>/api` |
| `RSS_USER_AGENT` | worker | `ai-hot-news-bot/0.1` | 可覆盖 |
| `RSS_FETCH_TIMEOUT_MS` | worker | `15000` | 可覆盖 |

新增变量加进 `apps/worker/.env.example`。

---

## 3. Worker 详细设计（抓取链路）

### 3.1 文件结构（新增）

```text
apps/worker/
├── src/
│   ├── main.ts                          # 现有，无改动
│   ├── worker.module.ts                 # 修改：imports 新增 PrismaModule、CrawlModule
│   ├── liveness.service.ts              # 现有，不变
│   ├── liveness.service.spec.ts         # 现有，不变
│   ├── prisma/
│   │   ├── prisma.module.ts             # @Global，提供 PrismaService（@ai-hot-news/db 包装）
│   │   └── prisma.service.ts
│   └── crawl/
│       ├── crawl.module.ts              # imports BullModule.registerQueue('rss-crawl')
│       ├── crawlers/
│       │   ├── crawler.interface.ts     # Crawler 抽象
│       │   └── rss.crawler.ts           # RssCrawler implements Crawler
│       ├── crawl.processor.ts           # @Processor('rss-crawl')，消费 job
│       ├── crawl.scheduler.ts           # OnModuleInit，注册 repeatable + boot 触发
│       ├── ingestion.service.ts         # normalize + dedupe + 写库
│       ├── rss.crawler.spec.ts
│       ├── ingestion.service.integration.spec.ts
│       └── fixtures/
│           └── sample-rss-feed.xml      # 测试用样本（OpenAI News 模拟，含 author/无 author/无 pubDate 等边界 case）
└── package.json                         # 新依赖：rss-parser、@nestjs/bullmq、bullmq、ioredis
```

`apps/api` 同步引入 `prisma/prisma.module.ts` 同样的 wrapper（避免 worker 与 api 各搞一套，保持一致）。

### 3.2 RssCrawler 实现要点

```ts
import Parser from 'rss-parser';

export class RssCrawler implements Crawler {
  private readonly parser: Parser;

  constructor(private readonly source: SourceConfig) {
    this.parser = new Parser({
      timeout: parseInt(process.env.RSS_FETCH_TIMEOUT_MS ?? '15000', 10),
      headers: { 'User-Agent': process.env.RSS_USER_AGENT ?? 'ai-hot-news-bot/0.1' },
      customFields: {
        item: [['content:encoded', 'contentEncoded'], ['dc:creator', 'dcCreator']],
      },
    });
  }

  async fetch(): Promise<RawCrawledItem[]> {
    if (!this.source.url) {
      throw new Error(`SourceConfig ${this.source.id} missing url`);
    }
    const feed = await this.parser.parseURL(this.source.url);
    return feed.items.map((item) => this.toRaw(item));
  }

  private toRaw(item: Parser.Item & { contentEncoded?: string; dcCreator?: string }): RawCrawledItem {
    const rawHtml = item.contentEncoded ?? item.content ?? null;
    return {
      title: (item.title ?? '').trim() || '(untitled)',
      contentText: stripHtml(rawHtml ?? item.contentSnippet ?? ''),
      rawHtml,
      sourceUrl: item.link ?? '',
      author: item.dcCreator ?? item.creator ?? null,
      publishedAt: item.isoDate ? new Date(item.isoDate) : null,
    };
  }
}
```

`stripHtml()` 用一个轻量正则移除 tag（不引入 cheerio），SP-1 阶段够用；正文用于全文检索/AI 分析时（SP-4/5）再升级。

### 3.3 IngestionService 算法

```ts
async ingest(items: RawCrawledItem[], source: SourceConfig): Promise<IngestResult> {
  let inserted = 0, skipped = 0, failed = 0;
  for (const raw of items) {
    try {
      if (!raw.sourceUrl) { skipped++; continue; }
      const sourceUrl = normalizeUrl(raw.sourceUrl);
      const dedupeHash = computeDedupeHash(sourceUrl, raw.title);
      const result = await this.prisma.hotNews.upsert({
        where: { sourceUrl },
        update: {},  // SP-1 已存在不更新
        create: {
          title: raw.title,
          content: raw.contentText,
          rawHtml: raw.rawHtml,
          sourcePlatform: 'RSS',
          sourceUrl,
          author: raw.author,
          publishedAt: raw.publishedAt ?? new Date(),
          dedupeHash,
        },
      });
      const isNew = (Date.now() - result.crawledAt.getTime()) < 5_000;
      if (isNew) inserted++; else skipped++;
    } catch (err) {
      this.logger.warn(`Ingest item failed: ${raw.sourceUrl}`, err);
      failed++;
    }
  }
  return { fetched: items.length, inserted, skipped, failed };
}
```

> `inserted vs skipped` 启发式：upsert 不返回新增/已存在标志。用 `crawledAt` 距 now < 5s 判断。仅用于日志计数，无业务正确性影响。

### 3.4 CrawlScheduler

```ts
@Injectable()
export class CrawlScheduler implements OnModuleInit {
  constructor(
    @InjectQueue('rss-crawl') private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    const sources = await this.prisma.sourceConfig.findMany({
      where: { platform: 'RSS', enabled: true },
    });
    for (const source of sources) {
      // 1. 注册 repeatable（固定 jobId 防重启重复注册）
      await this.queue.add(
        'rss-crawl',
        { sourceConfigId: source.id },
        {
          repeat: { every: source.crawlInterval * 1000 },
          jobId: `rss-crawl:${source.id}`,
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
        },
      );
      // 2. boot 回填：立即触发一次（不带 repeat）
      await this.queue.add(
        'rss-crawl',
        { sourceConfigId: source.id },
        { jobId: `rss-crawl:boot:${source.id}:${Date.now()}` },
      );
    }
    this.logger.log(`Registered ${sources.length} RSS sources`);
  }
}
```

### 3.5 CrawlProcessor 错误处理

| 失败类型 | 行为 |
|---|---|
| RSS HTTP 失败 / 超时 | throw → BullMQ 自动重试（3 次指数退避）。最终失败时把 `SourceConfig.status='FAILED'` + `errorMessage` 写回 |
| RSS 解析异常 | 同上 |
| 单条入库失败 | catch + warn 日志，continue（不影响整批） |
| 整批入库后零新增 | 仅日志 info，非错误 |

### 3.6 Prisma seed 脚本（`packages/db/prisma/seed.ts`）

```ts
import { PrismaClient } from '../src/generated';

const prisma = new PrismaClient();

// 4 家头部 AI 实验室。URL 已在 2026-05-02 通过 curl HEAD 实测：
//   - OpenAI:    /blog/rss.xml 已 307 → /news/rss.xml；直接用终点
//   - Anthropic: 无官方 RSS（常见路径全 404）。占位写入，enabled=false；
//                实施时若找到 RSSHub 代理（如 https://rsshub.app/anthropic/news）
//                可改 url + enabled=true，或留到后续 SP 用其他方式接入。
//   - Google AI: research.google 的官方研究 blog（包含大量 AI 内容），200 OK
//   - DeepMind:  deepmind.google/blog/rss.xml 200 OK
const candidates: Array<{ name: string; url: string; enabled: boolean }> = [
  { name: 'OpenAI News',          url: 'https://openai.com/news/rss.xml',     enabled: true  },
  { name: 'Anthropic News',       url: 'https://www.anthropic.com/news/rss',  enabled: false }, // 占位；URL 待实施时核实
  { name: 'Google Research Blog', url: 'https://research.google/blog/rss/',   enabled: true  },
  { name: 'Google DeepMind Blog', url: 'https://deepmind.google/blog/rss.xml', enabled: true  },
];

async function main() {
  for (const c of candidates) {
    await prisma.sourceConfig.upsert({
      where: { platform_url: { platform: 'RSS', url: c.url } },  // 依赖 @@unique
      create: { platform: 'RSS', name: c.name, url: c.url, enabled: c.enabled, crawlInterval: 1800 },
      update: { name: c.name },  // 不覆盖 enabled，允许运维手工调整后保持
    });
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

实施时 dev 阶段先 `curl -I` 四个 URL，确保返回 200 的源 `enabled=true`，返回 4xx/5xx 的源 `enabled=false`，并在 commit message 备注实测结果。设计阶段已用 `curl` 在 2026-05-02 实测过，结果：

| 源 | URL | 状态 | 默认 enabled |
|---|---|---|---|
| OpenAI News | `https://openai.com/news/rss.xml` | 200 ✅（原 `/blog/rss.xml` 307 重定向到此处） | true |
| Anthropic News | 暂用 `https://www.anthropic.com/news/rss`（占位） | 404 ❌ Anthropic 当前无官方 RSS | **false**（实施时若找到 RSSHub 代理或其他可用 feed，再改 URL + enabled=true） |
| Google Research Blog | `https://research.google/blog/rss/` | 200 ✅（含大量 AI 内容） | true |
| Google DeepMind Blog | `https://deepmind.google/blog/rss.xml` | 200 ✅ | true |

3 个启用源足够保证 boot 回填后 ≥10 条数据（每家头部实验室 blog 历史条目通常都有几十条）。

`packages/db/package.json` 加：

```json
{
  "prisma": { "seed": "tsx prisma/seed.ts" }
}
```

新增 root 脚本：

```json
{ "scripts": { "db:seed": "pnpm --filter @ai-hot-news/db prisma db seed" } }
```

### 3.7 Schema 改动

`packages/db/prisma/schema.prisma`：

```prisma
model SourceConfig {
  ...
  @@index([platform, enabled])
  @@unique([platform, url])         // 新增
  @@map("source_configs")
}
```

生成 migration：`20260502<HHMMSS>_add_source_config_unique`（时间戳由 `prisma migrate dev` 自动填），仅含 `CREATE UNIQUE INDEX ... ON source_configs(platform, url)`。Prod 此前没有 SourceConfig 数据，迁移安全。

---

## 4. API 详细设计（GET /hot-news）

### 4.1 文件结构（新增）

```text
apps/api/
├── src/
│   ├── main.ts                   # 现有，无改动
│   ├── app.module.ts             # 修改：imports 新增 PrismaModule、HotNewsModule
│   ├── prisma/
│   │   ├── prisma.module.ts      # @Global，提供 PrismaService（与 worker 同形态）
│   │   └── prisma.service.ts
│   ├── health/                   # 现有，不变
│   └── hot-news/
│       ├── hot-news.module.ts
│       ├── hot-news.controller.ts
│       ├── hot-news.service.ts
│       ├── dto/
│       │   ├── list-hot-news.query.ts
│       │   └── hot-news-list.response.ts
│       └── hot-news.controller.spec.ts
└── package.json                  # 无新依赖（class-validator/transformer SP-0 已装）
```

### 4.2 端点契约

**端点**：`GET /hot-news`

**Query**：

| 参数 | 类型 | 默认 | 约束 |
|---|---|---|---|
| `page` | integer | 1 | ≥ 1 |
| `pageSize` | integer | 20 | 1 ≤ x ≤ 50 |

**响应（200）**：

```json
{
  "items": [
    {
      "id": "ckxxxxx",
      "title": "GPT-5 announced",
      "sourceUrl": "https://openai.com/index/gpt-5",
      "sourcePlatform": "RSS",
      "author": "OpenAI",
      "publishedAt": "2026-05-01T08:00:00.000Z",
      "crawledAt": "2026-05-01T08:30:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 42
}
```

**排序**：`publishedAt DESC`（已有 `@@index([publishedAt(sort: Desc)])`）。

**为何不返回 `content` / `rawHtml`**：列表页不需要正文，省流量。详情页交给 SP-11，那里再开 `GET /hot-news/:id`。

### 4.3 实现

```ts
// dto/list-hot-news.query.ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListHotNewsQuery {
  @Type(() => Number) @IsOptional() @IsInt() @Min(1)
  page: number = 1;

  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(50)
  pageSize: number = 20;
}

// hot-news.controller.ts
@Controller('hot-news')
export class HotNewsController {
  constructor(private readonly service: HotNewsService) {}

  @Get()
  list(@Query() query: ListHotNewsQuery): Promise<HotNewsListResponseDto> {
    return this.service.list(query.page, query.pageSize);
  }
}

// hot-news.service.ts
@Injectable()
export class HotNewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(page: number, pageSize: number): Promise<HotNewsListResponseDto> {
    const skip = (page - 1) * pageSize;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.hotNews.findMany({
        skip, take: pageSize,
        orderBy: { publishedAt: 'desc' },
        select: {
          id: true, title: true, sourceUrl: true, sourcePlatform: true,
          author: true, publishedAt: true, crawledAt: true,
        },
      }),
      this.prisma.hotNews.count(),
    ]);
    return {
      items: rows.map((r) => ({
        ...r,
        publishedAt: r.publishedAt.toISOString(),
        crawledAt: r.crawledAt.toISOString(),
      })),
      page, pageSize, total,
    };
  }
}
```

### 4.4 错误约定

- 参数无效：NestJS `ValidationPipe` 默认抛 400 + `{ statusCode, message: [...], error }`
- DB 错误：默认抛 500，由 NestJS 默认 filter 处理
- 不实现自定义错误码 / problem+json（后续 SP）

### 4.5 与 Caddy 路由对齐

`docker/Caddyfile` 中 `handle_path /api/* { reverse_proxy api:3001 }` 会剥 `/api/` 前缀，所以 NestJS 内部路径仍是 `/hot-news`。Web 端环境变量根据环境拼接：

```ts
// dev:  NEXT_PUBLIC_API_URL='http://localhost:3001'
// prod: NEXT_PUBLIC_API_URL='https://<domain>/api'
const url = `${process.env.NEXT_PUBLIC_API_URL}/hot-news`;
```

SP-0 README 中 prod env 配置 `PUBLIC_API_URL=https://hotnews.yourdomain.com/api`，与 SP-1 完美对齐，无需改动。

---

## 5. Web 详细设计（/news 页面）

### 5.1 文件结构（新增）

```text
apps/web/
├── app/
│   ├── page.tsx                        # 修改：加 "→ 查看热点列表" 链接
│   ├── layout.tsx                      # 现有，无改动
│   ├── globals.css                     # 现有，无改动
│   ├── api/
│   │   └── health/route.ts             # 现有，无改动
│   └── news/
│       ├── page.tsx                    # 新增：列表页 (Server Component)
│       └── _components/
│           ├── empty-state.tsx
│           ├── error-state.tsx
│           ├── list-header.tsx         # total + 最近抓取时间
│           ├── news-item.tsx
│           └── pagination.tsx
└── lib/
    └── api.ts                          # 新增：fetchHotNewsList(page, pageSize)
```

### 5.2 数据获取与渲染

```tsx
// app/news/page.tsx
import { fetchHotNewsList } from '@/lib/api';
import { ListHeader } from './_components/list-header';
import { NewsItem } from './_components/news-item';
import { Pagination } from './_components/pagination';
import { EmptyState } from './_components/empty-state';
import { ErrorState } from './_components/error-state';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function NewsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const pageSize = 20;

  let data;
  try {
    data = await fetchHotNewsList(page, pageSize);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : 'Unknown error'} />;
  }

  if (data.items.length === 0) {
    return <EmptyState />;
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <ListHeader total={data.total} latestCrawledAt={data.items[0]?.crawledAt} />
      <ul className="mt-6 divide-y divide-gray-200">
        {data.items.map((item) => <NewsItem key={item.id} item={item} />)}
      </ul>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
    </main>
  );
}
```

```ts
// lib/api.ts
import type { HotNewsListResponseDto } from '@ai-hot-news/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function fetchHotNewsList(
  page: number,
  pageSize: number,
): Promise<HotNewsListResponseDto> {
  const res = await fetch(`${API_URL}/hot-news?page=${page}&pageSize=${pageSize}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`);
  }
  return res.json();
}
```

### 5.3 视觉规约（Tailwind 默认，无 Aurora）

- 容器：`max-w-3xl mx-auto p-6`
- 列表项：标题（`text-base font-medium`，外链 `target="_blank" rel="noopener noreferrer"`）；副行（作者 · 平台徽章 · 发布时间，`text-xs text-gray-500`）
- 头部小卡片：浅灰底，显示 `共 N 条 · 最近抓取于 X` 一行
- 翻页：底部居中两个 `<a>` 链接，禁用态用 `pointer-events-none opacity-40`
- 时间格式：`Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' })`
- 不引入 shadcn/ui、lucide-react 或任何额外 UI 库

### 5.4 首页改动

```tsx
// app/page.tsx
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 gap-4">
      <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold">AI Hot News</h1>
        <p className="mt-2 text-gray-600">SP-1 placeholder · v0.0.2</p>
        <p className="mt-1 text-xs text-gray-400">
          实际 UI 在 P4 / SP-8 起按 Aurora 设计稿落地
        </p>
        <Link href="/news" className="mt-4 inline-block text-blue-600 underline">
          → 查看热点列表
        </Link>
      </div>
    </main>
  );
}
```

### 5.5 不做的事

- 不引入 SWR / TanStack Query（SP-9 起再用）
- 不做无限滚动（SP-10）
- 不做 Loading skeleton（SSR 不需要）
- 不做 metadata / SEO（个人自用）
- 不做错误边界 React component（throw 已被 Next.js error boundary 兜底，且 try/catch 已显式处理）

---

## 6. 测试、CI/部署、风险与验收清单

### 6.1 测试矩阵

| 测试 | 文件 | 类型 | 关键 case |
|---|---|---|---|
| `normalizeUrl` | `packages/utils/src/url.test.ts` | 单元 | utm 剥离 / 锚点去除 / 小写 host / 尾斜杠 / 端口保留 / query key 排序（保 deterministic） |
| `computeDedupeHash` | `packages/utils/src/dedupe.test.ts` | 单元 | URL+title 相同 → 同 hash；title 大小写差异 → 同 hash（先 trim+lower）；空 title 安全 |
| `RssCrawler` | `apps/worker/src/crawl/rss.crawler.spec.ts` | 单元 | 用 fixture XML，mock 网络层；验证 author 缺失、pubDate 缺失、`content:encoded` vs `description` 优先级 |
| `IngestionService` | `apps/worker/src/crawl/ingestion.service.integration.spec.ts` | 集成（真 PG） | 12 条 → 12 条入库；同 12 条再来 → 0 新增；缺 sourceUrl 的项被跳过；写库异常单条降级不影响 batch |
| `HotNewsController.list` | `apps/api/src/hot-news/hot-news.controller.spec.ts` | 单元（mock service） | 默认值、合法分页、非法 page=0 → 400、非法 pageSize=999 → 400 |
| Web `/news` | — | 不做自动化 | 验收靠 curl + 浏览器手测 |

CI 中：
- `pnpm turbo lint typecheck build` —— 现有
- `pnpm turbo test` —— 现有，自动捕获新单元测试
- 集成测试需要 PG，复用 `ci.yml` 已经存在的 `services: postgres + redis`，不必改 workflow。集成测试文件命名 `*.integration.spec.ts`，Vitest config 默认 include 即可（启动 ~3 秒可接受）。如 worker 现有 vitest config 不包含此 glob，加进 include。

### 6.2 数据库 Migration 清单

SP-1 会产生 1 个新 migration：

```text
packages/db/prisma/migrations/
├── 20260501XXXXXX_init/                              # SP-0 已有（XXXXXX 是工具生成的 HHMMSS）
└── 20260502XXXXXX_add_source_config_unique/          # SP-1 新增（@@unique([platform, url])）
```

> `XXXXXX` 是 Prisma 自动生成的具体时分秒时间戳，实施时由 `prisma migrate dev --name add_source_config_unique` 自动填充，无需手填。

Prisma 自动生成，验证内容只有 `CREATE UNIQUE INDEX ... ON source_configs(platform, url)`。

### 6.3 部署流程的额外步骤

**首次（一次性）**：

```bash
# 部署后 SSH 到 VPS
docker compose -f docker/docker-compose.prod.yml run --rm api pnpm db:seed
# 写入 RSS SourceConfig 候选

# 验证：
docker compose -f docker/docker-compose.prod.yml exec postgres \
  psql -U $POSTGRES_USER -d $POSTGRES_DB \
  -c "SELECT id, name, url, enabled FROM source_configs;"
```

`README.md` 第 5 节"部署到搬瓦工 VPS"末尾增加这一步。

**`deploy.yml` smoke check 增量**：

```yaml
- name: Smoke check
  run: |
    sleep 10
    curl --fail --max-time 15 https://${{ secrets.DOMAIN }}/api/health
    curl --fail --max-time 15 "https://${{ secrets.DOMAIN }}/api/hot-news?pageSize=1"
```

第二条只验证 200 + JSON 可解析，不要求有数据（首部署 0 条也算通过；worker 抓到第一条后下一次部署就有了）。

### 6.4 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 头部实验室 RSS URL 变更/失效 | 首抓 0 条 | seed 写入 4 个候选（OpenAI / Anthropic / Google Research / DeepMind），其中 OpenAI / Google Research / DeepMind 已实测 200 OK；Anthropic 当前无官方 RSS，seed 中 enabled=false 占位，待 SP 实施或后续 SP 找到代理后再启用 |
| Anthropic 长期没有官方 RSS | 一个候选源缺位 | 当前 3 个启用源足够覆盖 ≥10 条验收阈值；若 SP-1 内有时间，可探索 RSSHub 代理（`https://rsshub.app/anthropic/news`）作为可选启用项；否则推迟到 SP-2/3 阶段统一处理 |
| RSS feed 体积过大（首抓回填几十条 content+rawHtml） | DB 体积膨胀 | 单源典型 ~30 条 × 50KB ≈ 1.5MB 可接受；如真有问题在 SP-4 引入清洗 |
| `prisma migrate deploy` 在 prod 因新 unique 索引失败（重复数据） | 部署 break | prod 此前没有 SourceConfig 数据（SP-0 没 seed），不存在重复；安全 |
| BullMQ repeatable 重启后重复注册 | 重复任务 | 用固定 `jobId` 即可（设计已规避） |
| Worker 启动慢 → docker healthcheck 失败 | 容器重启 | liveness file 在 `LivenessService.onModuleInit` 立即写一次（已有）；`CrawlScheduler` enqueue 不阻塞启动；超时阈值 60s 充足 |
| Web 端 SSR fetch 走 caddy 走外网 | 慢 | dev 走 localhost，无问题；prod SSR 经外网 ~1s 内可接受。SP-9 起再引入 INTERNAL_API_URL 优化容器内调用 |
| 单一 RSS 源更新慢，很久看不到新数据 | 验收信心不足 | seed 写入 4 个候选（3 个默认启用）；boot 回填一次性补齐历史 ≥ 10 条 |
| rss-parser 对国内网络不稳定 | dev 体验 | 不强制翻墙；本地 dev 失败时 logger.warn 但不 crash；prod 在境外 VPS 没此问题 |

### 6.5 完工 Checklist

```text
[ ] packages/utils 创建并 export normalizeUrl + computeDedupeHash + 单元测试全过
[ ] packages/types 增加 RawCrawledItem / HotNewsListItemDto / HotNewsListResponseDto
[ ] packages/db: schema 增加 @@unique([platform, url])，生成 add_source_config_unique migration
[ ] packages/db: prisma/seed.ts + package.json prisma.seed 配置 + root db:seed 脚本
[ ] apps/worker: rss-parser / @nestjs/bullmq / bullmq / ioredis 依赖加入
[ ] apps/worker: PrismaModule + CrawlModule（含 RssCrawler / IngestionService / CrawlProcessor / CrawlScheduler）
[ ] apps/worker: .env.example 增加 RSS_USER_AGENT / RSS_FETCH_TIMEOUT_MS
[ ] apps/api: PrismaModule + HotNewsModule (Controller + Service + DTO)
[ ] apps/web: lib/api.ts + /news 路由 + 5 个子组件 + 首页加链接
[ ] 所有单元 + 集成测试通过
[ ] 本地 pnpm db:seed → SourceConfig 入库
[ ] 本地 pnpm dev → worker 30s 内日志含 "Registered N RSS sources" 和 "RSS fetched: X items, Y new"
[ ] curl localhost:3001/hot-news?pageSize=20 → 200，items.length >= 10
[ ] open localhost:3000/news → 浏览器看到 ≥10 条真实 RSS 内容
[ ] 重启 worker 验证 repeatable 不重复注册（job 列表数量稳定）
[ ] CI 全绿
[ ] 部署到 VPS 后跑 db:seed
[ ] curl https://<domain>/api/hot-news?pageSize=20 → 200 + items.length 增长
[ ] README.md 更新部署文档（首次部署后 seed 命令）
```

---

## 7. 后续步骤

本 spec 经用户审阅批准后：

1. 调用 `writing-plans` skill，把本 spec 转化为 step-by-step 实施计划文档（`docs/superpowers/plans/2026-05-XX-sp1-rss-end-to-end-plan.md`）
2. 计划文档审阅通过后，进入 SP-1 实施
3. SP-1 完成（Checklist 全打勾）后，启动 **SP-2（HackerNews 抓取器）** 的 brainstorming
