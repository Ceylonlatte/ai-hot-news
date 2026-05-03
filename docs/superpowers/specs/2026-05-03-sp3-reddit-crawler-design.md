# SP-3：Reddit 抓取器 设计

- **日期**：2026-05-03
- **状态**：Draft，待用户审阅
- **所属**：Phase 2 / SP-3（详见 `2026-05-01-ai-hot-news-decomposition-design.md` 第 6 节）
- **预计工作量**：~1 天
- **本文档定位**：单个子项目实现 spec，用户审阅通过后调用 `writing-plans` 生成 step-by-step 实施计划。

---

## 1. 目标、范围与验收标准

### 1.1 目标

在 SP-2 已抽象的 `Crawler` / `CrawlerFactory` / `CrawlScheduler` / `IngestionService` 基础设施上，新增 Reddit 数据源 —— 通过 Reddit OAuth Application-Only 授权，抓取 PRD §7.5.2 推荐的 8 个 AI 相关 subreddit 的 `hot` 列表，把帖子（包含 score / num_comments / upvote_ratio）入库到 `hot_news`。

新增的 `RedditOAuthClient` 是 SP-22（Twitter 抓取器）可直接复用的"OAuth token cache + 401 retry"模式资产。

**故意不做**：评论原文抓取（→ SP-5 AI 摘要时按需 enrich）；关键词/搜索接入（→ SP-14 KeywordMonitor）；按 `upvote_ratio` 阈值过滤（→ SP-4 内容清洗）；NSFW / 政治内容过滤（→ SP-4 / SP-5）；详情页"社区情绪"分数（→ SP-6 热度公式 / SP-11 详情页）。

### 1.2 In-scope

| 模块 | 内容 |
|---|---|
| `packages/db`（扩展） | `prisma/seed.ts` 新增 8 条 Reddit `SourceConfig`（按 PRD §7.5.2 推荐 subreddit），`crawlInterval=3600`（60 分钟）|
| `apps/worker`（扩展，最小改造） | 新增 `RedditCrawler`、`RedditOAuthClient`、`reddit.types.ts`；`CrawlerFactory.create()` 加 `case Platform.REDDIT`；`CrawlScheduler` 的 `platform.in [...]` 加 `Platform.REDDIT`；`CrawlModule` 注册 `RedditOAuthClient` 为 provider |
| `packages/types` | **不变**（SP-2 已加 `interactionData`） |
| `packages/utils` | **不变**（`stripHtml` SP-2 已抽出，SP-3 直接用） |
| `apps/api` | **无契约变化**（`GET /hot-news` 已 platform-agnostic） |
| `apps/web` | **无变化**（SP-2 时已把 Reddit 红色徽章 `bg-red-50 text-red-700` 加进 `PLATFORM_BADGE_CLASS`）|
| 环境变量 | 新增 `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` / `REDDIT_USER_AGENT`（默认 `ai-hot-news-bot/0.1 (by /u/<owner>)`）/ `REDDIT_FETCH_TIMEOUT_MS`（默认 15000）|
| 部署 | VPS `.env` 写入真实 Reddit OAuth credentials；`scripts/deploy.sh` **不变**（auto-seed 已就位，新加的 8 条 SourceConfig 自动生效）|
| 依赖 | **零新增**（Node 22 global `fetch`，无 Reddit SDK）|

### 1.3 Out-of-scope（明确不做）

- **评论原文抓取**：PRD §7.5.3 第 4 条 "支持评论区摘要" 是 SP-5 范围。SP-3 仅记录 `comments=post.num_comments`（计数），不抓 `comments/{id}.json`。理由见 §11 OAuth 配额预算。
- **关键词搜索 (`/r/<sub>/search.json?q=...`)**：→ SP-14 KeywordMonitor，作为另一种 source-type 接入。
- **`upvote_ratio < 0.5` 低质量帖过滤**：→ SP-4 内容清洗。SP-3 入库所有非 stickied / 非 NSFW 帖。
- **NSFW (`over_18=true`) 过滤之外的 mod/政治/娱乐过滤**：→ SP-4 / SP-5。SP-3 仅过滤 NSFW 和 mod 置顶（stickied）。
- **post 编辑后回写更新 score / num_comments / upvote_ratio**：→ SP-6 时统一独立 worker `refresh-interaction-data` 解决（与 SP-2 HN 一致策略）。
- **多 worker 实例 OAuth token 共享**：当前 prod 单 worker 容器，进程内 in-memory 缓存即可（详见 §5.3）。
- **subreddit 自动发现 / pack 分享**：单用户场景 YAGNI（clawfeed 的 source_packs 思路记进 decomposition spec 决策日志，作为未来 SP-24 后台管理 UX 参考，不在 SP-3 实现）。
- **`/r/<sub>/new` 或 `/top/day` 等其他 sort**：SP-3 统一 `hot`，与 PRD §7.5.2 推荐 + Reddit 自身热度算法对齐；其他 sort 留作 future identifier 扩展。
- **列表 UI 按 platform 过滤**：→ SP-10 FeedPage。
- **subreddit 热门帖外链正文抽取**：→ SP-4 ArticleExtractor（Reddit link-post 的 `externalUrl` 作为 SP-4 的检测哨兵之一，与 HN 共享同一处理路径）。

### 1.4 硬验收标准

```bash
# === 本地 dev 全流程（前提：已在 https://www.reddit.com/prefs/apps 注册 type=script app）===
# .env 已加入：
#   REDDIT_CLIENT_ID=xxx
#   REDDIT_CLIENT_SECRET=yyy
#   REDDIT_USER_AGENT=ai-hot-news-bot/0.1 (by /u/<your-username>)

pnpm install                                  # 0 错（无新增依赖）
pnpm docker:dev                               # pg + redis 起
pnpm db:migrate:deploy                        # noop（SP-3 无 schema 改动）
pnpm db:seed                                  # 写入 14 条 SourceConfig（3 RSS + 3 HN + 8 Reddit）
pnpm dev                                      # 三进程并行

# 等待 ~5-8 分钟（worker concurrency=1 串行处理 14 个 boot job：
#   3 × RSS + 3 × HN（30-60s 每条）+ 8 × Reddit（5-10s 每条，单 GET）≈ 总 5-8 分钟）
# Worker 日志期望包含：
#   "Registered 14 enabled sources: 3 RSS, 3 HACKERNEWS, 8 REDDIT"
#   "REDDIT crawled: source=r/LocalLLaMA fetched=25 inserted=A skipped=B failed=0"
#   ... 8 行 REDDIT crawled
#   首次 OAuth：1 条 "Reddit OAuth: refreshed token (expires in 86400s)"
#   后续 7 条 Reddit crawl 无新 token 请求（缓存复用）

# === API 验证 ===
curl 'localhost:3001/hot-news?pageSize=200' | jq '.items | group_by(.sourcePlatform) | map({plat: .[0].sourcePlatform, n: length})'
# 期望（实际数量随 hot 榜变化）:
#   [{"plat":"HACKERNEWS","n":>=20},{"plat":"REDDIT","n":>=20},{"plat":"RSS","n":>=10}]

# === 字段验证（interactionData 透传完整） ===
curl 'localhost:3001/hot-news?pageSize=5' \
  | jq '.items[] | select(.sourcePlatform == "REDDIT") | .interactionData' \
  | head -20
# 期望（每条至少含 6 个字段）:
#   {
#     "score": 1234,
#     "comments": 56,
#     "externalUrl": "https://github.com/some/repo" 或 null,
#     "redditId": "1k4xz9p",
#     "redditSubreddit": "LocalLLaMA",
#     "redditUpvoteRatio": 0.95
#   }

# === UI 验证 ===
open http://localhost:3000/news               # 浏览器看到混合列表，Reddit 项有红色 "Reddit" 徽标

# === Idempotency 验证 ===
# 重启 worker（Ctrl+C → pnpm dev）
# 第二次 boot 抓取后：
curl 'localhost:3001/hot-news?pageSize=1' | jq '.total'
# 期望：第二次启动后 total 增量 ≪ 第一次（hot 榜变化少，大部分 P2002 跳过）
# 期望日志含：8 行 "REDDIT crawled: ... skipped=>15"（25 - hot 榜变化数）

# === CI ===
# ci.yml 全绿（含新加 RedditOAuthClient + RedditCrawler 单元测试 + IngestionService Reddit case 集成测试）

# === 部署后（push 到 main 触发 deploy.yml）===
# 1. VPS .env 提前加入 REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET / REDDIT_USER_AGENT
# 2. deploy.sh 自动跑 prisma db seed → 14 条 SourceConfig 入库
# 3. deploy.sh 自动 restart worker → 8 个 Reddit boot job 在 5 分钟内完成
curl https://<domain>/api/hot-news?pageSize=200 | jq '.items | map(.sourcePlatform) | unique'
# 期望: ["HACKERNEWS", "REDDIT", "RSS"]
```

