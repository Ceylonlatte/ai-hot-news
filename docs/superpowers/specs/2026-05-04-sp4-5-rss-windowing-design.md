# SP-4.5 RSS 时效性窗口 + 平台分区 设计

> **状态**：设计稿 · 2026-05-04
> **依赖**：SP-4 已完成（提供 `dedupeHash` / `status` / `filterReason` 基础设施）
> **产物**：API tab 切换（社区 / 权威媒体）、RSS 拉取与窗口策略、一次性历史清理脚本

---

## 1. 背景与问题

### 1.1 SP-4 完成后的实测发现

SP-4 部署后查 prod 数据，按 `publishedAt` 时间分布拆 RSS / HN / Reddit：

| 平台 | 24h | 48h | 72h | 7d | 30d | total |
|---|---:|---:|---:|---:|---:|---:|
| **RSS** | 0 | **0** | 1 | 10 | 81 | 1129 |
| HN | 61 | 137 | 238 | 538 | 635 | 635 |
| Reddit | 143 | 243 | 262 | 270 | 270 | 270 |

按 RSS 来源拆：

| 源 | 条数 | 最老 | 最新 |
|---|---:|---|---|
| `openai.com` | 929 | **2015-12-11** | 2026-04-30 |
| `deepmind.google` | 100 | 2025-02-04 | 2026-04-30 |
| `research.google` | 100 | 2025-07-17 | 2026-05-01 |

### 1.2 问题诊断

1. **RSS feed 协议层无增量过滤**：每次 fetch OpenAI feed 服务器返回 ~929 条历史 item（2015 年至今全部）。`RssCrawler.fetch()` 用 `feed.items.map(...)` 全量入 ingestion。SP-4 的 `dedupeHash` 唯一约束兜底没有数据重复入库，但每次拉取仍解析全量 XML，且**最初一次** OpenAI 上线时把 929 条历史一次性灌入。
2. **API 端无时间窗口过滤**：`HotNewsService.list()` 仅按 `status=VISIBLE` 过滤、`publishedAt desc` 排序，前端翻页可触达 2015 年的内容。
3. **RSS 与 HN/Reddit 内容产出节奏差一个数量级**：
   - RSS 三个 source 周产出 ~10 篇（OpenAI ~7 / DeepMind ~1 / Google Research ~2）
   - HN Top 一天 ~30 篇，48h 内有 ~137 条
   - Reddit 8 个 sub 一天 ~30 篇/sub，48h 内 ~243 条
   - 统一 48h 窗口 → RSS 直接 0 条；统一 7d 窗口 → HN/Reddit 出现"过气一周前热点"

### 1.3 用户原始诉求（brainstorming 对话原话）

> "对于 RSS 我比较关注时效性，窗口只展示 48 小时以内的，拉取也不全量拉取"
> "RSS 作为单独 tab 展示，并且 7d 拉取一次即可，清理历史数据只保留最近 7d 的数据内容"

经数据驱动的反向论证（48h 窗口 RSS 为 0 条），收敛为本文档方案。

---

## 2. 目标与非目标

### 2.1 目标

1. **首页只显示"近期社区热点"**：默认仅 HN + Reddit，时间窗口 48h
2. **RSS 单独入口**：作为"权威媒体" tab，时间窗口 7d
3. **RSS 拉取减少浪费**：调度间隔由 30min 降至 1d；入库前按 publishedAt cutoff 过滤；不消除全量拉取（RSS 协议特性，无低成本方案）
4. **历史 RSS 数据清理**：物理 DELETE 当前 1119 条 publishedAt < (now - 7d) 的 RSS 行
5. **schema 不变**：所有逻辑通过 query + crawler 行为 + cleanup 脚本实现
6. **HN/Reddit 现状不动**：拉取频率、入库逻辑、DB 行不动；API 加窗口过滤即让 30d 内的 HN/Reddit 老数据"自然不显示"

### 2.2 非目标

- **HTTP Conditional GET**（`If-Modified-Since` / `ETag`）：能再降 90% 网络流量但需要扩 schema + 改 fetch 实现，本期 YAGNI（当前 8 MB/天 RSS 流量完全可忽略）
- **多 tab 任意组合**：本期前端只做 2 个固定 tab（社区 / 权威媒体），不开放 platforms 任意组合（避免在不必要的灵活性上花时间）
- **窗口运行期可调**：窗口大小由后端硬编码，前端不可传 `windowHours` 参数（避免乱用 + 后端硬约束更安全）
- **HN/Reddit 历史数据物理清理**：48h 之外的 HN ~498 条 / Reddit ~27 条不删除；保留为未来"上周热门"等功能的数据基础
- **跨 source RSS 软合并**：跨 source 同一新闻（如 OpenAI + DeepMind 同时讨论某 paper）的合并属 SP-7 范畴

