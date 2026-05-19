# SP-11 — 详情页 `/news/[id]` + heat_history 时序表

- **状态**：spec draft（自主决策，不阻塞用户）
- **前置 SP**：
  - SP-6（heat score + cron 30min 全量重算）—— heat_history 复用同一 cron，不再起新 worker
  - SP-7（cross-platform merge，`hotNews.groupId`）—— 详情页 Related 用 groupId 关联
  - SP-9（HomePage + `<HeatCurve>` atom）—— atom 已支持 24/48/72 点折线图，本 SP 直接复用
- **本文件**：`docs/superpowers/specs/2026-05-19-sp11-detail-page-heat-history-design.md`
- **预计工作量**：~1.5 天（schema + worker delta ~3h；API ~3h；Web page ~5h；测试覆盖 ~2h）
- **拆分**：3 个 PR（A schema+worker → B API → C Web RSC）
- **M5 → M6 桥**：SP-9 已经把 M5 MVP 跑通；SP-11 是 M6 第一刀，目的是把 list/dashboard 之外**唯一缺失的页面骨架**补齐，后续 SP-12（搜索）/ SP-14（用户监控）都基于详情页提供入口

---

## 0. 关键设计决策（自主拍板，符合 PR-driven 节奏）

| #   | 维度                   | 选择                                                                                                  | 理由                                                                                  |
| --- | -------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Q1  | URL 形态               | `/news/[id]`，`id = hotNews.id` (cuid)                                                                | slug 没意义（标题非唯一、含 CJK 不利于 URL），cuid 已是 `@unique`，路由零成本                              |
| Q2  | heat_history 表是否新建   | **新建** `heat_history` (snapshot 表)                                                                  | 现有 `hot_news.heatScore` 只是当前值；详情页要画 48h 折线必须有时序快照；放主表会导致 BURST 文章数据膨胀 24×          |
| Q3  | Bucket 粒度            | **30 min**                                                                                          | 与 SP-6 heat-cron 节奏天然对齐（30min 一次），保证每次 cron 写 1 bucket、不会出现 sub-resolution 插值      |
| Q4  | Bucket 锚定            | `date_trunc('hour', now()) + (floor(extract(minute from now())/30) * interval '30 min')`           | 半点对齐；保证 bucketAt 永远落在 :00 或 :30，便于前端 label 显示                                       |
| Q5  | 写入语义                 | UPSERT `ON CONFLICT(hotNewsId, bucketAt) DO UPDATE SET heatScore=EXCLUDED, heatLevel=EXCLUDED`     | cron 出现两次同 bucket 调用（重试、手动触发）时幂等；不会出现 P2002                                         |
| Q6  | 写入触发点                | SP-6 `processHeatRefreshJob` 内 — `prisma.hotNews.update` 之后立即 upsert history                          | 复用已有事务、复用 ranked NTILE 阶段算出的 heatLevel；不引入第二个 worker job                            |
| Q7  | 写入范围                 | **仅 `status=VISIBLE` 且 `sourcePlatform!=RSS` 且 `publishedAt` 在 48h 窗口内**                            | 与 heat 算分窗口完全一致；RSS 永远不参与 heat（SP-6 Q2）                                              |
| Q8  | 保留 / TTL             | V1 **不删**（每天 ~9.6k 行，30 天 ~290k；占盘 < 50 MB），保留作为后续 SP-13 burst alert 训练样本                          | 加 TTL 触发器是 future（SP-16+）；现在加是 YAGNI                                                |
| Q9  | Detail API path      | `GET /hot-news/:id`（单条 + related）+ `GET /hot-news/:id/heat-history?hours=48`                          | 资源型路径，跟 list endpoint 对齐；hours 仅 24/48/72 三档（Pipe 校验）                              |
| Q10 | Detail DTO 是否复用 list | **不复用**：list 用 `HotNewsItemDto`（含 fold 计数），detail 用 `HotNewsDetailDto`（含 `relatedItems[]` + 原始 raw fields） | list 字段是 UI summary 视角；detail 要返回 `content` 全文、`extractStatus`、`crawledAt` 等运维字段 |
| Q11 | Related items 语义     | 同 `groupId` 且 `id != self`，按 heatScore DESC，最多 5 条；如果 groupId=null，则 fallback 同 `aiTags` 任一交集，TOP 5  | groupId 是 SP-7 cross-platform merge 结果，已是"同一事件不同平台/角度"；aiTags fallback 处理刚抓未聚类的孤儿 |
| Q12 | 缓存                   | V1 **不加 Redis**，与 SP-9 同策略（数据量小，cuid 命中率不可预测）                                                       | SP-9 Q5 已经定基调；后续 SP-15 CDN 时统一加                                                    |
| Q13 | 错误页                  | `notFound()` 直走 Next 15 的 `not-found.tsx`（已有 fallback "页面未找到"）                                       | 不重新设计 404 风格；Aurora 主题底色由 layout 提供                                                 |
| Q14 | HeatCurve 复用         | 直接传 `data` 长度 = 96 的数组，`labels=['48h 前', '36h', '24h', '12h', '现在']` (5 个稀疏 label)                  | atom 已支持任意长度；本 SP 不改 atom 内部逻辑                                                     |
| Q15 | 时间显示                 | publishedAt 用相对时间 (`2 hours ago`) + 绝对 (`May 19, 2026 14:30 UTC`)；用 `Intl.RelativeTimeFormat`        | 与 Aurora 现有 `news-item.tsx` 风格一致；不引入 dayjs                                          |
| Q16 | "返回" 入口              | 详情页左上 sticky `<a href="/news">← 热点流</a>`；不依赖浏览器 back（保留 / refresh 时仍有出口）                              | UX 一致性 + RSC 友好                                                                    |
| Q17 | 测试边界                 | schema migration smoke / worker history upsert / API 4 case / web page 仅做 component-render snapshot   | RSC 页面 e2e 留 Playwright（独立 SP-19）                                                  |
| Q18 | PR 拆分                | 3 个：A=schema+worker / B=API / C=Web                                                                  | 与 SP-9 同节奏；每个 PR review 大小 < 400 行                                                  |