### 1.5 不会修改的内容

- 不动 SP-0 monorepo 结构、Docker Compose 拓扑、CI 矩阵
- 不动 Prisma schema（`Platform.REDDIT` enum 和 `interactionData Json?` 字段 SP-0 已有）
- 不改 API 契约（`GET /hot-news` 已 platform-agnostic）
- 不改 web `news-item.tsx`（SP-2 已加 Reddit 红色徽章）
- 不引入 shadcn/ui、TanStack Query、Zustand 等（→ SP-8 起）
- 不改 BullMQ 队列名（沿用 SP-2 的 `'crawl'`）
- 不改 `RawCrawledItem` 接口（SP-2 已加 `interactionData`）

---

## 2. 架构与数据流

### 2.1 数据流图（SP-3 完工形态，相对 SP-2 增量）

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                       Worker 进程 (NestJS standalone)                      │
│                                                                            │
│  Bootstrap (CrawlScheduler.onModuleInit) ── SP-2 已建立                   │
│   ├─ obliterate('rss-crawl') 老队列                                       │
│   ├─ findMany SourceConfig WHERE enabled=true                             │
│   │     AND platform IN (RSS, HACKERNEWS, REDDIT)  ← SP-3 加 REDDIT       │
│   ├─ 14 条 source 注册 BullMQ repeatable + boot                           │
│   │     queue('crawl').add(...)                                            │
│   └─ Logger: "Registered 14 enabled sources: 3 RSS, 3 HACKERNEWS, 8 REDDIT"│
│                                                                            │
│  CrawlProcessor.process(job) ── SP-2 已建立                                │
│   ├─ source = prisma.sourceConfig.findUnique(...)                          │
│   ├─ crawler = CrawlerFactory.create(source)                               │
│   │     switch source.platform                                             │
│   │       case 'RSS'        → new RssCrawler({id, url})                    │
│   │       case 'HACKERNEWS' → new HackerNewsCrawler({id, identifier})      │
│   │       case 'REDDIT'     → new RedditCrawler({id, identifier},          │
│   │                              this.oauthClient)        ← SP-3 新增      │
│   ├─ items = await crawler.fetch()                                         │
│   └─ ingestion.ingest(items, source) → 透传 interactionData                │
│                                                                            │
│  RedditCrawler.fetch()                                            ← 新增   │
│   ├─ subreddit = source.identifier  // 'LocalLLaMA' / 'OpenAI' / ...       │
│   ├─ url = `https://oauth.reddit.com/r/${subreddit}/hot?limit=25`          │
│   ├─ res = await this.oauth.fetch(url)                                     │
│   │     OAuthClient 处理 token cache + 401 自动 refresh + 一次 retry       │
│   ├─ posts = res.data.children.map(c => c.data)  // 25 RedditPost          │
│   ├─ filter !post.stickied && !post.over_18 && post.title (isValidPost)    │
│   └─ map → RawCrawledItem[]                                                │
│         link-post: contentText=title, rawHtml=null,                        │
│                    interactionData.externalUrl=post.url                    │
│         self-post: contentText=stripHtml(post.selftext_html),              │
│                    rawHtml=post.selftext_html,                             │
│                    interactionData.externalUrl=null                        │
│         interactionData 字段:                                              │
│           { score, comments, externalUrl,                                  │
│             redditId, redditSubreddit, redditUpvoteRatio }                 │
│                                                                            │
│  RedditOAuthClient（单例 provider）                              ← 新增    │
│   ├─ private token: { value, expiresAt } | null = null                     │
│   ├─ fetch(url, init?):                                                    │
│   │     ├─ token = await getToken()  // cache hit OR refreshToken()       │
│   │     ├─ res = doFetch(url, token)                                       │
│   │     ├─ if res.status === 401 (token revoked):                          │
│   │     │     this.token = null                                            │
│   │     │     token = await getToken()                                     │
│   │     │     res = doFetch(url, token)                                    │
│   │     └─ return res                                                      │
│   ├─ private getToken(): cache 内 → 复用；过期/null → refreshToken()     │
│   └─ private refreshToken():                                               │
│         POST https://www.reddit.com/api/v1/access_token                    │
│           Authorization: Basic base64(client_id:secret)                    │
│           grant_type=client_credentials                                    │
│         res.access_token, res.expires_in (默认 86400s = 24h)              │
└────────────────────────────────────────────────────────────────────────────┘
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
              │ apps/api: GET /hot-news (无变更)      │
              │ apps/web: /news (无变更)              │
              └───────────────────────────────────────┘
```

### 2.2 模块边界与职责（增量列出，不重述 SP-2 已有）

| 单元 | 输入 | 输出 | 依赖 | 备注 |
|---|---|---|---|---|
| `RedditOAuthClient`（worker 新增） | `clientId / clientSecret / userAgent` | `fetch(url, init?): Promise<Response>` | global `fetch`、`Logger` | 单例（CrawlModule provider）；in-memory token cache + 401 retry |
| `RedditCrawler`（worker 新增） | `{ id, identifier: subreddit-name }` + `RedditOAuthClient` 引用 | `Promise<RawCrawledItem[]>` | `RedditOAuthClient`、`stripHtml`、`reddit.types` | 实现 `Crawler` 接口；通过 oauth client fetch 单个 `/r/<sub>/hot.json` |
| `CrawlerFactory`（worker 改造） | `SourceConfig` | `Crawler` | `RssCrawler`、`HackerNewsCrawler`、`RedditCrawler` + `RedditOAuthClient` | 加 `case Platform.REDDIT`；factory 构造函数注入 `RedditOAuthClient`，传给 `RedditCrawler` |
| `CrawlScheduler`（worker 微调） | — | repeatable + boot enqueue | Queue、Prisma | `platform.in [...]` 加 `Platform.REDDIT` |
| `CrawlModule`（worker 微调） | — | DI 容器 | `RedditOAuthClient` 注册为 `@Injectable()` provider | `CrawlerFactory.create()` 路由到 `RedditCrawler` 时注入 |

### 2.3 关键接口签名（变化）

```ts
// apps/worker/src/crawl/crawlers/reddit-oauth.client.ts —— 新增
@Injectable()
export class RedditOAuthClient {
  constructor(
    @Inject(REDDIT_CLIENT_ID) private readonly clientId: string,
    @Inject(REDDIT_CLIENT_SECRET) private readonly clientSecret: string,
    @Inject(REDDIT_USER_AGENT) private readonly userAgent: string,
  ) {}

  /** 自动续 token + 401 一次重试。所有 RedditCrawler 的 fetch 走这个。 */
  async fetch(url: string, init?: RequestInit): Promise<Response>;

  // 内部：缓存 / 续 token / 实际 GET
  private async getToken(): Promise<string>;
  private async refreshToken(): Promise<void>;
  private async doFetch(url: string, token: string, init?: RequestInit): Promise<Response>;
}

// apps/worker/src/crawl/crawlers/reddit.crawler.ts —— 新增
interface RedditSource {
  id: string;
  identifier: string | null;  // subreddit name, e.g. "LocalLLaMA"
}

export class RedditCrawler implements Crawler {
  constructor(
    private readonly source: RedditSource,
    private readonly oauth: RedditOAuthClient,
  ) {}

  async fetch(): Promise<RawCrawledItem[]>;
}

// apps/worker/src/crawl/crawler.factory.ts —— 改造
export interface CrawlerSource {
  id: string;
  platform: Platform;
  url: string | null;
  identifier: string | null;
}

@Injectable()
export class CrawlerFactory {
  // 改造：构造函数注入 RedditOAuthClient
  constructor(private readonly redditOauth: RedditOAuthClient) {}

