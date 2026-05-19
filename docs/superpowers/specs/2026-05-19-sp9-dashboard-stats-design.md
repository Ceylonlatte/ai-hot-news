# SP-9 — Dashboard 首页 + Stats API

- **状态**：Draft，待 PR-A 实施
- **起草日期**：2026-05-19
- **依赖**：SP-6（heatScore/heatLevel）+ SP-7（groupId）+ SP-8（Aurora 视觉系统 + HomePage mockup）
- **关键 PR（计划）**：PR-A `/stats/today` + `/stats/sources` · PR-B `/stats/heat-curve` + `/stats/trending-keywords` · PR-C Web HomePage 接通 + CountUp + 抽 HeatCurve 到 packages/ui
- **里程碑**：完成后达成 §7.2 M5 MVP（个人可用 read-only 站点上线）

---

## 0. 决策摘要

> 沿用 SP-6/SP-7/SP-8 spec 范式：所有"为什么这么做、为什么不那么做"的判断集中在本节，让后续 §1-§9 可以直接读"做什么"而不用反复 justify。

| Q | 决策 | 替代方案 | 理由 |
|---|---|---|---|
| Q1 V1 范围边界 | **B：4 个新 stats endpoint + HomePage 全部接通真数据 + 抽 HeatCurve 到 packages/ui + 摘掉 MockupBanner** | A: 只接 stats-today 一个保持其他 mockup / C: 顺手把详情页一起做 | A 留 mockup 违和 / C 越界 SP-11；MVP 收官就是把 HomePage 唯一一个 mockup 页接通 |
| Q2 "关键词命中" stat 卡 V1 行为 | **B：V1 显示 24h 内 aiTags 命中条目数（`array_length(aiTags) > 0` 的行数）+ 卡 sub 改为"覆盖标签 N 个"** | A: 完整保留 mockup banner / C: 删除卡破坏 4 列对称 | A 文本卡里画 banner 散乱；C 破坏 Aurora 设计稿 4 列网格；B 让卡有真信号且语义自然，SP-14 上线时 sub 文案改回"用户监控命中"即可 |
| Q3 "我的提醒" 卡 V1 行为 | **B：V1 保留卡但内容改为占位 + disabled "管理监控" 按钮 + 顶部小灰字 "等 SP-17 接通"；卡的 mockup MiniSpark 暂时移除（避免假信号）** | A: 整张卡 mockup banner / C: 删卡破坏右栏视觉平衡 | 右栏 3 卡（增速 / 信源 / 提醒）是设计稿的视觉锚，删一个会让左栏热度榜单显得过宽；保留空壳子 + 明确的"SP-17 接通"提示比假数据安全 |
| Q4 trending-keywords 算法 | **B：last 24h aiTag 出现频次 vs prior 24h (24h-48h) 平均；`growthPct = (cur - prior) / max(prior, 1) * 100`；按 growthPct DESC 取 Top 8；prefix-stripped 展示** | A: 仅 24h 出现次数无增速概念 / C: 24h vs 7d 滑窗平均（更稳定但反应慢） | A 无"增速"语义对不上"📈 增速最快"卡名；C 7d 窗口 / 7d/24h ratio 计算复杂；B 24h vs 24h 是最简最直观的 momentum 指标，prod 800 行规模下噪声可接受，未来如有抖动可平滑到 7d 滑窗 |
| Q5 heat-curve 聚合方式 | **B：每小时桶取 MAX(heatScore)，RSS 行不参与（与 SP-6 `?sort=heat` RSS-exclusion 契约一致）；24 个桶 + 当前小时含 partial 数据正常显示** | A: COUNT(*) 不体现"热度" / C: AVG(heatScore) 被低分行拉低 | A 24h 抓取量已经在 stats-today 卡里露出；C avg 被 LOW 行稀释看不出 BURST 时段；B max(heatScore) 直观反映"那一小时的最热行有多热" |
| Q6 信源分布百分比基数 | **B：按 24h 内 VISIBLE 行数分布，4 个 Platform enum 值合计 100%，RSS 也计入（这里是"覆盖度"信号不是"热度"）** | A: 7d 窗口太久不反映"今日" / C: 排除 RSS 与 mockup 设计稿不符 | mockup 把 RSS 也画进了分布条；这是"我今天看到的内容里 X% 来自 HN"的覆盖度问题，而非"哪个平台更热"，RSS 必须计入 |
| Q7 API 模块归属 | **B：新建 `StatsModule` (StatsController + StatsService)，与 `HotNewsModule` 平级；路由 `/stats/*`** | A: 塞进 HotNewsModule / C: 拆 4 个 sub-module | A 违反单一职责；C 4 个 endpoint 一个 service 完全够，拆过细复杂度反弹 |
| Q8 cache 策略 | **A：所有 Stats API SSR + Web `fetch(cache: 'no-store')`；DB 直查不走 Redis cache** | B: Redis cache 5min TTL / C: Next ISR `revalidate: 60` | prod 800 行 × 4 query 全部 group by / count 在 GIN/B-tree 索引下 < 50ms 实测；YAGNI 不预优化；如果用户量上去触发 thunder herd 再加 cache 层（V2 钩子已留） |
| Q9 PR 拆分 | **C：3 个 PR（A: 2 个静态 stat API · B: 2 个聚合 stat API · C: web 接通）** | A: 单 PR 一锤定 / B: 6 个细 PR 一个 endpoint 一个 | 沿用 SP-6/7/8 PR-driven workflow；A/B 都是纯 API + 单测可独立 deploy + smoke（curl 验证 shape），C 才动 web；3 PR 是 review 友好度与 momentum 的平衡 |
| Q10 useCountUp 实现 | **A：新 client component `<CountUp>` 抽到 `packages/ui`，RAF tween + easeOutCubic + 1500ms duration + 仅 first-mount 跑（router refresh 不重 tween）** | B: framer-motion 依赖 / C: inline RAF 不抽组件 | B 引入 ~50kb dep 仅为一个数字滚动 YAGNI；C 不能复用到 SP-11 详情页互动数；A 与 Aurora HTML line 123 原版策略一致，复用度高 |
| Q11 HeatCurve 组件归属 | **B：抽到 `packages/ui` 作为 atom，消费 `props.data: number[]` + 可选 `props.labels?: string[]`；配色 token-driven（不再 hardcode `#7e57f5`）** | A: 保留 inline 在 page.tsx / C: 引 Recharts/ECharts 完整 chart lib | A 不可复用，SP-11 详情页 heat-history 趋势会重写一遍；C 5kb SVG 业务被 chart lib ~200kb 压死，性能损失大；B 24-point sparkline 用 SVG path 60 行写完 |
| Q12 数据 fetch 错误处理 | **B：HomePage RSC 直接 throw → Next 根级 `error.tsx` 兜底** | A: try/catch 显示 stat 卡 "—" placeholder / C: Suspense + `<ErrorBoundary>` | 沿用 `/news` 现有契约（SP-1 起 RSC 直接 throw）；A 半残页面 UX 差且掩盖问题；C ErrorBoundary RSC 不支持完整 hook，复杂 |
| Q13 测试策略 | **B：service unit 测（mock Prisma raw queries）+ controller passthrough 测；不开 db integration spec** | A: integration spec 直查 dev DB / C: e2e 起 webdriver | A 引入 SP-7 同款 `pnpm turbo run test` 并发 race（worker integration spec 同写 hot_news）；C 过重；B 与 SP-6/SP-7 service 单测一致 |
| Q14 RSC fetch 并行度 | **A：4 个 stat API 用 `Promise.all` 并行 await，不 streaming** | B: 串行 await / C: Suspense streaming | 4 个 query 互不依赖；A 总耗时 = max(4 query) ≈ 50ms；B 串行 4x；C streaming 复杂度不值（用户感知差异 < 100ms） |
| Q15 PageHeader sub 动态文案 | **A：用 stats-today 数据动态拼字符串 `已聚合 ${total} 条内容 · ${burstCount} 个爆发事件 · ${tagCount} 个 AI 标签覆盖`** | B: 完全保留 mockup 写死 / C: 加 client useState 动态 | A 是 RSC 最简洁形态；mockup 文案改成 "标签覆盖" 与 Q2 卡保持一致 |
| Q16 deploy 顺序 | **A：A merge → smoke (curl API) → B merge → smoke → C merge → smoke (browser /)** | B: A+B 合并后再 deploy / C: 全部 merged 后一次 deploy | 沿用 SP-6/7 三 PR 各自 deploy 后 smoke 的模式；任一 PR 出问题影响域被严格限制 |