---

## 1. 目标与硬验收标准

### 1.1 目标

1. **数据**：每条 visible hot_news 在其 48h 活跃期内每 30min 留一条 heat snapshot。
2. **API**：前端可一次拉到详情 + 相关 + 时序，三个调用并行 `< 200ms` p95（本机 docker network）。
3. **UI**：详情页布局可视化质量与 SP-9 HomePage 一致（Aurora glass card + fade-up 动画），HeatCurve 48h 时序图可读。
4. **零回归**：不影响 list / dashboard / heat cron / 现有 deploy pipeline。

### 1.2 硬验收

```bash
# A. Schema 落地
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U ai_hot_news -d ai_hot_news_prod -c "\d heat_history"'
# 必须返回 5 列 + 1 unique + 1 index

# B. Worker 写入
# 等一次 heat cron (≤30min) 后:
ssh ai-hot-news-prod '... psql ... -c "SELECT count(*) FROM heat_history WHERE \"bucketAt\" >= now() - interval '\''1 hour'\'';"'
# 应 >= visible 48h 行数（≈170）

# C. API
curl -sS https://hotnews.shinpeionline.top/api/hot-news/<id>          # 200, 含 relatedItems []
curl -sS https://hotnews.shinpeionline.top/api/hot-news/<id>/heat-history?hours=48  # 200, items.length<=96

# D. Web
curl -sS https://hotnews.shinpeionline.top/news/<id> | grep -q 'HeatCurve\|polyline'
# HTML 必含 polyline；title、summary、relatedItems 链接均在 HTML 内（RSC SSR）

# E. 回归
curl -sS https://hotnews.shinpeionline.top/api/stats/today        # SP-9 仍 200
curl -sS https://hotnews.shinpeionline.top/api/hot-news?pageSize=1 # list 仍 200
```

---

## 2. 数据模型

### 2.1 新表 `heat_history`

