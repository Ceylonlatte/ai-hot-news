# SP-2：HackerNews 抓取器 设计

- **日期**：2026-05-03
- **状态**：Draft，待用户审阅
- **所属**：Phase 2 / SP-2（详见 `2026-05-01-ai-hot-news-decomposition-design.md` 第 6 节）
- **预计工作量**：~2 天
- **本文档定位**：单个子项目实现 spec，用户审阅通过后调用 `writing-plans` 生成 step-by-step 实施计划。

---

## 1. 目标、范围与验收标准

### 1.1 目标

在 SP-1 的 RSS 端到端骨架基础上，新增 HackerNews 数据源（top / ask / show 三个 topic），同时把抓取层从"RSS-only"演进为"platform-agnostic"：`Crawler` / `CrawlScheduler` / `CrawlProcessor` 通用化，使 SP-3（Reddit）、SP-22（Twitter）等后续抓取器只需新增 `Crawler` 实现 + factory case 即可接入，无需重复造调度/处理基础设施。

**故意不做**：抓外链 HTML / 正文提取（→ SP-4 ArticleExtractor）；AI 关键词预过滤（个人监控关键词 → SP-16）；按 platform 列表过滤 UI（→ SP-10 FeedPage）。

### 1.2 In-scope

| 模块 | 内容 |
|---|---|
| `packages/utils`（扩展） | 新增 `stripHtml(input: string): string`，从 `apps/worker/src/crawl/crawlers/rss.crawler.ts` 内联函数抽离，RSS/HN 共用 |
| `packages/types`（扩展） | `RawCrawledItem` 新增可选字段 `interactionData?: Record<string, unknown> \| null`；`SourceLike`-类的辅助类型保持就地，由 worker 内部定义 |
| `packages/db`（扩展） | `prisma/seed.ts` 新增 3 条 HackerNews `SourceConfig`（top/ask/show） |
| `apps/worker`（扩展 + 改造） | 新增 `HackerNewsCrawler` + `CrawlerFactory`；`queue.provider.ts` 队列名 `'rss-crawl' → 'crawl'`；`CrawlScheduler` 通用化（按 platform 过滤 + 一次性 obliterate 老 'rss-crawl' 队列）；`CrawlProcessor` 用 factory 路由；`IngestionService` 通用化 `SourceLike` 与 `sourcePlatform`，透传 `interactionData` |
| `apps/web`（微调） | `news-item.tsx` 平台徽标：`HACKERNEWS` 显示为 "HN" 短标 + 颜色区分；其他平台保持原样 |
| `apps/api` | **无契约变化**（`GET /hot-news` SP-1 已支持任意 platform） |
| 环境变量 | 新增 `HN_FETCH_TIMEOUT_MS`（默认 15000）；保留 `RSS_USER_AGENT` 改为通用 `ai-hot-news-bot/0.1`，被 RSS + HN 共用 |
| 依赖 | `apps/worker` 加 `p-limit`（HN 并发控制） |

### 1.3 Out-of-scope（明确不做）

- 抓外链 HTML / 正文提取（HN 80%+ 是 link-post，正文要去外链拿）→ **归 SP-4** ArticleExtractor 模块。SP-2 阶段 link-post 的 `content = title`、`rawHtml = null`，由 `interactionData.externalUrl` 的存在性作为 SP-4 检测钩子。
- AI 关键词预过滤（"标题含 GPT/Claude/AI 才入库"）—— PRD 缺口 #12 已对齐：V0.1 不做关键词匹配，V0.2 起做用户监控关键词（→ SP-16）。
- 队列优先级 / 多并发限制（BullMQ 默认 concurrency:1 配合每 SourceConfig 独立 job 已够）。
- HN 评论抓取（仅抓 story 自身，过滤掉 `type !== 'story'` 的 item）。
- HN 旧帖回填（仅抓当前 top/ask/show 列表，不做 `maxitem` 倒推）。
- 列表 UI 按 platform 过滤（→ SP-10 FeedPage）。
- 队列优先级、按 platform 限制并发（默认配置足够）。

### 1.4 硬验收标准

```bash
# === 本地 dev 全流程 ===
pnpm install                                  # 0 错（新增 p-limit 依赖）
pnpm docker:dev                               # pg + redis 起
pnpm db:migrate:deploy                        # 应用 schema 迁移（SP-2 无 schema 改动，相当于 noop）
pnpm db:seed                                  # 写入 6 条 SourceConfig（3 RSS + 3 HN）
pnpm dev                                      # 三进程并行

# 等待 ~3 分钟（worker concurrency=1 串行处理 6 个 SourceConfig 的 boot job：
#   3 × RSS（每条 ~5-15s）+ 3 × HN（每条 ~30-60s）≈ 总 2-4 分钟）
# Worker 日志期望包含：
#   "Registered N enabled sources: 3 RSS, 3 HACKERNEWS"
#   "Old queue 'rss-crawl' obliterated"  (首次启动后的运行)
#   "RSS crawled: source=OpenAI News fetched=X inserted=Y skipped=Z failed=0"
#   "HACKERNEWS crawled: source=HackerNews Top fetched=500 inserted=A skipped=B failed=C"
#   "HACKERNEWS crawled: source=HackerNews Ask fetched=~200 ..."
#   "HACKERNEWS crawled: source=HackerNews Show fetched=~200 ..."

curl 'localhost:3001/hot-news?pageSize=100' | jq '.items | group_by(.sourcePlatform) | map({plat: .[0].sourcePlatform, n: length})'
# 期望: [{"plat":"HACKERNEWS","n":>=20},{"plat":"RSS","n":>=10}]

curl 'localhost:3001/hot-news?pageSize=100' | jq '.total'
# 期望：>= 30（混合 RSS + HN）

open http://localhost:3000/news               # 浏览器看到混合列表，HN 项有 "HN" 徽标

# === CI ===
# ci.yml 全绿（含新加的单元 + 集成测试）

# === 部署后（push 到 main 触发 deploy.yml）===
# 首次部署后 SSH 跑 db:seed（README 已记录）
docker compose ... run --rm --entrypoint sh api -c "cd packages/db && npx prisma db seed"

curl https://<domain>/api/hot-news?pageSize=100 | jq '.items | map(.sourcePlatform) | unique'
# 期望: ["HACKERNEWS", "RSS"]
```

### 1.5 不会修改的内容