  create(source: CrawlerSource): Crawler {
    switch (source.platform) {
      case Platform.RSS:
        return new RssCrawler({ id: source.id, url: source.url });
      case Platform.HACKERNEWS:
        return new HackerNewsCrawler({ id: source.id, identifier: source.identifier });
      case Platform.REDDIT:
        return new RedditCrawler({ id: source.id, identifier: source.identifier }, this.redditOauth);
      default:
        throw new Error(`Unsupported crawler platform: ${source.platform}`);
    }
  }
}
```

### 2.4 配置与环境变量

| 变量 | 谁用 | 默认 | SP-3 变化 |
|---|---|---|---|
| `DATABASE_URL` / `REDIS_URL` | api / worker | SP-0 | 不变 |
| `RSS_USER_AGENT` | RSS / HN crawler | `ai-hot-news-bot/0.1` | 不变（Reddit 走独立 `REDDIT_USER_AGENT`，因为 Reddit 要求 UA 含联系人 `(by /u/<username>)`）|
| `RSS_FETCH_TIMEOUT_MS` / `HN_FETCH_TIMEOUT_MS` / `HN_CONCURRENCY` | RSS / HN | SP-1 / SP-2 | 不变 |
| `REDDIT_CLIENT_ID` | RedditOAuthClient | — | **新增**，必填，从 https://www.reddit.com/prefs/apps 获取 |
| `REDDIT_CLIENT_SECRET` | RedditOAuthClient | — | **新增**，必填，同上 |
| `REDDIT_USER_AGENT` | RedditOAuthClient + RedditCrawler | `ai-hot-news-bot/0.1 (by /u/anonymous)` | **新增**，**Reddit 要求 UA 唯一且含联系人**，prod 应填真实 username |
| `REDDIT_FETCH_TIMEOUT_MS` | RedditCrawler | `15000` | **新增** |

新增变量加进 `apps/worker/.env.example`：

```
# Reddit
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USER_AGENT=ai-hot-news-bot/0.1 (by /u/anonymous)
REDDIT_FETCH_TIMEOUT_MS=15000
```

> **Reddit UA 政策**：Reddit API ToS 要求 UA 不能伪装浏览器、必须唯一标识应用、推荐含联系方式。`ai-hot-news-bot/0.1 (by /u/<owner-username>)` 格式符合规范。prod 部署时把 `<owner-username>` 替换为账号持有人的 Reddit 用户名（不是必须真实存在的账号，但建议是 owner 的 reddit handle 便于 Reddit team 联系）。

> **DI 注入选择**：`REDDIT_CLIENT_ID` 等通过 `@Inject(REDDIT_CLIENT_ID)` token 注入而非直接 `process.env.REDDIT_CLIENT_ID`，便于测试 mock 和未来切换 ConfigService。`CrawlModule` 注册 valueProvider 把 env → token：
> ```ts
> { provide: REDDIT_CLIENT_ID, useFactory: () => process.env.REDDIT_CLIENT_ID ?? '' },
> { provide: REDDIT_CLIENT_SECRET, useFactory: () => process.env.REDDIT_CLIENT_SECRET ?? '' },
> { provide: REDDIT_USER_AGENT, useFactory: () => process.env.REDDIT_USER_AGENT ?? 'ai-hot-news-bot/0.1 (by /u/anonymous)' },
> ```

---

## 3. Worker 详细设计

### 3.1 文件结构变化

```text
apps/worker/
├── src/
│   ├── worker.module.ts                          # 不变
│   └── crawl/
│       ├── crawl.module.ts                       # 修改：注册 RedditOAuthClient + 3 个 env value providers
│       ├── crawl.processor.ts                    # 不变
│       ├── crawl.scheduler.ts                    # 修改：platform.in [...] 加 REDDIT
│       ├── crawl.scheduler.spec.ts               # 修改：assertion 加 REDDIT 计数
│       ├── crawler.factory.ts                    # 修改：构造函数注入 RedditOAuthClient + 加 case REDDIT
│       ├── crawler.factory.spec.ts               # 修改：加 REDDIT 路由测试
│       ├── ingestion.service.ts                  # 不变（SP-2 已通用化）
│       ├── ingestion.service.integration.spec.ts # 修改：加 REDDIT case
│       ├── crawlers/
│       │   ├── crawler.interface.ts              # 不变
│       │   ├── rss.crawler.ts                    # 不变
│       │   ├── rss.crawler.spec.ts               # 不变
│       │   ├── hackernews.crawler.ts             # 不变
│       │   ├── hackernews.crawler.spec.ts        # 不变
│       │   ├── hackernews.types.ts               # 不变
│       │   ├── reddit.crawler.ts                 # 新增
│       │   ├── reddit.crawler.spec.ts            # 新增
│       │   ├── reddit.types.ts                   # 新增（RedditPost / RedditListingResponse 接口）
│       │   ├── reddit-oauth.client.ts            # 新增
│       │   └── reddit-oauth.client.spec.ts       # 新增
│       └── fixtures/
│           ├── (existing rss/hn fixtures)        # 不变
│           ├── reddit-hot-listing.json           # 新增（mock /r/<sub>/hot.json 标准 listing 响应，含 5 条混合 post）
│           ├── reddit-self-post.json             # 新增（is_self=true，含 selftext_html）
│           ├── reddit-link-post.json             # 新增（is_self=false，含 url 外链）
│           ├── reddit-stickied-post.json         # 新增（stickied=true，应被过滤）
│           ├── reddit-nsfw-post.json             # 新增（over_18=true，应被过滤）
│           └── reddit-oauth-token.json           # 新增（mock POST /api/v1/access_token 响应）
└── package.json                                  # 不变（无新依赖）
```

```text
packages/db/prisma/
└── seed.ts                                       # 修改：加 8 条 Reddit candidates + seedReddit() + main() 调用
```

### 3.2 RedditOAuthClient 详细实现

```ts
// apps/worker/src/crawl/crawlers/reddit-oauth.client.ts
import { Inject, Injectable, Logger } from '@nestjs/common';

export const REDDIT_CLIENT_ID = Symbol('REDDIT_CLIENT_ID');
export const REDDIT_CLIENT_SECRET = Symbol('REDDIT_CLIENT_SECRET');
export const REDDIT_USER_AGENT = Symbol('REDDIT_USER_AGENT');

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';

interface CachedToken {
  value: string;
  expiresAt: number; // unix ms
}

interface TokenResponse {
  access_token: string;
  token_type: 'bearer';
  expires_in: number; // seconds，默认 86400 = 24h
  scope: string;
}

@Injectable()
export class RedditOAuthClient {
  private readonly logger = new Logger(RedditOAuthClient.name);
  private token: CachedToken | null = null;

  constructor(
    @Inject(REDDIT_CLIENT_ID) private readonly clientId: string,
    @Inject(REDDIT_CLIENT_SECRET) private readonly clientSecret: string,
    @Inject(REDDIT_USER_AGENT) private readonly userAgent: string,
  ) {}

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    let token = await this.getToken();
    let res = await this.doFetch(url, token, init);
    if (res.status === 401) {
      this.logger.warn(`Reddit OAuth: 401 received, clearing cached token and retrying`);
      this.token = null;
      token = await this.getToken();
      res = await this.doFetch(url, token, init);
    }
    return res;
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      // 提前 60s 续期，避免请求中途过期
      return this.token.value;
    }
    await this.refreshToken();
    if (!this.token) {
      throw new Error('Reddit OAuth: token refresh succeeded but cache empty');
    }
    return this.token.value;
  }

  private async refreshToken(): Promise<void> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'Reddit OAuth: REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be set',
      );
    }
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(this.timeoutMs()),
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'User-Agent': this.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      throw new Error(
        `Reddit OAuth: token refresh failed ${res.status} ${res.statusText}`,
      );
    }
    const data = (await res.json()) as TokenResponse;
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    this.logger.log(
      `Reddit OAuth: refreshed token (expires in ${data.expires_in}s)`,
    );
  }

  private async doFetch(
    url: string,
    token: string,
    init?: RequestInit,
  ): Promise<Response> {
    return fetch(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(this.timeoutMs()),
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        'Authorization': `Bearer ${token}`,
        'User-Agent': this.userAgent,
      },
    });
  }

  private timeoutMs(): number {
    const raw = parseInt(process.env.REDDIT_FETCH_TIMEOUT_MS ?? '15000', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 15000;
  }
}
```

> **设计要点**：
> 1. **构造函数注入 string** 而非读 `process.env`：单元测试可直接 `new RedditOAuthClient('test-id', 'test-secret', 'test-ua')`，无需 mock global env。
> 2. **token cache 提前 60s 续期**：避免 fetch 发出后 token 在飞行中过期。Reddit token 默认 24h 有效，60s 缓冲完全够。
> 3. **401 仅一次重试**：避免 credentials 永久失效时无限循环。第二次仍 401 → throw → BullMQ 自然重试。
> 4. **`timeoutMs()` 走 method 而非构造时读**：与 `HackerNewsCrawler` 风格保持一致；env 改了之后下次抓取就生效，无需 worker 重启。

### 3.3 RedditCrawler 详细实现

```ts
// apps/worker/src/crawl/crawlers/reddit.crawler.ts
import { stripHtml } from '@ai-hot-news/utils';
import type { RawCrawledItem } from '@ai-hot-news/types';
import type { Crawler } from './crawler.interface';
import type { RedditOAuthClient } from './reddit-oauth.client';
import type { RedditListingResponse, RedditPost } from './reddit.types';