---

## 1. 范围

### 1.1 In Scope（V1）

**新 API**（`apps/api`）

- `GET /stats/today` → 24h 4 个核心指标（aggregateCount / burstCount / taggedCount / sourceCount）
- `GET /stats/sources` → 24h 平台分布 + 每平台抓取量
- `GET /stats/heat-curve` → 24h 每小时 MAX(heatScore) 桶（24 个数据点）
- `GET /stats/trending-keywords` → 24h aiTag 增速 Top 8

**Web HomePage**（`apps/web/app/page.tsx`）

- 移除所有 hardcoded 数组（`STATS / TOP_NEWS / TRENDING_KEYWORDS / SOURCE_DISTRIBUTION / ALERTS / HEAT_CURVE`）
- 4 stats 卡接 `/stats/today`，数值套 `<CountUp>` 动画
- 热度榜单接 `/hot-news?sort=heat&pageSize=6&groupMode=fold`（复用现有 API）
- 增速最快卡接 `/stats/trending-keywords?limit=5`（mockup 5 行，留 3 行余量）
- 信源分布卡接 `/stats/sources`
- 我的提醒卡：保留卡壳子 + "等 SP-17 接通" 占位（MiniSpark 移除）
- 今日热度波形接 `/stats/heat-curve`
- PageHeader sub 动态拼接（aggregateCount / burstCount / taggedCount）
- 顶部 `<MockupBanner>` 移除
- `✨ 生成今日日报` 按钮保留但加 `disabled` + tooltip `"等 SP-21 AI 日报上线"`

**packages/ui 新组件**

- `<CountUp value={n} duration={1500} />` — RAF tween 数字滚动，first-mount only
- `<HeatCurve data={number[]} labels?={string[]} />` — 24-point sparkline SVG（含 fill gradient + 4 个 marker dot 节流采样）