- 不动 SP-0 monorepo 结构、Docker Compose 拓扑、CI 矩阵
- 不动 Prisma schema（已有 `Platform.HACKERNEWS` enum 和 `interactionData Json?` 字段）
- 不改 API 契约（`GET /hot-news` 已 platform-agnostic）
- 不引入 shadcn/ui、TanStack Query、Zustand 等（→ SP-8 起）

---

## 2. 架构与数据流

### 2.1 数据流图（SP-2 完工形态）

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                       Worker 进程 (NestJS standalone)                    │
│                                                                          │
│  Bootstrap                                                               │
│   ├─ 一次性迁移：oldQueue('rss-crawl').obliterate({ force: true })      │
│   │     幂等：老队列不存在则 no-op；首次执行清理旧 jobs                  │
│   ├─ findMany SourceConfig WHERE enabled=true                           │
│   │     AND platform IN (RSS, HACKERNEWS)                                │
│   ├─ 对每条 source：注册 BullMQ repeatable                              │
│   │     queue('crawl').add('crawl', {sourceConfigId},                    │
│   │       { repeat: every: source.crawlInterval * 1000,                  │
│   │         jobId: `crawl-repeat-${source.id}` })                        │
│   └─ 立即触发一次（boot 回填）                                          │
│         queue('crawl').add('crawl', {sourceConfigId},                    │
│           { jobId: `crawl-boot-${source.id}-${ts}` })                    │
│                                                                          │
│  CrawlProcessor.process(job)                                             │
│   ├─ source = prisma.sourceConfig.findUnique(...)                        │
│   ├─ crawler = CrawlerFactory.create(source)                             │
│   │     switch source.platform                                           │
│   │       case 'RSS'        → new RssCrawler({id, url})                  │
│   │       case 'HACKERNEWS' → new HackerNewsCrawler({id, identifier})    │
│   │       default → throw UnsupportedPlatformError                       │
│   ├─ items = await crawler.fetch()                                       │
│   ├─ result = await ingestion.ingest(items, source)                      │
│   │     IngestionService 通用化：sourcePlatform = source.platform        │
│   │     transparently 透传 raw.interactionData → HotNews.interactionData │
│   ├─ update SourceConfig.lastCrawledAt + status=NORMAL                   │
│   └─ catch → status=FAILED + errorMessage（BullMQ 自动重试 3 次）        │
│                                                                          │
│  HackerNewsCrawler.fetch()                                               │
│   ├─ topic = source.identifier  // 'top' / 'ask' / 'show'                │
│   ├─ ids = GET https://hacker-news.firebaseio.com/v0/{topic}stories.json │
│   ├─ items = pLimit(10, ids.map(id => GET /v0/item/{id}.json))           │
│   ├─ filter type==='story' && !deleted && !dead                          │
│   └─ map → RawCrawledItem                                                │
│         link-post: contentText=title, rawHtml=null,                      │
│                    interactionData.externalUrl=story.url                 │
│         self-post: contentText=stripHtml(text), rawHtml=text,            │
│                    interactionData.externalUrl=null                      │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ 写入
                       ┌────────────────────┐
                       │  PostgreSQL        │
                       │  hot_news 表        │
                       │  source_configs    │
                       └────────────────────┘
                                  ▲ 读取
                                  │
              ┌───────────────────┴───────────────────┐
              │                                       │
              │ apps/api: GET /hot-news (无变更)      │
              │ apps/web: /news (news-item 徽标微调)  │
              └───────────────────────────────────────┘
```

### 2.2 模块边界与职责（增量列出，不重述 SP-1 已有）

| 单元 | 输入 | 输出 | 依赖 | 备注 |
|---|---|---|---|---|
| `stripHtml`（utils 新增） | `string` | `string`（无 tag、norm 空白） | — | 从 `rss.crawler.ts` 抽离，RSS+HN 共用 |
| `HackerNewsCrawler`（worker 新增） | `{ id, identifier: 'top'\|'ask'\|'show' }` | `Promise<RawCrawledItem[]>` | global `fetch`、`p-limit`、`stripHtml` | 实现 `Crawler` 接口 |
| `CrawlerFactory`（worker 新增） | `SourceConfig` | `Crawler` | RssCrawler、HackerNewsCrawler | switch on platform |
| `CrawlScheduler`（worker 改造） | — | repeatable + boot enqueue | Queue、Prisma | 通用化 platform 过滤 + 一次性 obliterate 老队列 |
| `CrawlProcessor`（worker 改造） | `CrawlJobData` | 写库副作用 | Factory、IngestionService、Prisma | 用 factory 替代直接 `new RssCrawler` |
| `IngestionService`（worker 改造） | `RawCrawledItem[]` + 通用 `SourceLike` | `IngestResult` | Prisma、utils | 移除 `platform: 'RSS'` 写死，`sourcePlatform` 来自 source |

### 2.3 关键接口签名（变化）

```ts
// packages/types/src/dtos.ts —— RawCrawledItem 扩展
export interface RawCrawledItem {
  title: string;
  contentText: string;
  rawHtml: string | null;
  sourceUrl: string;
  author: string | null;
  publishedAt: Date | null;
  // 新增：平台特定互动数据，透传到 HotNews.interactionData
  // 跨平台命名空间约定见本 spec §4.2
  interactionData?: Record<string, unknown> | null;
}

// apps/worker/src/crawl/crawlers/crawler.interface.ts —— 接口本体不变
export interface Crawler {
  fetch(): Promise<RawCrawledItem[]>;
}

// apps/worker/src/crawl/crawler.factory.ts —— 新增
export type CrawlerSource = {
  id: string;
  platform: Platform;
  url: string | null;
  identifier: string | null;
};

@Injectable()
export class CrawlerFactory {
  create(source: CrawlerSource): Crawler;
}