const REDDIT_BASE = 'https://oauth.reddit.com';
const HOT_LIMIT = 25;

interface RedditSource {
  id: string;
  identifier: string | null;
}

export class RedditCrawler implements Crawler {
  constructor(
    private readonly source: RedditSource,
    private readonly oauth: RedditOAuthClient,
  ) {}

  async fetch(): Promise<RawCrawledItem[]> {
    const subreddit = this.source.identifier;
    if (!subreddit) {
      throw new Error(
        `Reddit SourceConfig ${this.source.id} missing identifier (subreddit name)`,
      );
    }
    const url = `${REDDIT_BASE}/r/${subreddit}/hot?limit=${HOT_LIMIT}&raw_json=1`;
    const res = await this.oauth.fetch(url);
    if (!res.ok) {
      throw new Error(
        `Reddit fetch ${res.status} ${res.statusText} for r/${subreddit}`,
      );
    }
    const data = (await res.json()) as RedditListingResponse;
    if (data?.kind !== 'Listing' || !Array.isArray(data?.data?.children)) {
      throw new Error(
        `Reddit r/${subreddit} response not a Listing: ${JSON.stringify(data).slice(0, 100)}`,
      );
    }
    const posts = data.data.children
      .map((c) => c.data)
      .filter(this.isValidPost);
    return posts.map((p) => this.toRaw(p, subreddit));
  }

  private isValidPost = (p: RedditPost): boolean => {
    if (!p) return false;
    if (p.stickied) return false;       // mod 置顶
    if (p.over_18) return false;        // NSFW
    if (!p.title) return false;
    if (!p.id) return false;
    return true;
  };

  private toRaw(p: RedditPost, subreddit: string): RawCrawledItem {
    const isSelfPost = !!p.is_self;
    const selftextHtml = (p.selftext_html ?? '').trim();
    return {
      title: p.title,
      contentText: isSelfPost ? stripHtml(selftextHtml || p.title) : p.title,
      rawHtml: isSelfPost && selftextHtml ? selftextHtml : null,
      sourceUrl: `https://www.reddit.com/r/${subreddit}/comments/${p.id}/`,
      author: p.author && p.author !== '[deleted]' ? p.author : null,
      publishedAt: p.created_utc ? new Date(p.created_utc * 1000) : null,
      interactionData: {
        score: p.score ?? 0,
        comments: p.num_comments ?? 0,
        externalUrl: isSelfPost ? null : (p.url ?? null),
        redditId: p.id,
        redditSubreddit: subreddit,
        redditUpvoteRatio: p.upvote_ratio ?? null,
      },
    };
  }
}
```

```ts
// apps/worker/src/crawl/crawlers/reddit.types.ts
export interface RedditListingResponse {
  kind: 'Listing';
  data: {
    after: string | null;
    before: string | null;
    children: Array<{ kind: 't3'; data: RedditPost }>;
  };
}

export interface RedditPost {
  id: string;                    // e.g. "1k4xz9p"
  title: string;
  author: string | null;         // "[deleted]" 时归一化为 null
  subreddit: string;             // e.g. "LocalLLaMA"
  url: string | null;            // 外链帖的 url；自帖为 reddit permalink
  permalink: string;             // 总是 "/r/<sub>/comments/<id>/<slug>/"
  is_self: boolean;
  selftext: string | null;       // markdown 原文（自帖）
  selftext_html: string | null;  // 渲染后 HTML（自帖）
  created_utc: number;           // unix seconds
  score: number;
  ups: number;
  downs: number;
  num_comments: number;
  upvote_ratio: number;          // 0..1
  stickied: boolean;
  over_18: boolean;
  // 还有许多字段，按需扩展；spec 仅列 SP-3 用到的
}
```

> **设计要点**：
> 1. **`?raw_json=1`**：Reddit 默认会把响应里的 `<` `>` `&` 转义为 HTML entity（`&lt;`），加这个参数关闭转义，让 `selftext_html` 直接可用。
> 2. **`sourceUrl` 用 reddit permalink 而非 `post.url`**：与 SP-2 HN 的设计对齐 —— 同一外链可能在多个 subreddit 出现，外链作为 `interactionData.externalUrl` 字段保留，但 `sourceUrl`（去重锚点）是 reddit 自身的稳定 permalink。
> 3. **`author='[deleted]'` 归一化为 null**：Reddit 把已删用户的 author 字段填字符串 `"[deleted]"`，不是真 author，归一化避免污染查询。
> 4. **不抓 `selftext`（markdown 原文）**：只抓 `selftext_html`，因为 SP-2 HN 也是存 HTML，保持一致；后续 SP-5 摘要 / SP-4 清洗都从 HTML 走 stripHtml。
> 5. **`upvote_ratio` 可能为 null**：极冷帖（投票数 < 3）Reddit 不计算 ratio，设为 `null` 透传；SP-6 热度公式消费时要 nullable handling。

### 3.4 CrawlerFactory 改造

```ts
// apps/worker/src/crawl/crawler.factory.ts —— 改造后
import { Injectable } from '@nestjs/common';
import { Platform } from '@ai-hot-news/db';
import type { Crawler } from './crawlers/crawler.interface';
import { RssCrawler } from './crawlers/rss.crawler';
import { HackerNewsCrawler } from './crawlers/hackernews.crawler';
import { RedditCrawler } from './crawlers/reddit.crawler';
import { RedditOAuthClient } from './crawlers/reddit-oauth.client';

export interface CrawlerSource {
  id: string;
  platform: Platform;
  url: string | null;
  identifier: string | null;
}

@Injectable()
export class CrawlerFactory {
  constructor(private readonly redditOauth: RedditOAuthClient) {}

  create(source: CrawlerSource): Crawler {
    switch (source.platform) {
      case Platform.RSS:
        return new RssCrawler({ id: source.id, url: source.url });
      case Platform.HACKERNEWS:
        return new HackerNewsCrawler({ id: source.id, identifier: source.identifier });
      case Platform.REDDIT:
        return new RedditCrawler(
          { id: source.id, identifier: source.identifier },
          this.redditOauth,
        );
      default:
        throw new Error(`Unsupported crawler platform: ${source.platform}`);
    }
  }
}
```

### 3.5 CrawlScheduler 改造（极小）

```ts
// apps/worker/src/crawl/crawl.scheduler.ts —— 仅一处改动
const sources = await getPrisma().sourceConfig.findMany({
  where: {
    enabled: true,
    platform: { in: [Platform.RSS, Platform.HACKERNEWS, Platform.REDDIT] },
  },
});
```

> 其他逻辑（obliterate 老队列、repeatable + boot enqueue、按 platform 分组日志）SP-2 已建立，SP-3 不动。

### 3.6 CrawlModule 改造

```ts
// apps/worker/src/crawl/crawl.module.ts —— 增量
import { RedditOAuthClient, REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT } from './crawlers/reddit-oauth.client';