### 1.2 Out of Scope（V2 / 后续 SP）

- ❌ "用户监控关键词" 真命中数 → SP-14（KeywordMonitor CRUD）→ SP-16（命中 worker）后才有真数据
- ❌ "我的提醒" 真通知列表 → SP-17（站内通知）
- ❌ `✨ 生成今日日报` 接通 → SP-21（AI 日报）
- ❌ Stats API Redis cache 层 → V2 触发条件：API p95 > 200ms 或单接口 RPS > 50
- ❌ HomePage SP-15 雷达徽标接通 → SP-15
- ❌ HeatCurve 实时刷新（轮询 / SSE） → V2，当前 RSC SSR 已经"每次 router refresh 拿新数据"够用
- ❌ MiniSpark 抽 packages/ui → SP-15 关键词监控页启动时一起做（届时是消费者，brainstorm props 设计）

### 1.3 不变量

- **API DTO 命名空间**：所有 stats DTO 集中在 `packages/types/src/dtos.ts`，与既有 `HotNewsListItemDto` 同文件
- **Stats SQL 全部用 `NOW() - INTERVAL 'X hours'`**，不在应用层算 Date 边界（避免 timezone drift；Postgres 默认 UTC，应用层 `new Date()` 也 UTC，但 SQL 字面量更清晰且无 race）
- **RSS heat 仍排除**（与 SP-6 §0 Q1/Q2 一致）：heat-curve 的 MAX(heatScore) 排除 RSS
- **Stats API 全部不依赖 KeywordMonitor / Notification 表**（这两个表 SP-14/SP-17 才激活），V1 不查它们

---

## 2. 数据契约

### 2.1 DTO（新增到 `packages/types/src/dtos.ts`）

```typescript
/**
 * SP-9 (2026-05-19): Today 4-card stats. All counters cover the last 24h
 * (NOW() - INTERVAL '24 hours' .. NOW()).
 *
 * - aggregateCount: total VISIBLE rows ingested in window
 * - burstCount: VISIBLE rows with heatLevel='BURST' in window
 * - taggedCount: VISIBLE rows where array_length(aiTags) > 0 in window
 *   (SP-14 contract: when KeywordMonitor lands, this field will be
 *   reinterpreted as user-monitored keyword hits; DTO field name stable)
 * - sourceCount: enabled SourceConfig rows that ingested at least one
 *   VISIBLE row in window (defensive: "covered" not "configured")
 */
export interface StatsTodayDto {
  aggregateCount: number;
  burstCount: number;
  taggedCount: number;
  sourceCount: number;
  /** Window cover: ISO timestamps of the [start, end) range, server-side computed for client display */
  windowStart: string;
  windowEnd: string;
}

/**
 * SP-9: Per-platform breakdown for the "信源分布" card. Percentages sum to
 * 100 (rounded; sum may be 99 or 101 due to rounding — UI tolerates).
 * RSS IS included here (coverage signal, not heat).
 */
export interface StatsSourcesDto {
  platforms: Array<{
    platform: 'TWITTER' | 'HACKERNEWS' | 'REDDIT' | 'RSS';
    count: number;
    /** 0-100 integer, rounded; sum across platforms ≈ 100 */
    pct: number;
  }>;
  /** Total VISIBLE rows in 24h across all platforms (basis for pct) */
  total: number;
  windowStart: string;
  windowEnd: string;
}

/**
 * SP-9: 24h heat curve bucketed by hour. Always returns 24 buckets,
 * oldest first. `buckets[23]` is the current (partial) hour. Each bucket
 * is MAX(heatScore) over VISIBLE non-RSS rows ingested in that hour;
 * empty hour buckets return 0.
 */
export interface HeatCurveDto {
  /** Length-24 array of MAX(heatScore) per hourly bucket, oldest first */
  buckets: number[];
  /** Length-24 array of "HH:00" labels matching buckets, oldest first */
  hourLabels: string[];
  windowStart: string;
  windowEnd: string;
}

/**
 * SP-9: AI tag momentum ranking. Computed as 24h-vs-prior-24h frequency
 * delta. `tag` is the raw prefix-encoded form (`company:openai`,
 * `model:claude-4`, etc.); `label` is the human-readable form
 * (`OpenAI`, `Claude 4`) with prefix stripped and underscore→space.
 *
 * `growthPct` semantics:
 *   - prior == 0 && cur > 0 → 9999 (sentinel "new"; UI may render "NEW")
 *   - prior > 0 → round((cur - prior) / prior * 100)
 *   - prior > 0 && cur == prior → 0
 *   - prior > 0 && cur < prior → negative (UI may filter or show)
 *
 * Returned sorted by growthPct DESC, then cur DESC (tiebreaker), then
 * tag ASC. UI takes the top-N caller specified via `?limit=`.
 */
export interface TrendingKeywordsDto {
  items: Array<{
    tag: string;          // 'company:openai'
    label: string;        // 'OpenAI'
    count24h: number;
    countPrior24h: number;
    growthPct: number;    // see semantics above; 9999 = NEW sentinel
  }>;
  windowStart: string;
  windowEnd: string;
}
```

### 2.2 API endpoints