// apps/worker/src/crawl/ingestion.service.ts —— SourceLike 通用化
interface SourceLike {
  id: string;
  platform: Platform;        // 改自 'RSS' 字面量类型
  url: string | null;
  identifier: string | null; // 新增（HN 用 identifier 区分 topic）
  name: string;
}
```

### 2.4 配置与环境变量

| 变量 | 谁用 | 默认 | SP-2 变化 |
|---|---|---|---|
| `DATABASE_URL` / `REDIS_URL` | api / worker | SP-0 | 不变 |
| `RSS_USER_AGENT` | RSS + HN crawler | `ai-hot-news-bot/0.1` | **复用**（语义改为通用 crawler UA）；不重命名以保留向后兼容 |
| `RSS_FETCH_TIMEOUT_MS` | RSS crawler | `15000` | 不变 |
| `HN_FETCH_TIMEOUT_MS` | HN crawler | `15000` | **新增**，HN 单独控制 |
| `HN_CONCURRENCY` | HN crawler | `10` | **新增**，p-limit 并发数；spec §7 升级钩子提及触发条件 |

新增变量加进 `apps/worker/.env.example`：

```
# HackerNews
HN_FETCH_TIMEOUT_MS=15000
HN_CONCURRENCY=10
```

---

## 3. Worker 详细设计

### 3.1 文件结构变化

```text
apps/worker/
├── src/
│   ├── worker.module.ts                      # 不变（已 imports CrawlModule）
│   └── crawl/
│       ├── crawl.module.ts                   # 修改：注册 CrawlerFactory
│       ├── queue.provider.ts                 # 修改：CRAWL_QUEUE_NAME 'rss-crawl' → 'crawl'
│       ├── crawl.processor.ts                # 修改：用 factory 路由
│       ├── crawl.scheduler.ts                # 修改：通用化 + obliterate 老队列
│       ├── crawler.factory.ts                # 新增
│       ├── crawler.factory.spec.ts           # 新增
│       ├── ingestion.service.ts              # 修改：通用化 source + 透传 interactionData
│       ├── ingestion.service.integration.spec.ts # 修改：补 HN case
│       ├── crawlers/
│       │   ├── crawler.interface.ts          # 不变
│       │   ├── rss.crawler.ts                # 修改：stripHtml 改为 from @ai-hot-news/utils
│       │   ├── rss.crawler.spec.ts           # 不变（mock 行为不变）
│       │   ├── hackernews.crawler.ts         # 新增
│       │   ├── hackernews.crawler.spec.ts    # 新增
│       │   └── hackernews.types.ts           # 新增（HnStory 接口）
│       └── fixtures/
│           ├── sample-rss-feed.xml           # 不变
│           ├── hn-topstories-ids.json        # 新增（5 个 ID 模拟）
│           ├── hn-story-link-post.json       # 新增（type='story', 有 url）
│           ├── hn-story-self-post.json       # 新增（type='story', 无 url, 有 text）
│           ├── hn-story-comment.json         # 新增（type='comment', 应被过滤）
│           └── hn-story-deleted.json         # 新增（deleted=true, 应被过滤）
└── package.json                              # 新依赖：p-limit
```

```text
packages/
├── utils/
│   └── src/
│       ├── index.ts                          # 修改：export stripHtml
│       ├── strip-html.ts                     # 新增
│       └── strip-html.spec.ts                # 新增
└── types/
    └── src/
        └── dtos.ts                           # 修改：RawCrawledItem 加 interactionData
```

```text
packages/db/prisma/
└── seed.ts                                   # 修改：加 3 条 HN SourceConfig
```

### 3.2 队列重命名迁移：'rss-crawl' → 'crawl'

`queue.provider.ts` 改造：

```ts
// 修改前
export const CRAWL_QUEUE_NAME = 'rss-crawl';

// 修改后
export const CRAWL_QUEUE_NAME = 'crawl';
```

`CrawlScheduler.onModuleInit` 在注册新队列前，**幂等清理老 `rss-crawl` 队列**。注意 `CrawlScheduler` 构造函数需要新增 `REDIS_CONNECTION` 注入（SP-1 仅注入了 `CRAWL_QUEUE`）：

```ts
import IORedis from 'ioredis';
import { Queue, type ConnectionOptions } from 'bullmq';
import { CRAWL_QUEUE, CRAWL_QUEUE_NAME, REDIS_CONNECTION } from './queue.provider';