@Module({
  providers: [
    redisProvider,
    queueProvider,
    {
      provide: CRAWL_WORKER,
      useFactory: (...): Worker => { /* 不变 */ },
      inject: [REDIS_CONNECTION, IngestionService, CrawlerFactory],
    },
    IngestionService,
    CrawlerFactory,
    CrawlScheduler,
    // === SP-3 新增 ===
    RedditOAuthClient,
    {
      provide: REDDIT_CLIENT_ID,
      useFactory: () => process.env.REDDIT_CLIENT_ID ?? '',
    },
    {
      provide: REDDIT_CLIENT_SECRET,
      useFactory: () => process.env.REDDIT_CLIENT_SECRET ?? '',
    },
    {
      provide: REDDIT_USER_AGENT,
      useFactory: () => process.env.REDDIT_USER_AGENT ?? 'ai-hot-news-bot/0.1 (by /u/anonymous)',
    },
  ],
  exports: [IngestionService],
})
export class CrawlModule { /* 其余不变 */ }
```

---

## 4. 数据模型映射

### 4.1 HotNews 字段填充规则（Reddit）

| 字段 | link-post (`is_self=false`) | self-post (`is_self=true`) |
|---|---|---|
| `sourcePlatform` | `REDDIT` | `REDDIT` |
| `sourceUrl` | `https://www.reddit.com/r/{sub}/comments/{id}/`（permanent unique） | 同 |
| `title` | `post.title` | `post.title` |
| `content` | `post.title`（重复，**作为 SP-4 ArticleExtractor 检测哨兵之一**）| `stripHtml(post.selftext_html)` |
| `rawHtml` | `null`（**作为 SP-4 检测哨兵之二**）| `post.selftext_html` (HTML) |
| `author` | `post.author`（`"[deleted]"` 归一化为 null） | 同 |
| `publishedAt` | `new Date(post.created_utc * 1000)` | 同 |
| `dedupeHash` | `computeDedupeHash(sourceUrl, title)` | 同 |
| `interactionData` | `{ score, comments, externalUrl: post.url, redditId, redditSubreddit, redditUpvoteRatio }` | `{ score, comments, externalUrl: null, redditId, redditSubreddit, redditUpvoteRatio }` |
| `summary` / `aiTags` / `embedding` / `groupId` / `heatScore` | null / 默认值（→ SP-5/6/7） | 同 |

**与 SP-2 HN 的检测哨兵完全对称** —— SP-4 ArticleExtractor 一段 SQL 就能同时识别 HN + Reddit 的 link-post 待提取条目：

```sql
SELECT id, source_url, interaction_data->>'externalUrl' AS external_url
FROM hot_news
WHERE source_platform IN ('HACKERNEWS', 'REDDIT')
  AND raw_html IS NULL
  AND interaction_data->>'externalUrl' IS NOT NULL
  AND interaction_data->>'externalUrl' != ''
LIMIT 100;
```

### 4.2 interactionData 字段约定（SP-2 spec §4.2 落地 reddit 部分）

更新 `2026-05-03-sp2-hackernews-crawler-design.md` §4.2 表格的"Reddit 预留"行（落地后从"预留"改"实施"）：

| 字段 | 类型 | 含义 | 来源 |
|---|---|---|---|
| **通用字段（platform-agnostic）** | | | |
| `score` | number | HN: score / Reddit: score / Twitter: likes | 抓取层映射 |
| `comments` | number | HN: descendants / Reddit: num_comments / Twitter: replies | 抓取层映射 |
| `externalUrl` | string \| null | link-post 外链 | 抓取层映射 |
| **HN 专属（前缀 `hn`）** | | | |
| `hnId` | number | HN item id | HackerNewsCrawler |
| **Reddit 专属（前缀 `reddit`）** ← SP-3 落地 | | | |
| `redditId` | string | Reddit post id（不带 `t3_` 前缀，e.g. `"1k4xz9p"`）| RedditCrawler |
| `redditSubreddit` | string | subreddit 名（不带 `r/` 前缀，e.g. `"LocalLLaMA"`）| RedditCrawler |
| `redditUpvoteRatio` | number \| null | 0..1，社区情绪指标；冷帖 (<3 votes) 时 Reddit 不返回，记 `null` | RedditCrawler |
| **Twitter 预留（前缀 `tw`，→ SP-22）** | | | |
| `twTweetId` / `twReposts` | — | — | TwitterCrawler |

**约定原则**（不变）：
- 通用字段（`score` / `comments` / `externalUrl`）所有 platform 必填或 `null`
- platform 专属字段加 platform 前缀，避免命名冲突
- **不存** `redditPermalink`：等价于 `sourceUrl`，重复无意义
- **不存** `redditUps` / `redditDowns`：Reddit 自 2014 年起这两个字段是 fuzz 后的假数，`score` 才是真值

### 4.3 SourceConfig seed 数据（Reddit 8 条新增）

```ts
// packages/db/prisma/seed.ts —— candidates 数组追加 + seedReddit() + main() 调用

interface RedditCandidate {
  name: string;            // 显示名，如 "r/LocalLLaMA"
  identifier: string;      // subreddit 名，如 "LocalLLaMA"
  enabled: boolean;
  crawlInterval: number;   // 秒
}

const redditCandidates: RedditCandidate[] = [
  { name: 'r/LocalLLaMA',       identifier: 'LocalLLaMA',       enabled: true, crawlInterval: 3600 },
  { name: 'r/MachineLearning',  identifier: 'MachineLearning',  enabled: true, crawlInterval: 3600 },
  { name: 'r/artificial',       identifier: 'artificial',       enabled: true, crawlInterval: 3600 },
  { name: 'r/OpenAI',           identifier: 'OpenAI',           enabled: true, crawlInterval: 3600 },
  { name: 'r/ChatGPT',          identifier: 'ChatGPT',          enabled: true, crawlInterval: 3600 },
  { name: 'r/singularity',      identifier: 'singularity',      enabled: true, crawlInterval: 3600 },
  { name: 'r/StableDiffusion',  identifier: 'StableDiffusion',  enabled: true, crawlInterval: 3600 },
  { name: 'r/ClaudeAI',         identifier: 'ClaudeAI',         enabled: true, crawlInterval: 3600 },
];

async function seedReddit() {
  for (const c of redditCandidates) {
    // 复用 SP-2 HN 的 findFirst+update/create 模式（identifier 是 nullable，无法做复合 unique）
    const existing = await prisma.sourceConfig.findFirst({
      where: { platform: 'REDDIT', identifier: c.identifier },
    });
    if (existing) {
      await prisma.sourceConfig.update({
        where: { id: existing.id },
        data: {
          name: c.name,
          crawlInterval: c.crawlInterval,
          // 不覆盖 enabled / status，便于运维手工 disable 噪音 sub
        },
      });
    } else {
      await prisma.sourceConfig.create({
        data: {
          platform: 'REDDIT',
          name: c.name,
          url: null,
          identifier: c.identifier,
          enabled: c.enabled,
          crawlInterval: c.crawlInterval,
        },
      });
    }
    console.log(`seeded Reddit: ${c.name} (identifier=${c.identifier}, enabled=${c.enabled})`);
  }
}

async function main() {
  await seedRss();
  await seedHn();
  await seedReddit();   // ← SP-3 加这一行
}
```

> **完全幂等**：第二次跑 seed 不会创建重复行，也不会覆盖你手工 disable 的 subreddit。如果未来发现某 sub 噪音太大想 disable，直接 SQL `UPDATE source_configs SET enabled=false WHERE identifier='ChatGPT'`，下次 deploy seed 不会被覆盖。

> **PRD §7.5.2 8 个 sub 全开**：用户决策点（详见 brainstorming 记录）。如果实施后发现某 sub 实际信号差，按"运维手工 disable"流程关掉，不需要改代码。

---

## 5. 设计决策与可选方案

### 5.1 OAuth 方式：Application-Only（已选）vs 公开 .json vs RSS

| 方案 | 决策 | 理由 |
|---|---|---|
| **A. 公开 `.json` 端点**（无 auth） | ❌ 拒绝 | Reddit 2023-06 起对无凭证爬虫风控严格，VPS IP 一旦被封会让所有 8 sub 同时静默失败；且无凭证上限 ~10 req/min/IP，远小于 OAuth 的 100/min |
| **B. OAuth Application-Only（client_credentials）** | ✅ 已选 | 5 分钟注册 type=script app，拿 client_id/secret 即可；100 req/min/client，本项目 8 sub × 1 GET/h = 8 req/h 远低于限额；token 24h 有效 |
| **C. Reddit `.rss`** | ❌ 拒绝 | 拿不到 score / num_comments / upvote_ratio，PRD §7.5.3 明说要"支持社区情绪判断"，丢了核心数据 |