```prisma
model HeatHistory {
  id         String    @id @default(cuid())
  hotNewsId  String
  bucketAt   DateTime  // 半点对齐：:00 或 :30
  heatScore  Float
  heatLevel  HeatLevel

  hotNews    HotNews   @relation(fields: [hotNewsId], references: [id], onDelete: Cascade)

  @@unique([hotNewsId, bucketAt])
  @@index([hotNewsId, bucketAt(sort: Desc)])
  @@index([bucketAt(sort: Desc)])  // 全局时间扫描备用
  @@map("heat_history")
}
```

`HotNews` 反向关系：

```prisma
model HotNews {
  // ... 已有字段 ...
  heatHistory HeatHistory[]
}
```

Migration name：`add_heat_history`

### 2.2 不修改

- `HotNews.heatScore` / `heatLevel`：仍是"当前值"，list / sort 全部继续读这两列。
- SP-6 cron 的 SQL NTILE 重排不变；heat_history 只是 snapshot 旁路。

---

## 3. Worker 改造（PR-A）

`apps/worker/src/heat/heat.cron.processor.ts` 增量：

```typescript
// 在 prisma.hotNews.update 循环后 + NTILE 之前的位置，
// 注入 history upsert（在同一事务里）:
const bucketAt = computeBucketAt(now); // 半点对齐

await prisma.$executeRaw`
  INSERT INTO heat_history ("id", "hotNewsId", "bucketAt", "heatScore", "heatLevel")
  SELECT
    'h_' || substr(md5(random()::text), 1, 24),
    h.id,
    ${bucketAt}::timestamp,
    h."heatScore",
    h."heatLevel"
  FROM hot_news h
  WHERE h.status = 'VISIBLE'
    AND h."sourcePlatform" != 'RSS'
    AND h."publishedAt" > now() - interval '48 hours'
  ON CONFLICT ("hotNewsId", "bucketAt")
  DO UPDATE SET
    "heatScore" = EXCLUDED."heatScore",
    "heatLevel" = EXCLUDED."heatLevel"
`;
```

注意：

- **必须在 NTILE 之后写**，保证 `heatLevel` 是新值；上面流程已经先 update score → NTILE recompute level，本 statement 紧贴 NTILE 后即可。
- `id` 用 `'h_' || substr(md5(random()::text), 1, 24)` 模仿 cuid 形态；纯 raw SQL 避免 N+1 prisma create。
- `computeBucketAt(date: Date): Date` 单元测试覆盖：14:14 → 14:00，14:29 → 14:00，14:30 → 14:30，14:59 → 14:30。

### 3.1 Cron 频率

不变（30min）。SP-6 配置 `HEAT_REFRESH_INTERVAL_MS=1800000` 保留。

---

## 4. API（PR-B）

### 4.1 新增 endpoint

```typescript
@Controller('hot-news')
export class HotNewsController {
  @Get(':id')
  async detail(@Param('id') id: string): Promise<HotNewsDetailDto> {
    const item = await this.service.detail(id);
    if (!item) throw new NotFoundException();
    return item;
  }

  @Get(':id/heat-history')
  async heatHistory(
    @Param('id') id: string,
    @Query('hours', new DefaultValuePipe(48), ParseIntPipe) hoursRaw: number,
  ): Promise<HeatHistoryDto> {
    const hours = [24, 48, 72].includes(hoursRaw) ? hoursRaw : 48;
    return this.service.heatHistory(id, hours);
  }
}
```

### 4.2 Service 草案