@Injectable()
export class CrawlScheduler implements OnModuleInit {
  constructor(
    @Inject(CRAWL_QUEUE) private readonly queue: Queue,
    @Inject(REDIS_CONNECTION) private readonly connection: IORedis, // 新增
  ) {}

async onModuleInit(): Promise<void> {
  // 一次性迁移：清理 SP-1 时代 'rss-crawl' 队列
  // 幂等：老队列不存在则 obliterate 立即返回（Redis 找不到 key 即 no-op）
  const oldQueue = new Queue('rss-crawl', {
    connection: this.connection as unknown as ConnectionOptions, // 与 queue.provider.ts 一致的 cast 模式
  });
  try {
    await oldQueue.obliterate({ force: true });
    this.logger.log("Old queue 'rss-crawl' obliterated");
  } catch (err) {
    // obliterate 在空队列上不抛错；非空但有 active job 时会抛
    // force:true 已覆盖大多数情况；保留 catch 防御
    this.logger.warn(`Old queue obliterate skipped: ${(err as Error).message}`);
  } finally {
    await oldQueue.close();
  }

  // 通用化注册（SP-1 仅 RSS → SP-2 RSS + HACKERNEWS）
  const sources = await getPrisma().sourceConfig.findMany({
    where: {
      enabled: true,
      platform: { in: [Platform.RSS, Platform.HACKERNEWS] },
    },
  });

  for (const source of sources) {
    await this.queue.add(
      CRAWL_QUEUE_NAME,
      { sourceConfigId: source.id },
      {
        repeat: { every: source.crawlInterval * 1000 },
        jobId: `crawl-repeat-${source.id}`,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    );
    await this.queue.add(
      CRAWL_QUEUE_NAME,
      { sourceConfigId: source.id },
      {
        jobId: `crawl-boot-${source.id}-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: { count: 50 },
      },
    );
  }

  const counts = sources.reduce<Record<string, number>>((acc, s) => {
    acc[s.platform] = (acc[s.platform] ?? 0) + 1;
    return acc;
  }, {});
  this.logger.log(
    `Registered ${sources.length} enabled sources: ` +
      Object.entries(counts).map(([p, n]) => `${n} ${p}`).join(', '),
  );
}
```

> **运行流程说明**：
> - dev：用户首次跑新版 worker 时，老 `rss-crawl` 队列被 obliterate，新 `crawl` 队列接管
> - prod：deploy 后 worker 重启执行同样逻辑，**首次有少量 in-flight 'rss-crawl' job 可能丢失**（最多丢 3 个 source × 1 个 boot job = 3 次抓取），可接受（下一个 repeatable 触发自动补）
> - 二次运行：老队列已不存在，obliterate no-op
> - **不需要单独的 migration 脚本**，部署流程零增量

`CRAWL_QUEUE` symbol、`createCrawlWorker`、`Worker` 实例本身**绑定 `CRAWL_QUEUE_NAME` 常量**，无需手工迁移代码——改一处，全链路重命名。

### 3.3 HackerNewsCrawler 实现

```ts
// apps/worker/src/crawl/crawlers/hackernews.crawler.ts
import pLimit from 'p-limit';
import { stripHtml } from '@ai-hot-news/utils';
import type { RawCrawledItem } from '@ai-hot-news/types';
import type { Crawler } from './crawler.interface';
import type { HnStory } from './hackernews.types';

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';
const TOPIC_ENDPOINT = {
  top: 'topstories',
  ask: 'askstories',
  show: 'showstories',
} as const;

export type HnTopic = keyof typeof TOPIC_ENDPOINT;

interface HnSource {
  id: string;
  identifier: string | null; // 'top' | 'ask' | 'show'
}

export class HackerNewsCrawler implements Crawler {
  constructor(private readonly source: HnSource) {}

  async fetch(): Promise<RawCrawledItem[]> {
    const topic = this.source.identifier as HnTopic | null;
    if (!topic || !(topic in TOPIC_ENDPOINT)) {
      throw new Error(
        `HN SourceConfig ${this.source.id} invalid identifier=${topic}; ` +
          `expected one of: ${Object.keys(TOPIC_ENDPOINT).join(', ')}`,
      );
    }

    const ids = await this.fetchIds(topic);
    const limit = pLimit(this.concurrency());
    const stories = await Promise.all(
      ids.map((id) => limit(() => this.fetchStory(id))),
    );
    return stories
      .filter(this.isValidStory)
      .map((s) => this.toRaw(s, topic));
  }

  private async fetchIds(topic: HnTopic): Promise<number[]> {
    const url = `${HN_BASE}/${TOPIC_ENDPOINT[topic]}.json`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(this.timeoutMs()),
      headers: { 'User-Agent': this.userAgent() },
    });
    if (!res.ok) {
      throw new Error(`HN ids fetch ${res.status} ${res.statusText} for ${topic}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error(`HN ids response not array for ${topic}: ${JSON.stringify(data).slice(0, 100)}`);
    }
    return data as number[];
  }

  private async fetchStory(id: number): Promise<HnStory | null> {
    try {
      const res = await fetch(`${HN_BASE}/item/${id}.json`, {
        signal: AbortSignal.timeout(this.timeoutMs()),
        headers: { 'User-Agent': this.userAgent() },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as HnStory | null;
      return data;
    } catch {
      // 单条失败（超时/JSON 错/网络）静默跳过，不影响整批
      return null;
    }
  }

  private isValidStory = (s: HnStory | null): s is HnStory => {
    if (!s) return false;
    if (s.type !== 'story') return false;        // 过滤 comment / job / poll
    if (s.deleted || s.dead) return false;
    if (!s.title) return false;                  // 防御性
    return true;
  };

  private toRaw(s: HnStory, topic: HnTopic): RawCrawledItem {
    const isSelfPost = !s.url && !!s.text;
    const title = s.title ?? '(untitled)';
    return {
      title,
      // link-post: contentText 仅为 title（SP-4 ArticleExtractor 检测钩子=
      //   rawHtml IS NULL AND interactionData.externalUrl IS NOT NULL）
      // self-post: contentText = stripHtml(text)
      contentText: isSelfPost ? stripHtml(s.text!) : title,
      rawHtml: isSelfPost ? s.text! : null,
      sourceUrl: `https://news.ycombinator.com/item?id=${s.id}`,
      author: s.by ?? null,
      publishedAt: s.time ? new Date(s.time * 1000) : null,
      interactionData: {
        score: s.score ?? 0,
        comments: s.descendants ?? 0,
        externalUrl: s.url ?? null,
        hnId: s.id,
        // hnTopic 不写：跨 topic 同 story 时会争夺，且对业务无用
        //   （topic 是抓取入口元数据，非 story 本体属性）
      },
    };
  }

  private timeoutMs(): number {
    const raw = parseInt(process.env.HN_FETCH_TIMEOUT_MS ?? '15000', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 15000;
  }

  private concurrency(): number {
    const raw = parseInt(process.env.HN_CONCURRENCY ?? '10', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 10;
  }

  private userAgent(): string {
    return process.env.RSS_USER_AGENT ?? 'ai-hot-news-bot/0.1';
  }
}
```

```ts
// apps/worker/src/crawl/crawlers/hackernews.types.ts
// HN Firebase API item schema（仅列 SP-2 用到的字段）
// 参考：https://github.com/HackerNews/API#items
export interface HnStory {
  id: number;
  type?: 'story' | 'comment' | 'job' | 'poll' | 'pollopt';
  by?: string;
  time?: number;          // Unix 秒
  title?: string;
  url?: string;            // link-post 才有
  text?: string;           // self-post 才有（HTML）
  score?: number;
  descendants?: number;    // 评论数
  deleted?: boolean;
  dead?: boolean;
}
```

### 3.4 CrawlerFactory

```ts
// apps/worker/src/crawl/crawler.factory.ts
import { Injectable } from '@nestjs/common';
import { Platform } from '@ai-hot-news/db';
import type { Crawler } from './crawlers/crawler.interface';
import { RssCrawler } from './crawlers/rss.crawler';
import { HackerNewsCrawler } from './crawlers/hackernews.crawler';

export interface CrawlerSource {
  id: string;
  platform: Platform;
  url: string | null;
  identifier: string | null;
}

@Injectable()
export class CrawlerFactory {
  create(source: CrawlerSource): Crawler {
    switch (source.platform) {
      case Platform.RSS:
        return new RssCrawler({ id: source.id, url: source.url });
      case Platform.HACKERNEWS:
        return new HackerNewsCrawler({ id: source.id, identifier: source.identifier });
      // case Platform.REDDIT: → SP-3
      // case Platform.TWITTER: → SP-22
      default:
        throw new Error(`Unsupported crawler platform: ${source.platform}`);
    }
  }
}
```

注册到 `CrawlModule`：

```ts
// apps/worker/src/crawl/crawl.module.ts —— providers 增加 CrawlerFactory
@Module({
  providers: [
    redisProvider,
    queueProvider,
    {
      provide: CRAWL_WORKER,
      useFactory: (connection, ingestion, factory) => { ... },
      inject: [REDIS_CONNECTION, IngestionService, CrawlerFactory],  // 新增 factory inject
    },
    IngestionService,
    CrawlerFactory,                                                   // 新增
    CrawlScheduler,
  ],
  exports: [IngestionService],
})
```

### 3.5 CrawlProcessor 改造

```ts
// apps/worker/src/crawl/crawl.processor.ts
import { Logger } from '@nestjs/common';
import { getPrisma, SourceStatus } from '@ai-hot-news/db';
import type { CrawlerFactory } from './crawler.factory';
import type { IngestionService } from './ingestion.service';

const logger = new Logger('CrawlProcessor');

export interface CrawlJobData {
  sourceConfigId: string;
}

export async function processCrawlJob(
  data: CrawlJobData,
  ingestion: IngestionService,
  factory: CrawlerFactory,
): Promise<void> {
  const prisma = getPrisma();
  const source = await prisma.sourceConfig.findUnique({ where: { id: data.sourceConfigId } });
  if (!source) {
    logger.warn(`SourceConfig ${data.sourceConfigId} not found, skipping`);
    return;
  }
  if (!source.enabled) {
    logger.debug(`SourceConfig ${source.id} disabled, skipping`);
    return;
  }

  let crawler;
  try {
    crawler = factory.create(source);
  } catch (err) {
    // 未支持的 platform → 不重试，直接标记 failed（避免 BullMQ 死循环）
    logger.error(`Unsupported platform: ${(err as Error).message}`);
    await prisma.sourceConfig.update({
      where: { id: source.id },
      data: { status: SourceStatus.FAILED, errorMessage: (err as Error).message.slice(0, 500) },
    });
    return;
  }

  try {
    const items = await crawler.fetch();
    const result = await ingestion.ingest(items, {
      id: source.id,
      platform: source.platform,
      url: source.url,
      identifier: source.identifier,
      name: source.name,
    });
    logger.log(
      `${source.platform} crawled: source=${source.name} ` +
        `fetched=${result.fetched} inserted=${result.inserted} ` +
        `skipped=${result.skipped} failed=${result.failed}`,
    );
    await prisma.sourceConfig.update({
      where: { id: source.id },
      data: { lastCrawledAt: new Date(), status: SourceStatus.NORMAL, errorMessage: null },
    });
  } catch (err) {
    const msg = (err as Error).message;
    logger.error(`${source.platform} crawl failed: source=${source.name} error=${msg}`);
    await prisma.sourceConfig.update({
      where: { id: source.id },
      data: { status: SourceStatus.FAILED, errorMessage: msg.slice(0, 500) },
    });
    throw err; // BullMQ 自动重试
  }
}
```

### 3.6 IngestionService 通用化

```ts
// apps/worker/src/crawl/ingestion.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { getPrisma, type Platform } from '@ai-hot-news/db';
import { computeDedupeHash, normalizeUrl } from '@ai-hot-news/utils';
import type { RawCrawledItem } from '@ai-hot-news/types';

export interface IngestResult {
  fetched: number;
  inserted: number;
  skipped: number;
  failed: number;
}

interface SourceLike {
  id: string;
  platform: Platform;             // 改自 'RSS' literal
  url: string | null;
  identifier: string | null;       // 新增
  name: string;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  async ingest(items: RawCrawledItem[], source: SourceLike): Promise<IngestResult> {
    const prisma = getPrisma();
    const result: IngestResult = { fetched: items.length, inserted: 0, skipped: 0, failed: 0 };

    for (const raw of items) {
      try {
        if (!raw.sourceUrl) {
          result.skipped += 1;
          continue;
        }
        const sourceUrl = normalizeUrl(raw.sourceUrl);
        const dedupeHash = computeDedupeHash(sourceUrl, raw.title);
        try {
          await prisma.hotNews.create({
            data: {
              title: raw.title,
              content: raw.contentText,
              rawHtml: raw.rawHtml,
              sourcePlatform: source.platform,         // 通用化
              sourceUrl,
              author: raw.author,
              publishedAt: raw.publishedAt ?? new Date(),
              dedupeHash,
              // 透传 interactionData（可选字段，undefined 时 Prisma 不写；Prisma 会自动接受 Record<string, unknown> 作为 Json 输入）
              ...(raw.interactionData != null
                ? { interactionData: raw.interactionData }
                : {}),
            },
          });
          result.inserted += 1;
        } catch (createErr) {
          if ((createErr as { code?: string }).code === 'P2002') {
            result.skipped += 1;
          } else {
            throw createErr;
          }
        }
      } catch (err) {
        this.logger.warn(`Ingest item failed: ${raw.sourceUrl} → ${(err as Error).message}`);
        result.failed += 1;
      }
    }
    return result;
  }
}
```

> **interactionData 写入**：用 spread 模式 `...(raw.interactionData != null ? { interactionData } : {})`，避免 RSS 模式下显式写 `null`（Prisma `Json?` 字段允许 null，但保留 default `null` 在 schema 默认行为更干净）。
>
> **重复 upsert 时 interactionData 不更新**：当前用 `create` + P2002 catch，第二次 ingest 同 sourceUrl 直接 skip，**不更新 interactionData/score/comments**。这是 SP-2 的故意限制——score/comments 实时性 → SP-6 热度计算时再决定如何刷新（独立 worker 周期 `refresh-interaction-data`，避免和抓取耦合）。spec §7 升级钩子记录此项。

### 3.7 stripHtml 抽到 packages/utils

```ts
// packages/utils/src/strip-html.ts
export function stripHtml(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
```

```ts
// packages/utils/src/index.ts —— 增加 export
export { stripHtml } from './strip-html.js';
export { normalizeUrl } from './url.js';
export { computeDedupeHash } from './dedupe.js';
```

`apps/worker/src/crawl/crawlers/rss.crawler.ts` 局部 `stripHtml` 删除，改为：

```ts
import { stripHtml } from '@ai-hot-news/utils';
```

> esbuild bundle 模式下 utils 输出 CJS dist，与 SP-1 已建立的模式一致。无需新工程化改动。

---

## 4. 数据模型映射

### 4.1 HotNews 字段填充规则（HN）

| 字段 | link-post | self-post（Ask HN / Show HN 自身） |
|---|---|---|
| `sourcePlatform` | `HACKERNEWS` | `HACKERNEWS` |
| `sourceUrl` | `https://news.ycombinator.com/item?id={id}`（永久 unique） | 同 |
| `title` | `story.title` | `story.title` |
| `content` | `title`（重复）—— **作为 SP-4 ArticleExtractor 检测哨兵之一** | `stripHtml(story.text)` |
| `rawHtml` | `null` —— **作为 SP-4 检测哨兵之二** | `story.text` (HTML) |
| `author` | `story.by`（HN username） | 同 |
| `publishedAt` | `new Date(story.time * 1000)` | 同 |
| `dedupeHash` | `computeDedupeHash(sourceUrl, title)` | 同 |
| `interactionData` | `{ score, comments, externalUrl: story.url, hnId }` | `{ score, comments, externalUrl: null, hnId }` |
| `summary` / `aiTags` / `embedding` / `groupId` / `heatScore` | null / 默认值（→ SP-5/6/7） | 同 |

**SP-4 ArticleExtractor 待提取条目识别 SQL**：

```sql
SELECT id, source_url, interaction_data->>'externalUrl' AS external_url
FROM hot_news
WHERE raw_html IS NULL
  AND interaction_data->>'externalUrl' IS NOT NULL
  AND interaction_data->>'externalUrl' != ''
LIMIT 100;
```

### 4.2 interactionData 字段约定（跨 platform 命名空间）

为避免后续 SP-3/SP-22 字段名混乱，本 spec 立约：

| 字段 | 类型 | 含义 | 来源 |
|---|---|---|---|
| **通用字段（platform-agnostic）** | | | |
| `score` | number | 单一"赞同度"指标（HN: score / Reddit: ups / Twitter: likes） | 抓取层映射 |
| `comments` | number | 评论/回复数 | 抓取层映射 |
| `externalUrl` | string \| null | 原文外链（如有）；HN/Reddit link-post 用 | 抓取层映射 |
| **HN 专属（前缀 `hn`）** | | | |
| `hnId` | number | HN item id（用于深链 / debug） | HackerNewsCrawler |
| **Reddit 预留（前缀 `reddit`，→ SP-3）** | | | |
| `redditId` / `redditSubreddit` | — | — | RedditCrawler |
| **Twitter 预留（前缀 `tw`，→ SP-22）** | | | |
| `twTweetId` / `twReposts` | — | — | TwitterCrawler |

**约定原则**：
- 通用字段（`score` / `comments` / `externalUrl`）强制小写 camelCase，所有 platform 必填或 `null`
- platform 专属字段加 platform 前缀（`hnId` / `redditId` / `twTweetId`），避免命名冲突
- 不存 `hnTopic`：跨 topic 同 story 入库时 first-write-wins 会导致字段不可靠，且业务上无用（topic 是抓取入口）

### 4.3 SourceConfig seed 数据（HN 三条新增）

```ts
// packages/db/prisma/seed.ts —— candidates 数组追加
const hnCandidates: Array<{
  name: string;
  identifier: string;
  enabled: boolean;
  crawlInterval: number;
}> = [
  { name: 'HackerNews Top',  identifier: 'top',  enabled: true, crawlInterval: 900  }, // 15 分
  { name: 'HackerNews Ask',  identifier: 'ask',  enabled: true, crawlInterval: 1800 }, // 30 分
  { name: 'HackerNews Show', identifier: 'show', enabled: true, crawlInterval: 1800 }, // 30 分
];

// 写入逻辑（HN 用 platform + identifier 复合 key 做幂等，url 为 null）
for (const c of hnCandidates) {
  // SourceConfig 当前唯一约束是 @@unique([platform, url])
  // 但 HN 的 url 都是 null，无法用作唯一性 key
  // → 先按 (platform, identifier) findFirst，存在则 update，不存在则 create
  const existing = await prisma.sourceConfig.findFirst({
    where: { platform: 'HACKERNEWS', identifier: c.identifier },
  });
  if (existing) {
    await prisma.sourceConfig.update({
      where: { id: existing.id },
      data: { name: c.name, crawlInterval: c.crawlInterval },
      // 不覆盖 enabled 与 status，便于运维手工调
    });
  } else {
    await prisma.sourceConfig.create({
      data: {
        platform: 'HACKERNEWS',
        name: c.name,
        url: null,
        identifier: c.identifier,
        enabled: c.enabled,
        crawlInterval: c.crawlInterval,
      },
    });
  }
  console.log(`seeded: ${c.name} (identifier=${c.identifier}, enabled=${c.enabled})`);
}
```

> **不加 `@@unique([platform, identifier])`**：因为 SourceConfig.identifier 是 `String?`（nullable），Postgres 中 NULL ≠ NULL，加复合唯一会导致多行 RSS（identifier=null）撞库。findFirst+upsert 模式更稳。
>
> 若日后 HN topic 增加（如 best/new），扩展 candidates 数组即可，幂等。

---

## 5. Web 微调（`/news` 平台徽标）

仅 `apps/web/app/news/_components/news-item.tsx` 改动：

```tsx
import type { HotNewsListItemDto } from '@ai-hot-news/types';

const TIME_FMT = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' });

const PLATFORM_LABEL: Record<string, string> = {
  RSS: 'RSS',
  HACKERNEWS: 'HN',
  REDDIT: 'Reddit',
  TWITTER: 'X',
};

const PLATFORM_BADGE_CLASS: Record<string, string> = {
  RSS:        'bg-blue-50 text-blue-700',
  HACKERNEWS: 'bg-orange-50 text-orange-700',
  REDDIT:     'bg-red-50 text-red-700',
  TWITTER:    'bg-gray-100 text-gray-700',
};

export function NewsItem({ item }: { item: HotNewsListItemDto }) {
  const label = PLATFORM_LABEL[item.sourcePlatform] ?? item.sourcePlatform;
  const badgeCls = PLATFORM_BADGE_CLASS[item.sourcePlatform] ?? 'bg-gray-100 text-gray-700';
  return (
    <li className="py-3">
      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-base font-medium text-gray-900 hover:underline"
      >
        {item.title}
      </a>
      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
        <span>{item.author ?? '匿名'}</span>
        <span>·</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${badgeCls}`}>
          {label}
        </span>
        <span>·</span>
        <span>{TIME_FMT.format(new Date(item.publishedAt))}</span>
      </div>
    </li>
  );
}
```

> 不改 API、不改 `HotNewsListItemDto`、不引入新依赖。仅视觉微调让 HN 项一眼可辨。

**首页链接、列表头、空状态、错误状态、分页器全部不变**。

---

## 6. 测试矩阵

| 测试 | 文件 | 类型 | 关键 case |
|---|---|---|---|
| `stripHtml` | `packages/utils/src/strip-html.spec.ts` | 单元 | 移除 `<script>`、`<style>` 整段；常规 tag 清除；`&nbsp;` 等 entity（不解码，保留为字符）；空白 norm；空输入 |
| `RawCrawledItem.interactionData` | 类型层 | 编译期 | TS 编译通过即可（无 runtime 测试） |
| `RssCrawler` | `apps/worker/src/crawl/crawlers/rss.crawler.spec.ts` | 单元 | 现有测试复跑，验证 stripHtml 抽离后行为不变 |
| `HackerNewsCrawler.fetch` | `apps/worker/src/crawl/crawlers/hackernews.crawler.spec.ts` | 单元 | mock global.fetch；topic=top/ask/show 各跑；ids GET 200 + items GET 200 → toRaw 映射；link-post → externalUrl in interactionData，rawHtml=null，contentText=title；self-post → rawHtml=text，contentText=stripped；type=comment/job/poll → 过滤；deleted/dead → 过滤；单条 GET 失败（500 / 超时 / JSON parse err）→ 整批继续；invalid identifier → throw；ids GET 失败 → throw（被 BullMQ 重试） |
| `CrawlerFactory` | `apps/worker/src/crawl/crawler.factory.spec.ts` | 单元 | RSS → RssCrawler 实例；HACKERNEWS → HackerNewsCrawler 实例；UNKNOWN → throw |
| `CrawlScheduler` | `apps/worker/src/crawl/crawl.scheduler.spec.ts`（新增） | 单元（mock Queue 与 prisma） | `obliterate('rss-crawl')` 被调用一次（force:true）；多 platform sources 都被 `queue.add` 注册；jobId 模式 `crawl-repeat-{id}` / `crawl-boot-{id}-{ts}`；老队列 obliterate 抛错时 logger.warn 但不阻塞主流程 |
| `IngestionService` 通用化 | `apps/worker/src/crawl/ingestion.service.integration.spec.ts` | 集成（真 PG） | 已有 RSS case 复跑（platform=RSS 通用化后行为不变）；新增 HN case：interactionData={score:X,comments:Y,externalUrl:Z,hnId:W} 透传到 HotNews.interactionData；同 sourceUrl 第二次 ingest 跳过且 interactionData 不被覆盖（SP-2 故意限制） |
| `processCrawlJob` | （**不单测**，由 integration spec 隐式覆盖） | — | `processCrawlJob` 是函数级粘合，行为完全由 factory + ingestion 决定 |
| Web `/news` 平台徽标 | （**不单测**，依赖人工验收）| — | 浏览器看到 HN 项 "HN" 橙色徽标 |

CI 中：
- `pnpm turbo lint typecheck build` —— 现有
- `pnpm turbo test` —— 现有，自动捕获新单元 + 集成测试
- 集成测试沿用 SP-1 的 PG service container，无需 ci.yml 改动

**测试 fixture 准备清单**（5 个 JSON 文件 + 1 个 IDs 列表）：

```json
// hn-topstories-ids.json
[44000001, 44000002, 44000003, 44000004, 44000005]

// hn-story-link-post.json
{
  "id": 44000001, "type": "story", "by": "alice",
  "time": 1746230400, "title": "GPT-5 announced",
  "url": "https://openai.com/news/gpt-5",
  "score": 234, "descendants": 45
}

// hn-story-self-post.json (Show HN)
{
  "id": 44000002, "type": "story", "by": "bob",
  "time": 1746230500, "title": "Show HN: My side project",
  "text": "<p>I built this in <b>2 weekends</b>.</p>",
  "score": 12, "descendants": 3
}

// hn-story-comment.json (应被过滤)
{
  "id": 44000003, "type": "comment", "by": "carol",
  "time": 1746230600, "text": "Great post!"
}

// hn-story-deleted.json (应被过滤)
{
  "id": 44000004, "type": "story", "deleted": true
}
```

---

## 7. 错误处理 + 升级钩子

### 7.1 分层错误处理

| 失败类型 | 行为 |
|---|---|
| HN ids GET 失败（5xx / 网络 / 超时）| `HackerNewsCrawler.fetch` throw → BullMQ 自动重试 3 次指数退避 → 终失败 SourceConfig.status='FAILED' |
| HN 单条 item GET 失败 | `fetchStory` catch 返回 null → filter 过滤 → 整批继续，不阻塞 |
| HN 返回非数组 IDs（API 异常） | `fetchIds` throw → 同 ids GET 失败处理 |
| HN 429 限速 | 当前未特殊处理（5xx 视同 429）→ 触发升级钩子（见 §7.2） |
| `factory.create` 抛 UnsupportedPlatform | `processCrawlJob` 不重试，直接 SourceConfig.status='FAILED'（避免 BullMQ 死循环） |
| `obliterate('rss-crawl')` 抛错 | `CrawlScheduler` logger.warn 但不阻塞主流程注册新队列 |
| 单条 ingest P2002（重复） | `result.skipped++`，不算失败 |
| 单条 ingest 其他错（schema / DB） | warn 日志 + `result.failed++`，整批继续 |

### 7.2 升级钩子（spec 显式记录，触发条件出现时改动 spec § 引用）

| 触发条件 | 当前实现 | 升级路径 |
|---|---|---|
| HN API 持续 429（>3 次/24h）| 全拉 + 并发 10，无特殊处理 | 1. 把 `HN_CONCURRENCY` 从 10 降到 5；2. 引入 `Crawler.listIds()` + `fetchByIds()` 双方法接口（spec §Q6 方案 Z），processor 层 lookahead 用 prisma 过滤已存在 ID，把 HTTP 量从 ~900/run 降到 ~10-50/run |
| 单 SourceConfig 抓取耗时 > 5min | BullMQ 默认 `stalledInterval=30s`（SP-1 `queue.provider.ts` 未覆盖默认值）。但 stalled 检测看 worker 心跳而非任务时长，单 job 跑 60s 不会被误杀；除非 worker process 整体卡死 | 1. `createCrawlWorker` 加 `stalledInterval: 60_000` + `lockDuration: 120_000`；2. 同上引入 lookahead 把单 job 时长压到 < 30s |
| 跨 topic 同 story 互动数据需要刷新 | first-write-wins，never update | 增加独立 `refresh-interaction-data` worker（每 6h 跑一遍），按 sourcePlatform 分桶刷 score/comments；归 SP-6 范围 |
| HN 增加新 topic（如 best）| seed.ts 数组追加 candidate；factory 不需改 | 加 candidate + 调 enabled 即可 |

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| HN API 偶发 5xx 或网络抖动 | 单 SourceConfig 抓取失败 | BullMQ 默认 3 次指数退避 + status='FAILED' 写回；下次 repeatable 触发自动恢复 |
| HN 加 rate limit 后短期 429 | 抓取失败率上升 | 升级钩子覆盖（降并发 / lookahead）；prod 监控 logger 'HN ids fetch 429' |
| 'rss-crawl' obliterate 时有 in-flight job | 最多丢 3 次抓取 | 接受（下次 repeatable 1 分钟内补上）；prod 部署窗口选清晨低峰 |
| `interactionData` 重复 upsert 不更新 score/comments | 列表/详情页看到的是首抓时 score | spec §7.2 升级钩子记录；SP-6 热度计算时统一刷新 |
| SP-1 的 RSS integration spec 被通用化破坏 | CI red | 测试改造时**先跑现有 RSS spec**，确认通用化后行为不变；分两 commit：一通用化、二加 HN |
| `CrawlScheduler` 老队列 obliterate 与 worker 启动顺序 | 罕见竞态：worker 已订阅老队列时被 obliterate | obliterate 在 `OnModuleInit`，worker 在 `OnApplicationBootstrap`（晚于 init）—— Nest lifecycle 保证顺序无竞态 |
| HN top 500 IDs 全部并发 fetch 触发 OS file descriptor 上限 | dev 环境 ulimit 低时可能 EMFILE | p-limit(10) 已限并发；prod docker 默认 ulimit 充足；spec 已用并发限制 |
| seed.ts 用 findFirst+update/create 而非 upsert | 极小竞态（两个 seed 实例同跑）| seed 是部署后手动一次执行，不存在并发；可接受 |
| Worker stalled job（HN 抓取 > 30s）| BullMQ 默认认为 stalled，重新分发导致 2x | HN 全 ~900 items × 10 并发 ≈ 90s 整体；但单 job 内部异步进展，BullMQ 默认 stalled 检测看 worker 心跳而非任务时长，不会误杀。如确认问题可调 `lockDuration` |
| 老 'rss-crawl' 队列的 repeatable schedule 在 Redis 里残留 | 启动后 worker 不再消费但定时器仍存 | `obliterate({ force: true })` 会清除所有 repeatable scheduler key，覆盖 |

---

## 9. 完工 Checklist

```text
[ ] packages/utils 抽出 stripHtml + 单元测试通过
[ ] packages/utils export stripHtml 加进 index.ts
[ ] packages/types RawCrawledItem 加 interactionData?: Record<string, unknown> | null
[ ] apps/worker package.json 加 p-limit 依赖
[ ] apps/worker .env.example 加 HN_FETCH_TIMEOUT_MS / HN_CONCURRENCY
[ ] apps/worker queue.provider.ts CRAWL_QUEUE_NAME 改为 'crawl'
[ ] apps/worker crawler.factory.ts + spec 创建并通过
[ ] apps/worker crawlers/hackernews.types.ts 创建（HnStory）
[ ] apps/worker crawlers/hackernews.crawler.ts + spec 创建并通过
[ ] apps/worker crawlers/rss.crawler.ts 改用 @ai-hot-news/utils 的 stripHtml（删本地）
[ ] apps/worker crawlers/rss.crawler.spec.ts 复跑通过（行为无变化）
[ ] apps/worker crawl.module.ts 注册 CrawlerFactory + 注入到 worker factory
[ ] apps/worker crawl.processor.ts 用 factory 路由，platform 通用化
[ ] apps/worker crawl.scheduler.ts 加 obliterate 老队列 + platform IN 过滤 + jobId 重命名 + spec 通过
[ ] apps/worker ingestion.service.ts SourceLike 通用化、sourcePlatform 通用化、interactionData 透传
[ ] apps/worker ingestion.service.integration.spec.ts 加 HN case 通过
[ ] packages/db prisma/seed.ts 加 3 条 HN candidates + 幂等 findFirst+update/create
[ ] apps/web app/news/_components/news-item.tsx 加 PLATFORM_LABEL + PLATFORM_BADGE_CLASS
[ ] CI 全绿（lint / typecheck / build / test）
[ ] 本地 pnpm db:seed → 6 条 SourceConfig 入库（3 RSS + 3 HN）
[ ] 本地 pnpm dev → worker 日志含 "Old queue 'rss-crawl' obliterated"（首次）+ "Registered 6 enabled sources: 3 RSS, 3 HACKERNEWS"
[ ] 本地 pnpm dev → worker ~3 分钟内日志含 6 条 "* crawled: source=*" 正常（concurrency=1 串行）
[ ] curl localhost:3001/hot-news?pageSize=100 → 200 + RSS+HN 混合
[ ] open localhost:3000/news → 浏览器看到 HN 项有橙色 "HN" 徽标
[ ] 重启 worker 验证 obliterate 仍幂等（不抛错）+ jobId 不重复注册
[ ] 部署到 VPS 后跑 db:seed
[ ] curl https://<domain>/api/hot-news?pageSize=100 → 200 + items.sourcePlatform 含 RSS 与 HACKERNEWS
[ ] decomposition spec 第 6 节回写：SP-2 完成 + SP-4 范围加入 ArticleExtractor
```

---

## 10. 后续步骤

本 spec 经用户审阅批准后：

1. 调用 `writing-plans` skill，把本 spec 转化为 step-by-step 实施计划文档（`docs/superpowers/plans/2026-05-XX-sp2-hackernews-crawler-plan.md`）
2. 计划文档审阅通过后，进入 SP-2 实施
3. SP-2 完成（Checklist 全打勾）后：
   - **回写 decomposition spec 第 6 节**：标记 SP-2 完成 + 把 ArticleExtractor 加入 SP-4 范围（"内容清洗 + 多层去重 + 外链正文抽取"）
   - 启动 **SP-3（Reddit 抓取器）** 的 brainstorming（Phase 2 收尾）