| Method | Path | Query | Response |
|---|---|---|---|
| GET | `/stats/today` | — | `StatsTodayDto` |
| GET | `/stats/sources` | — | `StatsSourcesDto` |
| GET | `/stats/heat-curve` | — | `HeatCurveDto` |
| GET | `/stats/trending-keywords` | `?limit=N` (default 8, max 20) | `TrendingKeywordsDto` |

**统一行为**：

- `cache: 'no-store'` from Web fetch（fresh SSR per request）
- 4 endpoint **彼此独立**，无 shared state；任一失败不影响其它
- 失败 → 500 with `{ message: string }`，让 Next error.tsx 兜底
- 空数据合法返回：
  - `StatsTodayDto` → 4 个数字全 0，windowStart/End 仍填
  - `StatsSourcesDto` → `platforms: []`, `total: 0`
  - `HeatCurveDto` → `buckets: [0,0,...0]` (24 个 0)
  - `TrendingKeywordsDto` → `items: []`

### 2.3 SQL 草稿

> 实际 Prisma 查询用 `$queryRaw` 或 `groupBy`；这里列 SQL 形式让算法可读。

**stats/today**：

```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'VISIBLE'
                   AND "publishedAt" >= NOW() - INTERVAL '24 hours')                AS aggregate_count,
  COUNT(*) FILTER (WHERE status = 'VISIBLE'
                   AND "publishedAt" >= NOW() - INTERVAL '24 hours'
                   AND "heatLevel" = 'BURST')                                       AS burst_count,
  COUNT(*) FILTER (WHERE status = 'VISIBLE'
                   AND "publishedAt" >= NOW() - INTERVAL '24 hours'
                   AND array_length("aiTags", 1) > 0)                               AS tagged_count
FROM hot_news;

-- sourceCount 单独：去重已抓到内容的 enabled SourceConfig
SELECT COUNT(DISTINCT sc.id) AS source_count
FROM source_configs sc
INNER JOIN hot_news hn ON hn."sourcePlatform" = sc.platform
WHERE sc.enabled = TRUE
  AND hn.status = 'VISIBLE'
  AND hn."publishedAt" >= NOW() - INTERVAL '24 hours';
```

**stats/sources**：

```sql
SELECT "sourcePlatform"::text AS platform, COUNT(*)::int AS count
FROM hot_news
WHERE status = 'VISIBLE'
  AND "publishedAt" >= NOW() - INTERVAL '24 hours'
GROUP BY "sourcePlatform"
ORDER BY count DESC;
-- pct 在应用层算（避免 SQL ROUND 边界 case）
```

**stats/heat-curve**：

```sql
WITH hours AS (
  SELECT generate_series(0, 23) AS h
)
SELECT
  h,
  COALESCE(MAX(hn."heatScore"), 0) AS max_heat
FROM hours
LEFT JOIN hot_news hn
  ON hn.status = 'VISIBLE'
  AND hn."sourcePlatform" != 'RSS'
  AND hn."publishedAt" >= date_trunc('hour', NOW()) - INTERVAL '23 hours' + (h * INTERVAL '1 hour')
  AND hn."publishedAt" <  date_trunc('hour', NOW()) - INTERVAL '23 hours' + ((h + 1) * INTERVAL '1 hour')
GROUP BY h
ORDER BY h ASC;
-- 应用层填 hourLabels: 23h ago → now, "HH:00" format in server TZ (UTC)
-- 注意：buckets[23] 是当前 hour 桶，含 partial 数据，正常显示（mockup 第 24 个点是"现在"）
```

**stats/trending-keywords**：

```sql
WITH unnested AS (
  SELECT unnest("aiTags") AS tag, "publishedAt"
  FROM hot_news
  WHERE status = 'VISIBLE'
    AND "publishedAt" >= NOW() - INTERVAL '48 hours'
    AND array_length("aiTags", 1) > 0
),
buckets AS (
  SELECT
    tag,
    COUNT(*) FILTER (WHERE "publishedAt" >= NOW() - INTERVAL '24 hours')                       AS cur,
    COUNT(*) FILTER (WHERE "publishedAt" <  NOW() - INTERVAL '24 hours')                       AS prior
  FROM unnested
  GROUP BY tag
)
SELECT tag, cur, prior,
  CASE
    WHEN prior = 0 AND cur > 0 THEN 9999
    WHEN prior > 0 THEN ROUND(((cur::float - prior) / prior) * 100)::int
    ELSE 0
  END AS growth_pct
FROM buckets
WHERE cur > 0  -- 过滤纯历史 tag
ORDER BY growth_pct DESC, cur DESC, tag ASC
LIMIT $1;  -- $1 = limit param, default 8
-- 应用层 prefix-strip 算 label：'company:openai' → 'OpenAI'
```

---

## 3. Web 改动详细

### 3.1 `apps/web/app/page.tsx`（重写为 RSC）