```typescript
async detail(id: string): Promise<HotNewsDetailDto | null> {
  const item = await prisma.hotNews.findUnique({
    where: { id },
    select: { /* full row */ }
  });
  if (!item) return null;

  let related = [];
  if (item.groupId) {
    related = await prisma.hotNews.findMany({
      where: { groupId: item.groupId, id: { not: id }, status: 'VISIBLE' },
      orderBy: { heatScore: 'desc' },
      take: 5,
      select: { id, title, titleZh, sourcePlatform, heatScore, heatLevel, publishedAt }
    });
  }
  if (related.length === 0 && item.aiTags.length > 0) {
    // Fallback: any aiTag overlap, exclude self
    related = await prisma.hotNews.findMany({
      where: { aiTags: { hasSome: item.aiTags }, id: { not: id }, status: 'VISIBLE' },
      orderBy: { heatScore: 'desc' },
      take: 5,
      select: { id, title, titleZh, sourcePlatform, heatScore, heatLevel, publishedAt }
    });
  }

  return { ...item, relatedItems: related };
}

async heatHistory(id: string, hours: number): Promise<HeatHistoryDto> {
  const items = await prisma.heatHistory.findMany({
    where: {
      hotNewsId: id,
      bucketAt: { gte: new Date(Date.now() - hours * 3600_000) }
    },
    orderBy: { bucketAt: 'asc' },
    select: { bucketAt: true, heatScore: true, heatLevel: true }
  });
  return {
    items,
    windowStart: new Date(Date.now() - hours * 3600_000).toISOString(),
    windowEnd:   new Date().toISOString(),
    hours,
  };
}
```

### 4.3 DTO（`packages/types/src/dtos.ts`）

```typescript
export interface HotNewsRelatedDto {
  id: string;
  title: string;
  titleZh: string | null;
  sourcePlatform: Platform;
  heatScore: number;
  heatLevel: HeatLevel;
  publishedAt: string;
}

export interface HotNewsDetailDto {
  id: string;
  title: string;
  titleZh: string | null;
  summary: string | null;
  content: string;
  sourcePlatform: Platform;
  sourceUrl: string;
  author: string | null;
  publishedAt: string;
  crawledAt: string;
  aiTags: string[];
  matchedKeywords: string[];
  heatScore: number;
  heatLevel: HeatLevel;
  groupId: string | null;
  extractStatus: string | null;
  relatedItems: HotNewsRelatedDto[];
}

export interface HeatHistoryItemDto {
  bucketAt: string;
  heatScore: number;
  heatLevel: HeatLevel;
}

export interface HeatHistoryDto {
  items: HeatHistoryItemDto[];
  windowStart: string;
  windowEnd: string;
  hours: 24 | 48 | 72;
}
```

---

## 5. Web RSC 页面（PR-C）

### 5.1 文件

```
apps/web/app/news/[id]/page.tsx        ← RSC
apps/web/app/news/[id]/not-found.tsx   ← 走 layout.tsx 的全局 NotFound 即可，无需新增
apps/web/lib/api.ts                    ← fetchHotNewsDetail + fetchHeatHistory
```

### 5.2 数据获取

```typescript
export const dynamic = 'force-dynamic';

export default async function NewsDetail({ params }: { params: { id: string } }) {
  const id = params.id;
  const [item, history] = await Promise.all([
    fetchHotNewsDetail(id).catch(() => null),
    fetchHeatHistory(id, 48).catch(() => null),
  ]);
  if (!item) notFound();
  // ...
}
```

`notFound()` 走 Next 15 默认 `not-found` 边界，由 `apps/web/app/not-found.tsx`（已有 mockup 期间的"页面未找到"）渲染。

### 5.3 布局结构

```
┌─ <PageHeader> Hot News › Detail ───────────────────────────────┐
│                                                                │
│ ← 热点流                                                        │
│                                                                │
│ ┌─ Hero (Glass) ──────────────────────────────────────────────┐│
│ │ [Pill platform] [HeatBadge level] [time-ago · UTC]          ││
│ │ <H1> title (CN if exists) </H1>                              ││
│ │ <p>  title (orig)         </p>                               ││
│ │ author · view source ↗                                       ││
│ └─────────────────────────────────────────────────────────────┘│
│                                                                │
│ Two-column 1.7fr / 1fr:                                        │
│  Left  → Glass: 摘要 + content (truncate 长内容)                  │
│         Glass: AI 标签 (aiTag chips)                            │
│  Right → Glass: 48h 热度 <HeatCurve data={...} />                │
│         Glass: 相关热点 (relatedItems list, each links to /news/[id]) │
└────────────────────────────────────────────────────────────────┘
```

### 5.4 视觉对齐