---

## 3. 架构设计

### 3.1 数据流变更

```
[当前 SP-4 完成态]
RSS feed (929 条) → RssCrawler.fetch() → IngestionService → P2002 兜底 → HotNews 1129 行（含 1119 老数据）
                                                                          │
                                                              API GET /api/hot-news → 全量按 publishedAt desc 翻页

[SP-4.5 完成态]
RSS feed (929 条) → RssCrawler.fetch() ─┐
                                         ├→ IngestionService → cutoff filter (publishedAt ≥ now - 7d)
HN/Reddit (无变化) ──────────────────────┘                  │
                                                             ▼
                                                       dedupeHash 兜底 → HotNews
                                                                            │
                                              API GET /api/hot-news?platforms=...
                                              ├─ platforms=HACKERNEWS,REDDIT (默认) → window 48h
                                              └─ platforms=RSS                      → window 7d
```

关键变化：
- **新增 cutoff filter（在 IngestionService）**：单一入口集中管理"RSS publishedAt 窗口"逻辑，crawler 不感知；即便未来加新 RSS source 也免改 crawler
- **新增 platforms query 参数 + 平台窗口映射（在 HotNewsService）**：API 层硬编码 `WINDOW_HOURS` 表，前端只传 platforms

### 3.2 模块边界

| 模块 | 改动范围 | 内部不可见 |
|---|---|---|
| `apps/worker/src/crawl/ingestion.service.ts` | 入库前加 `isWithinIngestWindow(raw, source, now)` 早返 | crawler 不知道有 cutoff 概念 |
| `apps/worker/src/crawl/crawlers/rss.crawler.ts` | **不改**（继续返回全量 RawCrawledItem） | 网络层全量拉是 RSS 协议性质，不是 bug |
| `apps/api/src/hot-news/hot-news.service.ts` | `list(...)` 加 `platforms?` + 内部窗口映射 | 前端不知道窗口数值 |
| `apps/api/src/hot-news/hot-news.controller.ts` | DTO 加 `platforms?: string` | 字符串解析在 service 层 |
| `apps/web` 前端 | 加 tab 切换组件 + 默认请求 `?platforms=HACKERNEWS,REDDIT` | UI 设计在 P4 / SP-8 阶段已经定调；本期复用现有列表，仅加 tab |
| `packages/db/scripts/cleanup-rss-pre-window.ts` | 新增一次性脚本：`DELETE FROM hot_news WHERE sourcePlatform='RSS' AND publishedAt < now() - 7d` | 部署一次后归档 |
| 部署 SQL（`packages/db/scripts/sp4-5-update-rss-interval.sql`） | RSS source 的 `crawlInterval`：1800 → 86400 | 一次性更新；写成 idempotent（带 `WHERE crawlInterval <> 86400` 防重跑） |

---

## 4. 接口契约

### 4.1 API：`GET /api/hot-news`

**新增 query 参数**：

```
?platforms=HACKERNEWS,REDDIT        默认行为：返回这两个平台 48h 内的内容
?platforms=RSS                      返回 RSS 7d 内的内容
?platforms=HACKERNEWS               单平台同样支持（窗口取该平台对应值）
?platforms=未传                     【默认】等价于 platforms=HACKERNEWS,REDDIT
```

**后端硬编码窗口表**：

```ts
// apps/api/src/hot-news/hot-news.service.ts
const PLATFORM_WINDOW_HOURS: Record<Platform, number> = {
  HACKERNEWS: 48,
  REDDIT: 48,
  RSS: 24 * 7,
};
```

**新查询逻辑**（伪代码）：

```ts
async list(page, pageSize, platformsParam?: string): Promise<HotNewsListResponseDto> {
  const platforms = parsePlatforms(platformsParam) ?? [HACKERNEWS, REDDIT]; // default
  const now = new Date();
  // 多平台 query 用 OR (platform=A AND publishedAt >= now-windowA) OR (...) 形式
  const where = {
    status: VISIBLE,
    OR: platforms.map((p) => ({
      sourcePlatform: p,
      publishedAt: { gte: subHours(now, PLATFORM_WINDOW_HOURS[p]) },
    })),
  };
  // 其余 skip / take / orderBy 不变
}
```