```tsx
// Pseudo-code（实际见 PR-C 实现）

import { fetchStatsToday, fetchStatsSources, fetchHeatCurve, fetchTrendingKeywords, fetchHotNewsList } from '@/lib/api';

export default async function HomePage() {
  // 5 个 query 并行（4 stats + 1 hot list reuse）
  const [today, sources, heatCurve, trending, hotList] = await Promise.all([
    fetchStatsToday(),
    fetchStatsSources(),
    fetchHeatCurve(),
    fetchTrendingKeywords(5),
    fetchHotNewsList(1, 6, undefined /* default platforms */, 'heat'),
  ]);
  // ... render with real data, no MockupBanner, useCountUp on 4 stats
}
```

### 3.2 `apps/web/lib/api.ts` 新增 4 个 fetcher

```typescript
export async function fetchStatsToday(): Promise<StatsTodayDto> { ... }
export async function fetchStatsSources(): Promise<StatsSourcesDto> { ... }
export async function fetchHeatCurve(): Promise<HeatCurveDto> { ... }
export async function fetchTrendingKeywords(limit?: number): Promise<TrendingKeywordsDto> { ... }
```

共用 `fetchHotNewsList` 的 timeout / no-store / error handling 工具（已封装）。

### 3.3 `packages/ui` 新增

**`<CountUp value={n} duration={1500} />`**：

- `"use client"` directive
- `useEffect(() => { ... }, [])` first-mount only（依赖空数组）
- RAF loop：`now / start / progress = (now - start) / duration` → `easeOutCubic(progress)` → `Math.round(value * eased)`
- 用 `useState` 持有 current display 值
- 暴露 `className?` + 父元素 inline style（与 mockup 的 36px / letter-spacing -0.03em / color 兼容）

**`<HeatCurve data={number[]} labels?={string[]} maxY?={number} />`**：

- 默认 `maxY=100`，`data.length` 任意（mockup 24，未来可复用 6/12/etc）
- SVG path + linear gradient（紫色锚定 Aurora token，不再 hardcode `#7e57f5`）
- 节流 marker dot：`labels` 提供时按 `labels` 长度划分；否则每 4 点一个 dot
- 配色：`var(--c1)` 主紫 + `var(--c2)` 暖紫渐变 + `var(--c1)/30` fill
- 不消费 `useEffect`，纯 SSR-friendly

### 3.4 Mockup 数据全部删除

`apps/web/app/page.tsx` 顶部 6 个 const 数组（`STATS / TOP_NEWS / TRENDING_KEYWORDS / SOURCE_DISTRIBUTION / ALERTS / HEAT_CURVE`）全部删除；inline 的 `HeatCurve` / `MiniSpark` 函数（mockup 用的）也删除（HeatCurve 抽到 packages/ui，MiniSpark 等 SP-15 一起搬）。

---

## 4. 实施拆分

### PR-A：`/stats/today` + `/stats/sources` API

**文件**：

- 新建 `apps/api/src/stats/stats.module.ts`
- 新建 `apps/api/src/stats/stats.controller.ts`
- 新建 `apps/api/src/stats/stats.service.ts`
- 新建 `apps/api/src/stats/stats.service.spec.ts`
- 新建 `apps/api/src/stats/stats.controller.spec.ts`
- 修改 `apps/api/src/app.module.ts` 注册 StatsModule
- 修改 `packages/types/src/dtos.ts` 加 `StatsTodayDto` + `StatsSourcesDto`
- 修改 `packages/types/src/index.ts` re-export 新 DTO（如适用）

**Service 方法**：

- `getToday(): Promise<StatsTodayDto>` — 跑 §2.3 stats/today SQL（2 个 query，可一次 `$transaction([..., ...])` 或一个 raw SQL 两个 SELECT）
- `getSources(): Promise<StatsSourcesDto>` — 跑 §2.3 stats/sources SQL + 应用层算 pct

**单测**：

- `getToday` mock Prisma 验证 aggregate=0/burst=0/tagged=0/source=0 边界 + 非零 case
- `getSources` mock Prisma 验证 pct 总和（rounding case 故意 33.33 / 33.33 / 33.33 → 33/33/34 验证）
- `getSources` 空数组 case → `platforms: [], total: 0`
- Controller passthrough 测（mock service）

**deploy 验收**：

```bash
curl https://hotnews.shinpeionline.top/api/stats/today | jq
curl https://hotnews.shinpeionline.top/api/stats/sources | jq
# 4 个数字 + 4 平台分布，sum(pct) ≈ 100
```

### PR-B：`/stats/heat-curve` + `/stats/trending-keywords` API

**文件**：

- StatsController / StatsService 加 2 个新方法
- StatsService.spec / StatsController.spec 加新用例
- `packages/types/src/dtos.ts` 加 `HeatCurveDto` + `TrendingKeywordsDto`

**Service 方法**：

- `getHeatCurve(): Promise<HeatCurveDto>` — 跑 §2.3 stats/heat-curve SQL；应用层生成 hourLabels（"HH:00" UTC format，与 mockup 6h 间隔 5 个 label 不一致但 UI 自己处理）
- `getTrendingKeywords(limit: number): Promise<TrendingKeywordsDto>` — 跑 §2.3 stats/trending-keywords SQL；应用层 prefix-strip label

**Label 转换规则**（应用层）：