### 5.2 抓取模式：每 sub 独立 SourceConfig（已选）vs 单 SourceConfig 多 sub

| 方案 | 决策 | 理由 |
|---|---|---|
| **A. 每 sub 一条 SourceConfig** | ✅ 已选 | 与 SP-2 HN（top/ask/show 三条）模式一致；可独立 disable / 调 crawlInterval；运维灵活 |
| **B. 单 SourceConfig (`identifier='multi'`) 内部循环 8 sub** | ❌ 拒绝 | 失败粒度坏（一个 sub 失败拖累整批）；状态字段（`lastCrawledAt` / `errorCount`）失效；与 HN 模式不一致 |

### 5.3 OAuth Token 缓存：进程内 in-memory（已选）vs Redis 共享 vs 不缓存

| 方案 | 决策 | 理由 |
|---|---|---|
| **A. 进程内 in-memory 单例** | ✅ 已选 | 当前 prod 单 worker 容器（无 replicas），无多实例 race；Redis 共享是过度工程；token 24h 有效，单进程一天 1 次 refresh 即可 |
| **B. Redis 共享 token cache** | ❌ 拒绝 | 当前用例下增加 Redis dep + 引入 race（两实例同时 401 → 同时 refresh，浪费 1 次但无副作用）；当 SP-22 / 流量真上来要多 worker 时再升 |
| **C. 不缓存（每次 fetch 前 refresh）** | ❌ 拒绝 | 8 个 GET/轮 → 8 次 token 请求，浪费且容易撞限速 |

> **未来升级钩子**：当 worker 扩到 ≥2 replicas 时，把 in-memory cache 替换为 Redis 共享（key=`reddit:oauth:token`），仅改 `RedditOAuthClient` 内部，其他代码不动。spec §7 记录此钩子。

### 5.4 评论抓取：不抓（已选）vs 全抓 vs top 3

| 方案 | 决策 | 理由 |
|---|---|---|
| **A. 不抓评论原文，仅记 `comments` 计数** | ✅ 已选 | OAuth 配额预算友好（8 req/h vs 200 req/h）；评论原文真实消费者是 SP-5 AI 摘要，到时候独立 worker `enrich-reddit-comments` 按"高热度帖"按需抓更经济 |
| **B. SP-3 抓所有评论原文存 `interactionData.comments[]`** | ❌ 拒绝 | 8 sub × 25 帖 × 1 GET = 200 req/h，逼近 100/min 限速并占用宝贵配额；存储成本剧增（每帖 ~50 KB JSON × 200 帖/h × 24 h ≈ 240 MB/天）；且 SP-3 完工时还没人消费这些数据 |
| **C. 仅抓 top 3 热评拼进 `interactionData.topComments`** | ❌ 拒绝 | 仍要 200 req/h；增加 SP-3 复杂度但收益模糊（SP-5 还得自己再决定抓多少） |

### 5.5 抓取频率：60 分钟（已选）vs 30 vs 15 vs 异构

| 方案 | 决策 | 理由 |
|---|---|---|
| **A. 60 分钟（3600s）** | ✅ 已选 | Reddit 帖子半衰期普遍 ≥6h（远长于 HN 的 ~2h），60 分钟数据延迟可接受；与 HN 30 分钟错开抓取节奏；hot_news 增长率温和（8 sub × 25 帖 × 0.3 新增比例 / h ≈ 60 行/h ≈ 1500 行/天）|
| **B. 30 分钟（1800s）** | ❌ 拒绝 | 节奏跟 HN 重叠不必要；hot_news 增长翻倍但实际新数据少（多次抓到的大部分帖子被 P2002 跳过，只增加 db 写入压力）|
| **C. 15 分钟（900s）** | ❌ 拒绝 | OAuth 配额绰绰有余但 hot_news 增长压力大；刚被 prod 磁盘满教训过一次，节奏保守为先 |
| **D. 异构（高质量 sub 30 分、噪音 sub 60 分）** | ❌ 拒绝 | 增加 spec / seed 复杂度；初期统一 60 分钟，监控一段时间看实际信号差异再决定；运维可手工 SQL 调单条 `crawlInterval` |

### 5.6 fetch limit：25（已选）vs 50 vs 100 vs env

| 方案 | 决策 | 理由 |
|---|---|---|
| **A. 固定 25**（Reddit 默认）| ✅ 已选 | hot 榜半小时内变化 ≤10 条，25 覆盖率充分；与 SP-2 HN 的"全量 ~500"不同，因为 Reddit 单 GET 已包含完整 post 对象，无 N+1，25 → 50 的成本/收益比差 |
| **B. 50** | ❌ 拒绝 | 1 次响应翻倍，但实际新数据增量极小，db 写入压力翻倍 |
| **C. 100**（Reddit 上限）| ❌ 拒绝 | 同上，过度抓取 |
| **D. env 可调** | ❌ 拒绝 | YAGNI；如果实测 25 不够再升 |

---

## 6. Web、API、部署影响

### 6.1 Web `/news`

**完全无变化**。SP-2 时已经把 Reddit 红色徽章加进 `PLATFORM_BADGE_CLASS`：

```tsx
// apps/web/app/news/_components/news-item.tsx —— SP-2 已有
const PLATFORM_BADGE_CLASS: Record<string, string> = {
  RSS:        'bg-blue-50 text-blue-700',
  HACKERNEWS: 'bg-orange-50 text-orange-700',
  REDDIT:     'bg-red-50 text-red-700',   // ← SP-2 时已就位，SP-3 直接生效
  TWITTER:    'bg-gray-100 text-gray-700',
};
```

SP-3 完工后，浏览器 `/news` 列表会自动出现 Reddit 红色徽章项，零前端改动。

### 6.2 API

**完全无变化**。`GET /hot-news` SP-1 起就 platform-agnostic，DTO 已包含 `sourcePlatform` 与 `interactionData` 字段。

### 6.3 部署

**`scripts/deploy.sh` 完全无变化**。SP-2 收尾时已落地 auto-seed + worker restart 流程：

```bash
# scripts/deploy.sh （SP-2 已就位部分，SP-3 复用）
# ... migrate deploy ...
IMAGE_TAG="$IMAGE_TAG" $COMPOSE run --rm \
  --entrypoint sh api -c "cd packages/db && npx prisma db seed"  # ← 自动 seed 8 个新 Reddit sub
# ... up -d ...
IMAGE_TAG="$IMAGE_TAG" $COMPOSE restart worker                    # ← 自动重启 worker
```

**唯一需要手工的一步**：把 Reddit OAuth credentials 写进 VPS `/srv/ai-hot-news/.env`（**必须在 push SP-3 commit 前完成**，否则 worker 启动 OAuth refresh 失败）：

```bash
ssh deploy@<vps>
cat >> /srv/ai-hot-news/.env <<'EOF'
REDDIT_CLIENT_ID=<from reddit prefs/apps>
REDDIT_CLIENT_SECRET=<from reddit prefs/apps>
REDDIT_USER_AGENT=ai-hot-news-bot/0.1 (by /u/<your-reddit-username>)
REDDIT_FETCH_TIMEOUT_MS=15000
EOF
```

> **如果忘记预先填 .env**：worker 启动后第一次 Reddit boot job 会 throw `Reddit OAuth: REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be set`，BullMQ 重试 3 次后 8 个 SourceConfig 全部 status='FAILED'。补 env 后 `docker compose restart worker` 即恢复。

---

## 7. 测试矩阵