> 注：当 `platforms=HACKERNEWS,REDDIT` 时，48h 窗口对两者一致，可优化为单 AND 条件，但保留 OR 形式以便未来加 platform 时不踩坑。Postgres 在 `(sourcePlatform, publishedAt)` 复合索引下成本可忽略。

**响应契约不变**：`HotNewsListResponseDto` 字段不动；`total` 现在是窗口内的总数（前端 pagination 准确）。

**契约不变量**：
- 默认请求（未传 platforms）`total` = 48h 内 VISIBLE HN+Reddit ≈ 380（部署当时数据，浮动正常）
- `?platforms=RSS` `total` ≤ 10（部署当时数据；7d cutoff + cleanup 后理论上限是 OpenAI/DeepMind/Google 的周新增之和）

### 4.2 RSS Cutoff（IngestionService）

```ts
// apps/worker/src/crawl/ingestion.service.ts
const RSS_INGEST_WINDOW_DAYS = 7;

private isWithinIngestWindow(raw: RawCrawledItem, source: SourceConfig, now: Date): boolean {
  if (source.platform !== Platform.RSS) return true; // 仅 RSS 应用
  if (!raw.publishedAt) return false; // 无时间戳的 RSS item 默认丢弃
  const cutoff = subDays(now, RSS_INGEST_WINDOW_DAYS);
  return raw.publishedAt >= cutoff;
}
```

集成点：在现有 `IngestionService.ingest()` 主循环里、`dedupeHash` 计算之前调用：

```ts
for (const raw of items) {
  if (!this.isWithinIngestWindow(raw, source, now)) {
    stats.skippedOutsideWindow++;
    continue;
  }
  // ... existing cleanTitle / dedupeHash / insert 流程
}
```

`IngestResult` 新增统计字段：

```ts
interface IngestResult {
  inserted: number;
  duplicates: number;
  hidden: number;
  skippedOutsideWindow: number; // ← 新增
}
```

### 4.3 RSS source 配置变更

```sql
-- 部署 SQL（写在 packages/db/scripts/sp4-5-update-rss-interval.sql 或 migration）
UPDATE source_configs
SET "crawlInterval" = 86400  -- 1 day
WHERE platform = 'RSS';
```

worker 重启后 `CrawlScheduler.onModuleInit()` 会按新 interval 重注册 BullMQ repeat job。

---

## 5. 历史数据处理

### 5.1 一次性清理脚本

**文件**：`packages/db/scripts/cleanup-rss-pre-window.ts`

**逻辑**：

```ts
import { getPrisma } from '@ai-hot-news/db';

async function run() {
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // 1) 先 SELECT 看一下要删的量（dry-run-ish 在 prod 给人 sanity check 机会）
  const toDelete = await prisma.hotNews.count({
    where: { sourcePlatform: 'RSS', publishedAt: { lt: cutoff } },
  });
  console.log(`Will DELETE ${toDelete} RSS rows older than ${cutoff.toISOString()}`);

  // 2) 真删
  const result = await prisma.hotNews.deleteMany({
    where: { sourcePlatform: 'RSS', publishedAt: { lt: cutoff } },
  });
  console.log(`Deleted ${result.count} rows.`);

  // 3) 验证不变量
  const remaining = await prisma.hotNews.count({
    where: { sourcePlatform: 'RSS' },
  });
  console.log(`Remaining RSS rows: ${remaining}`);
}
run().catch(console.error).finally(() => process.exit(0));
```

**不变量**：
- 删除前 RSS total = 1129
- 删除后 RSS total = 此刻 publishedAt ≥ now-7d 的 RSS 行数（约 10，依部署时刻）
- HN/Reddit total 不变

### 5.2 走 SP-4 的 prod-oneshot 模式

由 SP-4 后已经标准化的 `scripts/run-prod-oneshot.sh` 跑：

```bash
ssh ai-hot-news-prod
cd /srv/ai-hot-news
docker compose -f docker/docker-compose.prod.yml --env-file .env stop worker
bash scripts/run-prod-oneshot.sh packages/db scripts/cleanup-rss-pre-window.ts
docker compose -f docker/docker-compose.prod.yml --env-file .env start worker
```