```typescript
function stripTagLabel(tag: string): string {
  // 'company:openai' → 'OpenAI'
  // 'model:claude-4' → 'Claude 4'  (kebab-case → Title Case + space)
  // 'category:research' → 'Research'
  // 'tech:rag' → 'RAG'  (acronym preserve)
  const [, raw] = tag.split(':');
  if (!raw) return tag;
  // 1) split on - / _
  const parts = raw.split(/[-_]/);
  // 2) preserve all-caps acronyms (RAG, LLM, AI, GPU); else Title-case
  return parts.map(p => /^[a-z]{2,4}$/.test(p) && KNOWN_ACRONYMS.has(p) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

// KNOWN_ACRONYMS 是 packages/prompts 受控词表中已知的缩写白名单：rag / llm / ai / gpu / api / sdk / mcp
```

> KNOWN_ACRONYMS 不在 `packages/prompts/taxonomy` 里写死，而在 `packages/utils/src/tag-label.ts` 新建模块；理由：tag→label 是 UI 展示层关心的事，与 LLM prompt 词表正交。**实际清单见 PR-B 实现**，先列已知必要项（rag/llm/ai/gpu/api/sdk/mcp），后续观察 trending 输出再追加。

**单测**：

- `getHeatCurve` mock Prisma 24 桶（含空桶 → 0 兜底）
- `getHeatCurve` RSS 行不参与（用 mock 数据混 RSS + HN 验证只取 HN max）
- `getTrendingKeywords` 4 种 growthPct case：
  - prior=0, cur=5 → 9999 sentinel
  - prior=10, cur=15 → 50
  - prior=10, cur=5 → -50
  - prior=10, cur=10 → 0
- `getTrendingKeywords` 排序稳定性（growthPct DESC, cur DESC, tag ASC）
- `stripTagLabel` 单测覆盖 4 个 prefix + acronym preserve + 多段 kebab

**deploy 验收**：

```bash
curl https://hotnews.shinpeionline.top/api/stats/heat-curve | jq '.buckets | length'  # 24
curl https://hotnews.shinpeionline.top/api/stats/trending-keywords?limit=5 | jq '.items | length'  # ≤ 5
```

### PR-C：Web HomePage 接通 + CountUp + HeatCurve 抽 packages/ui

**文件**：

- 新建 `packages/ui/src/atoms/CountUp.tsx` + `CountUp.spec.tsx`
- 新建 `packages/ui/src/atoms/HeatCurve.tsx` + `HeatCurve.spec.tsx`
- 修改 `packages/ui/src/index.ts` re-export
- 修改 `apps/web/lib/api.ts` 加 4 个 fetcher
- 修改 `apps/web/app/page.tsx` 重写为 RSC（删 6 个 mockup 数组 + 删 inline HeatCurve/MiniSpark）
- 修改 `apps/web/app/page.spec.tsx`（如果有则更新；目前 apps/web 没 vitest 不会有）

**单测**：

- `CountUp` 测初始值 = 0、最终值 = target、duration 后达到 target（用 `vi.useFakeTimers()` + RAF stub）
- `CountUp` 测 first-mount only（value prop 变化不重新 tween）
- `HeatCurve` 测 SVG path 形态（pts 数量 = data.length）
- `HeatCurve` 测空数组兜底（不 throw）

**deploy 验收**：

- 浏览器访问 `https://hotnews.shinpeionline.top/`
  - [ ] MockupBanner 不再出现
  - [ ] 4 stats 卡显示真数字 + 从 0 → target 滚动动画
  - [ ] 热度榜单 6 行真数据，HeatBadge 颜色正确
  - [ ] 增速最快 5 行真 aiTag + 真 growthPct
  - [ ] 信源分布 4 平台真 pct
  - [ ] 我的提醒卡显示占位 + "等 SP-17 接通" 小字
  - [ ] 今日热度波形 24 点真数据，max 桶对应 BURST 时段
  - [ ] PageHeader sub 文案动态拼接
  - [ ] `✨ 生成今日日报` 按钮 disabled + hover tooltip
- 网络面板：
  - [ ] `/stats/today / sources / heat-curve / trending-keywords` 4 个 200，total p95 < 200ms

---

## 5. 风险 + 退路

| 风险 | 概率 | 影响 | Mitigation |
|---|---|---|---|
| `stats/heat-curve` 的 `generate_series` + LEFT JOIN 在 800 行规模下慢 | 低 | API 慢 | EXPLAIN ANALYZE 预跑；prod 实测 < 50ms 通过 |
| `stats/trending-keywords` 的 `unnest` 在 aiTags 规模放大 10x（8k 行）后慢 | 低 | API 慢 | 现已有 `publishedAt` B-tree 索引；如真慢加 GIN on aiTags |
| `unnest` 在 partial aiTags（null / empty array）行触发 NULL handling 出 bug | 中 | API 错 | `array_length(aiTags, 1) > 0` filter + COUNT FILTER 兜底；单测覆盖 |
| `growthPct = 9999` sentinel 在 UI 显示成 "+9999%" 滑稽 | 中 | UX | UI 在 `>= 9999` 时改显示 "NEW"（不是真数字）；PR-C 实施时注意 |
| RAF tween 在 SSR hydration 时初始值闪烁（先显示 target 后跳回 0） | 中 | UX | `<CountUp>` 初始 `useState(0)`，hydration 后 useEffect 启动 RAF；初始 SSR HTML 也输出 0 而非 target，保持一致 |
| HeatCurve 第 24 桶（当前小时）数据极少（partial）显示 0 误导 | 中 | UX | mockup 设计稿 line 24（"现在"）也是 partial 完全符合预期；不修；UI label 把第 24 个标"现在"而非具体时间 |
| 我的提醒卡保留空壳子让用户疑惑 | 低 | UX | 卡 sub 明写 "等 SP-17 接通"；不修 |
| `sourceCount=4` 永远是 4（4 个 Platform enum 都活跃）信号无价值 | 中 | UX | mockup 设计稿 line 54 文案就是 "4 · 全部在线"，符合预期；当某平台 24h 内 0 抓取时降到 3 会触发用户注意 |
| Stats DTO 与 HotNewsListItemDto 同 file 累积过多 | 低 | 可维护性 | 后续 SP-11/12 加更多 DTO 时再拆分 `dtos/` 文件夹；YAGNI |