| 测试 | 文件 | 类型 | 关键 case |
|---|---|---|---|
| `RedditOAuthClient` | `apps/worker/src/crawl/crawlers/reddit-oauth.client.spec.ts` | 单元 | mock global.fetch；首次 `getToken()` → POST `/api/v1/access_token` 返回 token + expires_in；token 在缓存窗口内复用（`expiresAt > now+60s`）；过期后自动 `refreshToken()`；首次 fetch 401 → clear + refresh + retry 一次成功；首次 fetch 401 + 二次 401 → return 401（不无限循环）；refresh 401 → throw；refresh 网络错 → throw；missing client_id/secret → throw clear message |
| `RedditCrawler.fetch` | `apps/worker/src/crawl/crawlers/reddit.crawler.spec.ts` | 单元 | mock RedditOAuthClient；`hot.json` 200 → 25 posts → toRaw 全部正确映射；link-post → `externalUrl=post.url`, `rawHtml=null`, `contentText=title`；self-post → `rawHtml=selftext_html`, `contentText=stripHtml(selftext_html)`, `externalUrl=null`；空 self-post（`selftext_html=null`）→ `rawHtml=null`, `contentText=title`；`stickied=true` → 过滤；`over_18=true` → 过滤；`title=null` → 过滤；`author='[deleted]'` → 归一化为 null；`upvote_ratio=null` → 透传 null；`identifier=null` → throw；非 Listing 响应 → throw；非 200 → throw |
| `CrawlerFactory` | `apps/worker/src/crawl/crawler.factory.spec.ts`（**扩展**）| 单元 | 加 `Platform.REDDIT → RedditCrawler` 实例化测试；构造函数依赖 `RedditOAuthClient` 注入；现有 RSS / HN case 继续通过 |
| `CrawlScheduler` | `apps/worker/src/crawl/crawl.scheduler.spec.ts`（**扩展**）| 单元 | 加 8 个 REDDIT source 的 enqueue assertion；platform-counts log 含 `8 REDDIT` |
| `IngestionService` Reddit | `apps/worker/src/crawl/ingestion.service.integration.spec.ts`（**扩展**）| 集成（真 PG）| 加 REDDIT case：`interactionData={ score, comments, externalUrl, redditId, redditSubreddit, redditUpvoteRatio }` 完整透传；同 sourceUrl 第二次 ingest 跳过；`upvoteRatio=null` 时也能透传；`redditUpvoteRatio` 在 PG JSONB 列里以 number 存（`SELECT interaction_data->>'redditUpvoteRatio' = '0.95'`）|
| `processCrawlJob` | （**不单测**，由 integration spec 隐式覆盖）| — | 与 SP-2 同策略 |
| Web `/news` Reddit 徽标 | （**不单测**，依赖人工验收）| — | 浏览器看到 Reddit 项有红色 "Reddit" 徽标 |

CI 中：
- `pnpm turbo lint typecheck build` —— 现有
- `pnpm turbo test` —— 现有，自动捕获新单元 + 集成测试
- 集成测试沿用 SP-1 的 PG service container

**测试 fixture 准备清单**（6 个 JSON 文件）：

```json
// reddit-hot-listing.json (mock /r/<sub>/hot.json 完整响应)
{
  "kind": "Listing",
  "data": {
    "after": "t3_1k4xz9p",
    "before": null,
    "children": [
      { "kind": "t3", "data": { /* ↓ 见 reddit-link-post.json */ } },
      { "kind": "t3", "data": { /* 见 reddit-self-post.json */ } },
      { "kind": "t3", "data": { /* 见 reddit-stickied-post.json */ } },
      { "kind": "t3", "data": { /* 见 reddit-nsfw-post.json */ } },
      { "kind": "t3", "data": { /* 一条 author=[deleted] 的 self-post */ } }
    ]
  }
}

// reddit-link-post.json
{
  "id": "1k4xz9p", "title": "GPT-5 announced", "author": "user_alice",
  "subreddit": "OpenAI", "url": "https://openai.com/news/gpt-5",
  "permalink": "/r/OpenAI/comments/1k4xz9p/gpt5_announced/",
  "is_self": false, "selftext": "", "selftext_html": null,
  "created_utc": 1746230400, "score": 1234, "ups": 1234, "downs": 0,
  "num_comments": 56, "upvote_ratio": 0.95,
  "stickied": false, "over_18": false
}

// reddit-self-post.json
{
  "id": "1k4xz9q", "title": "Show: my local LLM benchmark", "author": "user_bob",
  "subreddit": "LocalLLaMA", "url": "https://www.reddit.com/r/LocalLLaMA/comments/1k4xz9q/...",
  "permalink": "/r/LocalLLaMA/comments/1k4xz9q/show_my_local_llm_benchmark/",
  "is_self": true,
  "selftext": "Hi everyone, I built a benchmark...",
  "selftext_html": "<!-- SC_OFF --><div class=\"md\"><p>Hi everyone, I built a <strong>benchmark</strong>...</p></div><!-- SC_ON -->",
  "created_utc": 1746230500, "score": 89, "num_comments": 12, "upvote_ratio": 0.88,
  "stickied": false, "over_18": false
}

// reddit-stickied-post.json (应被过滤)
{
  "id": "1k4xz9r", "title": "[META] Subreddit rules update", "author": "AutoModerator",
  "subreddit": "OpenAI", "is_self": true, "selftext_html": "<p>Rules...</p>",
  "created_utc": 1746000000, "score": 5, "num_comments": 0, "upvote_ratio": 1.0,
  "stickied": true, "over_18": false
}

// reddit-nsfw-post.json (应被过滤)
{
  "id": "1k4xz9s", "title": "NSFW topic", "author": "user_carol",
  "subreddit": "OpenAI", "is_self": false, "url": "https://example.com/nsfw",
  "created_utc": 1746230600, "score": 1, "num_comments": 0, "upvote_ratio": 0.5,
  "stickied": false, "over_18": true
}

// reddit-oauth-token.json (mock POST /api/v1/access_token 响应)
{
  "access_token": "test-bearer-token-xyz",
  "token_type": "bearer",
  "expires_in": 86400,
  "scope": "*"
}
```

---

## 8. 错误处理 + 升级钩子

### 8.1 分层错误处理

| 失败类型 | 行为 |
|---|---|
| OAuth token 401（token revoked / expired racy） | OAuthClient 自动 clear + refresh + retry 一次；二次仍 401 → throw → BullMQ 重试 3 次 |
| OAuth token refresh 401（凭据错） | throw immediately + `logger.error`；BullMQ 重试 3 次后 8 个 Reddit source 全部 `status='FAILED'`，`errorMessage="Reddit OAuth: token refresh failed 401 ..."` |
| OAuth token refresh 网络错 / 超时 | throw → BullMQ 指数退避重试 |
| `hot.json` 429（限速）| `RedditCrawler.fetch` throw → BullMQ 指数退避重试 60s/120s/240s |
| `hot.json` 5xx | 同上 |
| `hot.json` 200 但 `kind != 'Listing'` | throw → BullMQ 重试（防御 Reddit API 异常返回） |
| 单 post `title=null` / `id=null` | `isValidPost` 过滤，整批继续 |
| `stickied=true` / `over_18=true` | `isValidPost` 过滤 |
| 单 post 缺失 `selftext_html` | `rawHtml=null`, `contentText=title`（退化为 link-post 等价行为） |
| subreddit 不存在（404） | throw → BullMQ 重试 → status='FAILED'；seed 给的 8 个都是确定存在的 sub，理论上不会触发 |
| `ingest` P2002 重复 sourceUrl | `result.skipped++`，不算失败（与 SP-2 同策略）|

### 8.2 升级钩子（spec 显式记录）