> 与 SP-4 backfill 一致的"single-writer"假设：cleanup 期间停掉 worker，避免 IngestionService 同时往 RSS 写 → cutoff 之外的数据再次出现。

### 5.3 不可逆性提示

物理 DELETE 不可恢复。回滚路径：
1. 重启 RSS crawler，等 OpenAI/DeepMind/Google feed 再次返回历史
2. 但本期已把 IngestionService 的 cutoff = 7d 写死 → **回滚还需要把 cutoff 改大**才能再吃历史
3. 评估为可接受：被删除的 1119 条都是 ≥ 7 天前的"过期"内容，业务侧无价值

---

## 6. 测试范围

### 6.1 单测

**`HotNewsService.list()`**：
- 默认请求（`platforms` 未传）→ 等价于 HN+REDDIT 48h 窗口
- `?platforms=RSS` → 7d 窗口
- `?platforms=HACKERNEWS,REDDIT` 显式 → 同默认
- `?platforms=HACKERNEWS` 单平台 → 48h 窗口仅 HN
- `?platforms=INVALID` → fallback 到默认（不报 500）
- 各平台窗口边界：恰好 windowHours、windowHours 前 1ms

**`IngestionService.isWithinIngestWindow()`**：
- RSS + publishedAt 在窗口内 → true
- RSS + publishedAt 在窗口外 → false
- RSS + publishedAt 为 null → false
- HN / Reddit + 任意 publishedAt → true（不应用 cutoff）
- 边界：恰好 7d、7d 前 1ms

### 6.2 集成测试

**Crawler → Ingestion 全链路**（vitest + 真实 testdb）：
- mock RSS source 返回 ~50 条 item，其中 ~10 条 publishedAt 在 7d 内 → 验证 DB 中只有 10 条 RSS 行；`IngestResult.skippedOutsideWindow=40`

### 6.3 部署烟测（与 SP-4 同模式）

```bash
# 部署后立即在 prod 跑
curl 'https://hotnews.shinpeionline.top/api/hot-news?pageSize=50' | jq '.total'
# 期望：~380 (48h HN + Reddit)

curl 'https://hotnews.shinpeionline.top/api/hot-news?platforms=RSS&pageSize=50' | jq '.total'
# 期望：≤ 10 (7d RSS)

ssh ai-hot-news-prod 'docker exec docker-postgres-1 psql -U ai_hot_news -d ai_hot_news_prod -c "
SELECT \"sourcePlatform\", COUNT(*) FROM hot_news GROUP BY 1;
"'
# 期望 RSS ≤ 10 + 当日新拉取量；HN/Reddit 不变
```

---

## 7. 部署计划

> 与 SP-4 完全一致：CI 部署 → prod oneshot 跑 cleanup → 烟测。

1. **PR 合入 main** → GitHub Actions 部署 worker / api / web 新镜像（含 cutoff、API 窗口、tab UI）
2. **Prod 一次性脚本**（顺序固定）：
   ```bash
   # a) 停 worker（single-writer，避免 cleanup 与 ingest 并发）
   docker compose -f docker/docker-compose.prod.yml --env-file .env stop worker

   # b) 跑 cleanup（删 1119 条老 RSS）
   bash scripts/run-prod-oneshot.sh packages/db scripts/cleanup-rss-pre-window.ts

   # c) 更新 source_configs.crawlInterval (30min → 1d)
   docker compose -f docker/docker-compose.prod.yml exec postgres \
     psql -U ai_hot_news -d ai_hot_news_prod \
     -c "UPDATE source_configs SET \"crawlInterval\" = 86400 WHERE platform = 'RSS' AND \"crawlInterval\" <> 86400;"

   # d) 启 worker（按新 interval 注册 BullMQ repeat job）
   docker compose -f docker/docker-compose.prod.yml --env-file .env start worker
   ```
3. **烟测**：见 §6.3
4. **更新 decomposition design**：§11 加 SP-4.5 status 行 + §10 决策记录

---

## 8. 关键决策记录

> 这些决策汇总后会同步到主 decomposition design `§10 决策日志`。