---

## 6. 测试矩阵

| 层级 | 范围 | 工具 |
|---|---|---|
| utils unit | `stripTagLabel` (PR-B) | vitest |
| service unit | StatsService 4 方法各 3-6 个 case | vitest + mock Prisma |
| controller unit | StatsController passthrough（4 endpoint） | vitest + mock service |
| ui unit | `<CountUp>` / `<HeatCurve>` (PR-C) | vitest + jsdom + RTL（packages/ui 已有 infra） |
| 部署 smoke | curl 4 endpoint shape + browser 访问 `/` 完整渲染（PR-A/B/C 各自） | 人肉 |

**不开**：apps/web 集成测试（沿用 SP-8 YAGNI 政策）、db integration spec（沿用 SP-7 mock-only 政策）、e2e。

---

## 7. 升级钩子（V2 / 未来 SP 候选）

| 钩子 | 触发时机 | 改动 |
|---|---|---|
| Stats Redis cache 层 | API p95 > 200ms 或 RPS > 50 | `StatsService` 加 `@ai-hot-news/cache` workspace 包 + 5min TTL；当前 YAGNI |
| stats/keyword-hits 真实命中 | SP-14 KeywordMonitor + SP-16 命中 worker 上线 | StatsTodayDto.taggedCount 改语义为"用户监控命中"；DTO 字段不变 |
| stats/alerts 真实通知 | SP-17 站内通知 | 我的提醒卡占位换成真 Notification 列表；新 `/stats/recent-alerts?limit=3` endpoint |
| stats/heat-curve 实时刷新 | 用户反馈 | 卡加 `<button onClick=router.refresh()>` 或 SWR 30s 轮询 |
| 时段切换 | 用户反馈 | API 加 `?window=24h/7d/30d` query；DTO windowStart/End 已经留 |
| 移动端断点 | 用户反馈 | 与 SP-8 同款 V2 |
| MiniSpark 抽 packages/ui | SP-15 启动 | "我的提醒" 卡真 alerts 接通时一并抽 |
| StatsService 拆 sub-service | StatsService.spec 行数 > 600 | 拆 4 个 sub-service 各管一个 endpoint；YAGNI |

---

## 8. 部署 checklist

### 8.1 PR-A 部署后

- [ ] CI 全绿 + Deploy 完成
- [ ] `curl https://hotnews.shinpeionline.top/api/stats/today` 返回 4 个数字 + windowStart/End
- [ ] `curl https://hotnews.shinpeionline.top/api/stats/sources` 返回 ≤ 4 个平台 + pct 总和 ≈ 100
- [ ] EXPLAIN ANALYZE 在 prod 上跑一次确认 < 50ms

### 8.2 PR-B 部署后

- [ ] `curl .../api/stats/heat-curve | jq '.buckets | length'` = 24
- [ ] `curl .../api/stats/heat-curve | jq '[.buckets[] | select(. > 0)] | length'` > 0（确认有非零桶）
- [ ] `curl .../api/stats/trending-keywords?limit=5 | jq '.items | length'` ≤ 5 且 ≥ 0
- [ ] trending-keywords 输出至少一个 `growthPct=9999` (NEW sentinel) 或具体百分比

### 8.3 PR-C 部署后

- [ ] 浏览器访问 `/`：
  - [ ] MockupBanner 不见
  - [ ] 4 stats 卡数字滚动到位
  - [ ] 热度榜 6 行真数据，BURST 行徽章颜色对
  - [ ] 增速最快 5 行 prefix-stripped label（不显示 "company:" 前缀）
  - [ ] 信源分布 4 条进度条，宽度 = pct
  - [ ] 我的提醒卡显示占位（无假数据）
  - [ ] 今日热度波形渲染（含 partial 当前小时）
  - [ ] PageHeader sub 显示真 aggregate / burst / tagged
  - [ ] `✨ 生成今日日报` disabled + tooltip 显示
- [ ] DevTools 网络面板：4 个 stats request 200 + total < 200ms

---

## 9. 决策日志（Decision Log）