| 触发条件 | 当前实现 | 升级路径 |
|---|---|---|
| Worker 扩到 ≥2 replicas | OAuth token 单进程 in-memory cache | 把 `RedditOAuthClient.token` 替换为 Redis 共享 cache（key=`reddit:oauth:token`，TTL=expires_in-60s）；其他代码不动 |
| Reddit OAuth 收费 / 限速大幅紧缩 | 100 req/min/client 用得很省（8 req/h） | 短期：把 `crawlInterval` 从 3600 提到 7200；长期：考虑 RSS 降级（丢 score/comments 但保 title/url）|
| 高热度 post 的 score / comments 变化（first-write-wins 不更新） | spec §1.3 故意限制 | SP-6 增加独立 `refresh-interaction-data` worker，按 `heatScore desc limit 200` 周期刷新 score / comments / upvote_ratio；与 HN 共享同一 worker |
| 8 sub 信号差异显著 | 统一 60min `crawlInterval` | 运维手工 SQL `UPDATE source_configs SET crawl_interval=1800 WHERE identifier='LocalLLaMA'`；下次 deploy seed 不会覆盖 |
| 想加新 sub | 改 `seed.ts` 的 `redditCandidates` 数组 + push | deploy auto-seed 自动生效；零手工 SQL |
| 评论数据成 SP-5 瓶颈 | SP-3 不抓评论 | 独立 `enrich-reddit-comments` worker 按"score≥100 且 comments_fetched_at IS NULL"按需抓 `comments/{id}.json` |
| Reddit `redditUpvoteRatio` 字段不可靠 | 直接透传 | SP-6 热度公式消费时增加 nullable handling + fallback 到 score-only |

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Reddit OAuth 凭据未在 deploy 前写进 VPS `.env` | 8 个 Reddit source 全部 `status='FAILED'`，prod 暂时无 Reddit 数据但其他平台正常 | §6.3 已写明部署清单；spec checklist §10 加显式步骤 |
| Reddit UA 不规范触发 IP 封禁 | 全部 Reddit 抓取静默失败 | UA 严格按 `<bot>/0.1 (by /u/<owner>)` 格式（Reddit ToS 要求）；prod 用真实 owner 的 reddit username |
| OAuth client_secret 不慎泄露（commit / log） | 攻击者用我们配额 / 关联到 owner | `.env.example` 只放占位；真实值仅 VPS `.env`（已 .gitignore）；GitHub repo 无任何泄露面；`logger.log` 不打印 token / secret |
| Reddit API 偶发 5xx 或网络抖动 | 单 sub 单轮抓取失败 | BullMQ 默认 3 次指数退避 + status='FAILED' 写回；下次 repeatable 触发自动恢复 |
| 8 个 Reddit sub 一轮抓取 ~25 行/sub × 8 = ~200 候选，prod hot_news 增长率 +30% | 磁盘压力 | 60min interval + P2002 去重大部分新轮抓的 ≥80% 重复（hot 榜变化慢）→ 实际净增 ≈ 60 行/h ≈ 1500 行/天 ≈ 0.5 GB/年；远低于刚清理出的 12GB；OPS-2026-05-03 后 deploy.sh 会 prune 镜像，无递归撑爆风险 |
| `selftext_html` 包含恶意 HTML（XSS） | rawHtml 字段被 web 直接渲染时风险 | SP-3 入库阶段不做处理（Reddit 已经 sanitize 一道）；SP-11 详情页渲染时**必须**走 React 自动转义或 dompurify；spec §9.3 升级钩子记录 |
| 一个 sub 被 mod 关闭 / 重命名（如 r/LocalLLaMA 改名） | 该 sub 持续 404 | BullMQ 重试 3 次后 status='FAILED'，errorMessage 含 `404`；运维手工 disable 该 SourceConfig；不影响其他 7 sub |
| OAuth `expires_in` 字段缺失（API 异常）| token cache `expiresAt=NaN` → 永远过期 → 每次 refresh | spec §3.2 实现里 `data.expires_in * 1000` 若 `expires_in` 是 undefined 会得到 NaN，cache `expiresAt=Date.now()+NaN=NaN`，`expiresAt > Date.now()+60_000` 为 false（NaN 比较恒 false）→ 自然走 refresh；副作用是每次 fetch 都 refresh，增加 1 次 token 请求；可接受，且如果发生会被 log 警示（每条 fetch 一行 `refreshed token`）|
| RedditCrawler 在 worker 启动 immediate 阶段 race（OAuth token 还没 refresh）| 第一次 boot job 触发 OAuth refresh，并发 8 boot job 时可能同时 refresh 8 次 | 当前 `BullMQ worker concurrency=1`（SP-1 默认），8 boot job 串行执行，第一个 refresh 后后 7 个 cache 复用；无 race |

---

## 10. 完工 Checklist

```text
[ ] 用户已在 https://www.reddit.com/prefs/apps 注册 type=script app，拿到 client_id/secret
[ ] 本地 apps/worker/.env 加入 REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET / REDDIT_USER_AGENT
[ ] apps/worker/.env.example 加入 4 个 Reddit env 占位
[ ] packages/types RawCrawledItem 不变（SP-2 已就位）
[ ] apps/worker/src/crawl/crawlers/reddit.types.ts 新增（RedditPost / RedditListingResponse 接口）
[ ] apps/worker/src/crawl/crawlers/reddit-oauth.client.ts + spec 新增并通过（5 个核心 case）
[ ] apps/worker/src/crawl/crawlers/reddit.crawler.ts + spec 新增并通过（10+ 个 case：link/self/stickied/nsfw/[deleted]/upvoteRatio=null/...）
[ ] apps/worker/src/crawl/crawler.factory.ts 加 case REDDIT + 构造函数注入 RedditOAuthClient
[ ] apps/worker/src/crawl/crawler.factory.spec.ts 加 REDDIT 路由测试 + DI mock
[ ] apps/worker/src/crawl/crawl.scheduler.ts platform.in [...] 加 REDDIT
[ ] apps/worker/src/crawl/crawl.scheduler.spec.ts assertion 加 REDDIT 计数
[ ] apps/worker/src/crawl/crawl.module.ts 注册 RedditOAuthClient + 3 个 env value providers
[ ] apps/worker/src/crawl/ingestion.service.integration.spec.ts 加 REDDIT case 通过
[ ] packages/db/prisma/seed.ts 加 redditCandidates + seedReddit() + main() 调用
[ ] CI 全绿（lint / typecheck / build / test）
[ ] 本地 pnpm db:seed → 14 条 SourceConfig 入库（3 RSS + 3 HN + 8 Reddit）
[ ] 本地 pnpm dev → worker 日志含 "Registered 14 enabled sources: 3 RSS, 3 HACKERNEWS, 8 REDDIT"
[ ] 本地 pnpm dev → worker 日志含 1 条 "Reddit OAuth: refreshed token (expires in 86400s)"
[ ] 本地 pnpm dev → 5-8 分钟内 worker 日志含 8 条 "REDDIT crawled: source=r/* fetched=25 inserted=*" 正常
[ ] curl localhost:3001/hot-news?pageSize=200 | jq '.items[] | select(.sourcePlatform == "REDDIT") | .interactionData' 字段完整（6 个字段）
[ ] open localhost:3000/news → 浏览器看到 Reddit 项有红色 "Reddit" 徽标
[ ] 重启 worker 验证 idempotency：第二次 boot 抓取后大部分 P2002 跳过（log 含 skipped=>15）
[ ] VPS /srv/ai-hot-news/.env 加入 4 个 Reddit env（**push commit 前完成**）
[ ] push 到 main → CI/Deploy 自动通过 → deploy.sh auto-seed 8 条 Reddit + restart worker
[ ] curl https://<domain>/api/hot-news?pageSize=200 | jq '.items | map(.sourcePlatform) | unique' → 含 ["HACKERNEWS","REDDIT","RSS"]
[ ] decomposition spec §6 + §11 回写：SP-3 完成 + 把 SP-2 §4.2 "Reddit 预留" 行更新为"Reddit 已落地"
[ ] decomposition spec 决策日志加 SP-3 4 条决策（OAuth Application-Only / 8 sub hot 25 / 60min / 不抓评论）
[ ] decomposition spec 决策日志加 clawfeed 学到的 2 个点（URL auto-detect → SP-24 / source_packs → 未来 UX 参考）
```

---

## 11. 后续步骤

本 spec 经用户审阅批准后：

1. 调用 `writing-plans` skill，把本 spec 转化为 step-by-step 实施计划文档（`docs/superpowers/plans/2026-05-XX-sp3-reddit-crawler-plan.md`）
2. 计划文档审阅通过后，进入 SP-3 实施
3. SP-3 完成（Checklist 全打勾）后：
   - **回写 decomposition spec §6 + §11**：标记 SP-3 完成 + 更新 SP-2 §4.2 表格"Reddit 预留"为"Reddit 已落地"
   - **回写决策日志**：4 条 SP-3 决策 + 2 条 clawfeed 学到的点
   - 启动 **Phase 3** 路线选择：按 spec 顺序进 SP-4（去重升级）；或按"用户感受"优先级先做 SP-5（AI 标签摘要）/ SP-6（热度计算），让数据真正"有秩序"