1. **窗口由"内容产出节奏"决定，不是拉取频率**。RSS 周产出 ~10 篇 → 7d；HN/Reddit 日产出几百 → 48h。统一窗口策略不可行——48h 窗口下 RSS 直接消失。
2. **平台分 tab 而非混排**。`publishedAt desc` 排序混排会让"权威媒体 7d 旧文"全部沉到 Reddit 48h 新热点之后，"权威媒体专区"的产品价值消失。
3. **RSS 拉取从 30min 降到 1d**。30min 是过度轮询（OpenAI 一周才发 7 篇）。1d 一次：OpenAI 新博客 ≤ 24h 延迟、调用量从 192 次/天 → 4 次/天。
4. **cutoff 在 IngestionService 而非 Crawler**。Crawler 保持"原样翻译 feed"职责单一；cutoff 是"业务策略"，应集中在 ingestion 层一处管理；未来加新 RSS source 0 改 crawler。
5. **HN/Reddit 窗口过滤在 API 层、不删 DB 老数据**。HN/Reddit 老数据无类似 RSS "OpenAI 2015" 的明显荒诞；保留 30d 内全部行，未来"上周热门"/时间轴分析可直接复用。
6. **物理 DELETE 历史 RSS 而非 HIDDEN 标记**。用户在 brainstorming 显式选择"清理"。trade-off 接受：1119 条全是 ≥7 天前过期内容，业务无价值；不可逆但可通过 RSS feed 重抓部分恢复（cutoff 调大时）。
7. **不实现 HTTP Conditional GET（YAGNI）**。能降 90% 网络流量但当前 8 MB/天 RSS 流量本就可忽略；加 Last-Modified/ETag 字段 + 改 fetch 实现 + 错误处理收益不抵成本。RSS source 数量上百再说。
8. **API 不暴露 windowHours 参数给前端**。窗口大小是后端"业务策略"，前端只传 platforms。避免前端误传超大窗口（如 windowHours=8760）触发慢查询。
9. **默认请求等价 platforms=HACKERNEWS,REDDIT**。这是首页常用 view。如果未来 RSS 重要性上升，改默认即可（一行 default value）。
10. **SP-4.5 不动 SP-4 已交付的 quality/dedupe/cleaning**。本期只在最外层加窗口过滤 + RSS 拉取节流，SP-4 内部逻辑零改动。

---

## 9. 后续扩展（不在本期）

- **HTTP Conditional GET**：加 `source_configs.lastModified / etag` 列；改 RssCrawler 用手动 fetch + parse；流量降 90%
- **窗口运行期可调**：把窗口配置从代码常量挪到 `source_configs.windowHours` 列；前端按"权威媒体" tab 出 24h/7d/30d 切换器；先看产品需求再做
- **跨 RSS source 软合并**：OpenAI 与 DeepMind 同时讨论某 paper、URL 不同 → SP-7 pgvector 余弦合并
- **RSS publishedAt 缺失的 fallback**：本期一律丢弃；未来可考虑用 `crawledAt` 兜底（前提是首次 fetch 即新内容）

---

## 10. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Cleanup 脚本误删 HN/Reddit 行 | 低 | 高 | `DELETE WHERE sourcePlatform='RSS'` 显式过滤；脚本先 SELECT count 打印 |
| `crawlInterval` 改成 86400 后 worker 不再拉 RSS | 中 | 中 | 部署后 worker logs 应在 1d 内出现 RSS fetch；最长 24h 才能确认；先在 staging 验证（如有） |
| 用户在 RSS tab 期望看到 30d 历史 | 中 | 低 | spec 已明确仅 7d；UI 文案"权威媒体最近 7 天"消除歧义 |
| API platforms 解析错误导致 500 | 低 | 中 | 单测覆盖：空、单值、多值、未知值、大小写；invalid 一律 fallback 到默认 |
| 部署后某 RSS source 真的 1d 内零更新 → tab 空 | 高 | 低 | 这是 RSS 产出节奏的真实情况；UI 加 empty state 文案"过去 7 天暂无新内容" |

---

## 11. 待 implementation plan 阶段细化的项

writing-plans 阶段需展开为 task：

- API DTO / service / controller / e2e 测试（含窗口边界、platforms 解析）
- IngestionService cutoff + IngestResult 字段 + 单测 + 集成测试
- 前端 tab 组件 + 默认请求路径
- `cleanup-rss-pre-window.ts` 脚本 + 测试
- `crawlInterval` 更新 SQL（写成 idempotent 的）
- decomposition design 更新（§10 决策、§11 status）
- 部署手册与 SP-4 一致