| 日期 | 决策 | 替代 | 理由 |
|---|---|---|---|
| 2026-05-19 | V1 全面接通 4 stats endpoint + HomePage 重写 | 只接 stats-today 保持其他 mockup | A 留 mockup 违和；MVP 收官必须把 HomePage 唯一 mockup 接通 |
| 2026-05-19 | "关键词命中" V1 显示 24h aiTags 覆盖条目数 | 完整 mockup banner / 删卡 | 让卡有真信号且 SP-14 上线时只改 sub 文案 |
| 2026-05-19 | "我的提醒" V1 保留卡壳子 + "等 SP-17" 占位 | mockup banner / 删卡 | 保持右栏视觉平衡；占位语义明确比假数据安全 |
| 2026-05-19 | trending-keywords 算法 24h vs 24h delta | 仅 24h 频次 / 24h vs 7d 滑窗 | 最简的"增速"语义，prod 800 行规模噪声可接受；未来如抖动可平滑 |
| 2026-05-19 | heat-curve 每小时桶取 MAX(heatScore) | COUNT(*) / AVG(heatScore) | 直观反映"那小时最热行有多热"，AVG 被 LOW 行稀释 |
| 2026-05-19 | 信源分布百分比包含 RSS | 排除 RSS | mockup 包含；这里是覆盖度信号不是热度信号 |
| 2026-05-19 | 新建 StatsModule 平级 HotNewsModule | 塞进 HotNewsModule | 单一职责；4 endpoint 一个 service 是合适尺寸 |
| 2026-05-19 | SSR + no-store + DB 直查无 Redis cache | Redis cache / Next ISR | YAGNI；prod 800 行 × 4 query 全部 < 50ms 实测目标；V2 钩子已留 |
| 2026-05-19 | 三 PR（A/B/C）拆 | 单 PR / 六 PR | 与 SP-6/7/8 PR-driven 一致；A/B 纯 API 独立 deploy + smoke |
| 2026-05-19 | CountUp RAF tween，first-mount only | framer-motion / inline | 50kb 依赖 vs ~30 行 RAF 自己写；first-mount only 避免 router refresh 重 tween |
| 2026-05-19 | HeatCurve 抽 packages/ui，token-driven 配色 | inline / Recharts | 5kb SVG vs ~200kb chart lib；SP-11 详情页 heat-history 直接复用 |
| 2026-05-19 | RSC throw → Next error.tsx 兜底 | try/catch / Suspense+ErrorBoundary | 沿用 /news 既有契约 |
| 2026-05-19 | service mock prisma 单测，不开 db integration | integration spec / e2e | SP-7 同款 turbo 并发 race 教训 |
| 2026-05-19 | 4 stat API + 1 hot list 用 Promise.all 并行 | 串行 / Suspense streaming | 互不依赖；总耗时 = max ≈ 50ms 已经足够 |
| 2026-05-19 | PageHeader sub 动态拼字符串 | 留 mockup / client useState | RSC 最简洁形态 |
| 2026-05-19 | 三 PR 各自 deploy + smoke 后再 merge 下一个 | 合并 deploy / 全部后 deploy | 沿用 SP-6/7 的故障域隔离模式 |
| 2026-05-19 | KNOWN_ACRONYMS 白名单放 packages/utils/src/tag-label.ts | 放 packages/prompts/taxonomy | tag→label 是 UI 展示层关心的事，与 LLM prompt 词表正交 |
| 2026-05-19 | growthPct=9999 sentinel + UI 显示 "NEW" | 显示 "+9999%" | sentinel 语义清晰；防止数学上 division-by-zero 时丢信息 |

---

## 10. Errata（修订记录）

（首版无修订；后续如 PR 实施时发现偏差，按 SP-8 §13 范式追加。）

---

## 11. 与既有 SP 的契约关系

- **复用 SP-6 `heatScore` / `heatLevel`**：stats/today 的 burstCount 和 stats/heat-curve 的 MAX(heatScore) 都直接读 SP-6 在线计算 + 30min cron 重算的字段
- **复用 SP-7 `groupId`**：本 SP **不消费** groupId（HomePage 热度榜单是 group-folded 形态，但那是 `/hot-news?groupMode=fold` 现有 API 行为；stats 4 endpoint 都是直接基于 `hot_news` 表的 row-level 聚合，不区分 group/singleton）
- **复用 SP-5 `aiTags`**：stats/today 的 taggedCount 和 stats/trending-keywords 全部消费 aiTags 数组
- **不动 schema**：本 SP **零 migration**；纯新 API + 纯 web 改动；任何想动 schema 的诉求（如加 `HotNewsStatsHourly` 物化视图）都是 V2 升级钩子
- **不动 worker**：本 SP 与 worker 完全无交集

---

## 12. 实施开始前的工程约束 checklist

- [ ] PR-A / B / C 全程沿用 PR-driven workflow（each PR ≤ 600 lines diff + 各自 smoke）
- [ ] StatsService 不直接 import Prisma Client 单例，必须走 `getPrisma()` from `@ai-hot-news/db`（与 HotNewsService 一致）
- [ ] Stats DTO 字段名与 §2.1 严格一致，PR-A 写完后 PR-B 不重命名
- [ ] PR-C 前必须 PR-A + PR-B 已 merge 且 prod smoke 通过（否则 web 接通时 404 / 500）
- [ ] 三个 PR description 都要写 "Smoke check" 段，列 curl 命令 + 期望 jq 输出 shape