- 与 SP-9 HomePage 同款 `Glass` / `fade-up` / `Pill` / `HeatBadge`。
- Tag chip 在 spec §0 Q14：列表项用 `bg-aurora-soft text-aurora` 单色，hover 颜色升一级；不引入新 atom。

---

## 6. 测试策略

### PR-A

- `heat.cron.processor.spec.ts`：扩 1 个 case — 跑完一次 cron 后 `heat_history.count() === visibleCount` 且 `(hotNewsId, bucketAt)` 唯一。
- `computeBucketAt.spec.ts`：4 个边界点（00 / 14 / 29 / 30 / 45 / 59）。

### PR-B

- `hot-news.service.spec.ts`：
  - `detail` 命中
  - `detail` 404 → 返回 null
  - `detail` related via groupId 命中 5 条
  - `detail` related fallback aiTag overlap
  - `heatHistory` hours 校验（24/48/72 三档，越界回到 48）

### PR-C

- `apps/web/app/news/[id]/page.spec.tsx`（component-level RSC test 困难，跳过 — 用 vitest 测试 helpers 即可）
- 手动 smoke：`curl /news/<id>` 检查 HTML 含 polyline + title。

---

## 7. PR 拆分 & 部署 gate

| PR  | 作用域                                                                     | Deploy 后 smoke                                            |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| A   | prisma migration `add_heat_history` + worker upsert + computeBucketAt   | prod `\d heat_history` + 等 30min `count(*) > 0` 验证       |
| B   | API `/hot-news/:id` + `/hot-news/:id/heat-history` + DTO                | prod curl 两条 endpoint 200                                |
| C   | Web `/news/[id]` RSC + 详情页 fetcher                                       | prod `curl /news/<id>` 包含 polyline + title              |

每个 PR 独立 review、独立 CI、独立 deploy（与 SP-9 节奏完全一致）。

---

## 8. 风险与回滚

| 风险                                          | 影响                                  | 缓解                                                                          |
| ------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| heat_history 写入失败                            | cron job 整个 fail → SP-6 重算停摆        | 把 history upsert 放在主 update 之后；try/catch 不让 history 异常向外抛                  |
| migration `add_heat_history` 在 prod 跑慢       | 部署窗口拖长                              | 表全新创建，几毫秒；无需 single-writer SOP                                             |
| `id != self` filter 漏 → 详情页关联自己             | UX 缺陷                              | service 测试覆盖；prisma `id: { not: id }` 已写                                     |
| 30min bucket 错位（cron 启动时机靠近半点边界）            | 同 30min 写两次（无害，UPSERT 幂等）           | UPSERT 保证幂等；不需要补偿                                                          |
| `notFound()` 触发 Next 路由 404 但 Aurora layout 不渲染 | 详情页 404 风格不一致                       | Next 15 `not-found.tsx` 在 layout 内会保留 sidebar；保持当前全局 not-found 风格           |
| 高频 detail 请求 N+1 (related)                  | API 压力                              | V1 流量极低；后续 SP-15 加 Redis 缓存层（spec §0 Q12）                                  |

回滚：

- PR-A：revert worker + drop table（drop 必须 single-writer SOP 停 worker → drop → 启 worker）。
- PR-B：revert API；list endpoint 不动，不影响主页。
- PR-C：revert page，路由回退到 Next 默认 404。

---

## 9. M6 之后衍生

- SP-12 搜索：详情页 → 关联搜索结果跳转
- SP-13 burst alert：基于 heat_history 二阶导数检测"突然爆发"
- SP-14 用户监控：详情页右上加"加入监控"按钮
- SP-15 CDN：对 detail + history 加 stale-while-revalidate 60s
- SP-16 TTL：heat_history `bucketAt < now() - 30 days` 删除

---

## 10. 后续动作

1. 起草 `docs/superpowers/plans/2026-05-19-sp11-detail-page-heat-history-plan.md`（粒度到任务级别）。
2. 开 docs PR 承载 spec + plan 作为 implicit approval 载体。
3. 拉 `feat/sp11-A-heat-history-schema` 启动 PR-A。
