# SP-10 — FeedPage：时间档 + category chip + 排序 + 双列 + 无限滚动

- **状态**：spec draft（路径 A 用户已 ack 整体节奏 + 6 项核心设计决策已拍板）
- **前置 SP**：
  - **SP-5.6**（必须）：taxonomy v4 提供 10 个 category，本 SP 顶部 chip 栏直接 hardcode 引用
  - SP-7-D（已完成）：list API `groupMode=fold` 收口，本 SP 沿用
  - SP-9（已完成）：Aurora `<HeatBadge>` / `<Pill>` / `<Tag>` / `<Glass>` 复用
- **后置 SP**：
  - SP-10.5（紧跟）：数据 TTL + cleanup cron，与本 SP 的 `?range=30d` 形成"看到的就是 DB 全部存的"语义对齐
  - SP-12（紧跟）：VaultPage 搜索接管"查找历史 / 跨 30 天"的场景，本 SP 不深做
- **本文件**：`docs/superpowers/specs/2026-05-21-sp10-feedpage-filter-infinite-design.md`
- **预计工作量**：~3 工作日（API ~3h；filter UI ~5h；双列+无限滚动 ~6h；测试 ~3h；prod smoke ~2h）
- **拆分**：3 个 PR（A=API+DTO / B=Web filter UI / C=Web 双列+无限滚动）

---

## 0. 关键设计决策

| #   | 维度                       | 选择                                                                                    | 理由                                                                                                                                                                                                              |
| --- | ------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | 平台维度呈现                  | **保留 community / media 2-tab**（SP-8 决策不动）                                              | community=HN+Reddit / media=RSS 已 prod 上跑，用户心智成型；SP-10 不推翻这个抽象层                                                                                                                                                  |
| Q2  | 时间窗口默认                  | **24h**（"今天" 心智）                                                                       | 用户在路径 A 决策时明确"只关注当天"。当前 platform window (HN/Reddit 48h, RSS 7d) 偏松，UI 默认 = 用户最关心范围                                                                                                                              |
| Q3  | 时间窗口切换器                | 顶部 segmented control `1d / 7d / 30d`，URL `?range=`                                     | 3 档够用 — 跳过 1h/6h 细粒度（数据稀疏，HN/Reddit 1h 内常 0 条）；跳过 `all` 因为 SP-10.5 L3 TTL = 30d，"all" 与 "30d" 等价就懒得加                                                                                                            |
| Q4  | 时间 vs platform window 关系 | **range 显式覆盖 platform window**（PLATFORM_WINDOW_HOURS 退化为"无 range 时的兜底"）                | 用户选 7d → 真的看 7d（即使 community tab 默认 48h）；语义对用户直观，不引入 min(user, platform) 的隐藏行为                                                                                                                                  |
| Q5  | 内容类型 filter             | **顶部 10 个 chip + 卡片 tag 点击**（双重入口）                                                    | 10 = SP-5.6 后的 categories；顶部 chip 是 "我想看哪类"，卡片 tag 是 "看到一个 OpenAI 想多看几个" — 两种场景都覆盖                                                                                                                              |
| Q6  | tag URL 参数命名             | `?tags=a,b,c`（多 tag AND 语义，逗号分隔）                                                       | 复用 `?platforms=a,b` 风格；命名 "tags" 而非 "aiTags" 因为 URL 已经写出来，命名空间 prefix 自带（`category:OpenSource`）                                                                                                                |
| Q7  | tag 多选语义                | **AND**（所有 tag 都要在 row 的 aiTags 里）                                                    | OR 语义太宽 — 选 `company:OpenAI + model:GPT-5` 期望同时命中两者；AND 直接复用 prisma `aiTags: { hasEvery: tags }` 内置                                                                                                              |
| Q8  | 顶部 chip 多选 vs 单选         | **多选**（点了 OpenSource 再点 OpenAI 是 AND）                                                  | 与 Q7 一致；UI 上点中的 chip 高亮，已选的 chip 区单独显示"清除筛选 ✕"                                                                                                                                                                  |
| Q9  | 排序切换                    | 右上 segmented control `最新 / 综合热度`，URL `?sort=`                                          | API 已支持；UI 暴露后用户能切换；SP-9 dashboard 已经用 heat sort，列表对齐自然                                                                                                                                                       |
| Q10 | 排序默认                    | `time` (保持当前行为)                                                                       | 不破已 prod URL 兼容（`/news` 老 link 不会因默认改 heat 而内容大变）                                                                                                                                                              |
| Q11 | 卡片布局                    | **桌面 `md:grid-cols-2`，手机单列**                                                          | Aurora 设计稿原意；当前 NewsItem 内容量大（标题+摘要+tags+footer+groupMembers）也能撑住双列 — 摘要 line-clamp-3 已就位                                                                                                                       |
| Q12 | 分页方式                    | **intersection observer 无限滚动**，首屏 SSR 渲染第 1 页 + client 增量 fetch                        | 阅读体验最好；首屏 SSR 保 SEO 与 LCP                                                                                                                                                                                       |
| Q13 | 加载到底提示                  | 底部固定 "已加载全部 N 条 · 看更早 →" 链接，跳到 `?range=` 下一档（1d→7d→30d→搜索页 /vault）                       | 不无限轮询；引导用户进入 SP-12 搜索做"跨范围找内容"                                                                                                                                                                                |
| Q14 | 加载更多触发距离                | 距离底部 600px 触发 `fetchNext()`                                                            | 滚动惯性下用户感觉"加载快"；600px 是 ~3 张卡片的视高，安全裕度                                                                                                                                                                          |
| Q15 | 同时点击多个 chip 时的 URL 状态    | 完全反映在 URL：`?tags=category:OpenSource,company:OpenAI&range=7d&sort=heat&tab=community` | URL 是 single source of truth；client state 完全 derive 自 URL，"复制 URL 分享"行为天然支持                                                                                                                                    |
| Q16 | 排序 / range / tags 切换刷新策略  | **完全 navigation reload**（Next 15 RSC route invalidation）                              | 切换=新 URL=新 page render；client 端 hook 只管"无限滚动加载下一页"，不管 filter 切换 — 减少 client state 复杂度                                                                                                                          |
| Q17 | API DTO 扩展兼容             | `range?` / `tags?` 都是 optional；旧 client（如 SP-9 fetchHotNewsList）不传则行为完全不变             | 前向兼容；SP-9/SP-11 的 fetchers 不需要改                                                                                                                                                                                |
| Q18 | range 字符串 vs 数字hours    | URL 用字符串 `1d / 7d / 30d`（更可读），service 内部 `RANGE_HOURS_MAP` 转换                          | URL 友好（`?range=7d` vs `?range=168`）                                                                                                                                                                            |
| Q19 | Tag 组件点击改造              | `<Tag>` 增加可选 `href` prop；不传则保持现状 (span)，传了则渲染为 `<Link>`                                  | 向后兼容 SP-8 既有用法（dashboard 等）；SP-10 在 NewsItem 内传 `?tags=` 构造的 href                                                                                                                                                |
| Q20 | 顶部 chip "全部" 入口         | 第一个 chip 显示 "全部"，效果是清掉 `?tags=` 参数                                                    | Aurora design — 第一个 chip 视觉上等同 "重置 category filter"                                                                                                                                                            |
| Q21 | groupMode 行为             | URL 不暴露，service 仍默认 `fold`（SP-7-D 决策）                                                  | groupMode 是 power-user 调试参数；当前 list URL 极少有人手工带 `?groupMode=expand`                                                                                                                                            |
| Q22 | URL 与 cookie / localStorage  | **零 cookie / localStorage**，URL 是唯一状态源                                                | SSR 友好；分享行为自然；后续 SP-13 用户系统接管"我的默认 filter"时再补                                                                                                                                                                  |
| Q23 | PR 拆分                    | A=API DTO + service.list filter；B=Web 顶部 filter UI + Tag href 改造；C=Web 双列 + 无限滚动 client | 每个 PR < 400 行；A 独立可上线（前向兼容）、B 加 UI 但仍翻页（client 状态最小）、C 才切无限滚动                                                                                                                                                  |

---

## 1. 目标与硬验收

### 1.1 目标

1. **产品**：用户进入 `/news` 默认看到过去 24h 热点；可一键切换 7d / 30d；可按 10 个 category 多选筛选；可按"最新/热度"切换；阅读时滚动到底自动加载下一页。
2. **API**：`GET /hot-news` 支持 `?range=1d|7d|30d&tags=a,b&sort=time|heat&page=N&pageSize=20`，旧 client（无新参数）行为完全不变。
3. **UI**：双列布局桌面端紧凑、手机端单列舒展；filter 区固定吸顶；卡片 tag 可点击跳转。
4. **零回归**：SP-7-D groupMode=fold / SP-9 dashboard / SP-11 详情页 / list 默认 community tab 全部不变。

### 1.2 硬验收

```bash
# A. API：默认行为不变
curl -sS 'https://hotnews.shinpeionline.top/api/hot-news?pageSize=1' | jq '{total, sample: .items[0].id}'
# 与 SP-10 前完全相同

# B. API：新 range 参数生效
curl -sS 'https://hotnews.shinpeionline.top/api/hot-news?range=1d&pageSize=50' | jq '{total, oldest: (.items | map(.publishedAt) | min)}'
# total < range=7d 的 total；oldest 时间戳 >= now - 24h

# C. API：tags AND 语义
curl -sS 'https://hotnews.shinpeionline.top/api/hot-news?tags=category:Opinion,company:OpenAI&range=30d' | jq '.items | length'
# 返回 row 必同时含两个 tag

# D. Web：双列 + 默认 24h
curl -sS 'https://hotnews.shinpeionline.top/news' | grep -E 'md:grid-cols-2|range=1d'
# HTML 含 grid-cols-2 + 顶部 chip 区当前 active = "今天"

# E. Web：chip 点击 URL
# 手工：点 "OpenSource" chip → URL 变 /news?tags=category:OpenSource
# 再点 "OpenAI" chip → URL 变 /news?tags=category:OpenSource,company:OpenAI

# F. Web：无限滚动
# 手工：滚到底部前 600px → 卡片数量从 20 → 40，URL 不变（仅 client fetch）
# 滚到全部加载完 → 底部出现 "已加载全部 N 条 · 看更早 →" 链接

# G. 零回归
curl -sS 'https://hotnews.shinpeionline.top/api/stats/today'        # SP-9 仍 200
curl -sS 'https://hotnews.shinpeionline.top/api/hot-news/<id>'      # SP-11 仍 200
```

---

## 2. API 改造（PR-A）

### 2.1 DTO 扩展

`apps/api/src/hot-news/dto/list-hot-news.query.ts`：

```typescript
const ALLOWED_RANGES = ['1d', '7d', '30d'] as const;
type AllowedRange = (typeof ALLOWED_RANGES)[number];

const RANGE_HOURS_MAP: Record<AllowedRange, number> = {
  '1d': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

export class ListHotNewsQuery {
  // ... 已有字段 page / pageSize / platforms / sort / groupMode 全部不动 ...

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsIn(ALLOWED_RANGES)
  range?: AllowedRange;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value == null) return undefined;
    if (typeof value !== 'string') return value;
    return value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  })
  @IsArray()
  tags?: string[];
}

export { RANGE_HOURS_MAP, type AllowedRange };
```

### 2.2 Service 改造

`apps/api/src/hot-news/hot-news.service.ts` `list()` 改动点：

```typescript
async list(
  page: number,
  pageSize: number,
  platforms?: Platform[],
  sort: 'time' | 'heat' = 'time',
  groupMode: 'fold' | 'expand' = 'fold',
  range?: AllowedRange,            // NEW
  tags?: string[],                 // NEW
): Promise<HotNewsListResponseDto> {
  // ... existing requested / effectivePlatforms / orderBy ...

  // range 覆盖 platform window:
  // - 无 range: 沿用 PLATFORM_WINDOW_HOURS 按平台兜底（旧行为）
  // - 有 range: 所有平台用同一个 hours 窗口，platform window 失效
  const userHours = range ? RANGE_HOURS_MAP[range] : null;
  const orClauses = effectivePlatforms.map((p) => ({
    sourcePlatform: p,
    publishedAt: {
      gte: new Date(
        now.getTime() -
          (userHours ?? PLATFORM_WINDOW_HOURS[p]) * 60 * 60 * 1000,
      ),
    },
  }));

  const where: Prisma.HotNewsWhereInput = {
    status: ContentStatus.VISIBLE,
    OR: orClauses,
    ...(tags && tags.length > 0 ? { aiTags: { hasEvery: tags } } : {}),
  };

  // ... 后面 Prisma findMany 路径 + raw SQL fold 路径 ...
  //   raw SQL 路径 whereSql 也要加 aiTags @> ARRAY[...] 子句
}
```

### 2.3 raw SQL `whereSql` 改动（fold 路径）

```typescript
const whereSql = Prisma.sql`
  status = 'VISIBLE'::"ContentStatus"
  AND (${Prisma.join(platformWindowFragments, ' OR ')})
  ${tags && tags.length > 0 
    ? Prisma.sql`AND "aiTags" @> ${tags}::text[]` 
    : Prisma.empty}
`;
```

注意：`@>` 是 Postgres 数组包含操作符，等价于 `hasEvery`；类型是 `text[]`，cast 必须显式。

### 2.4 Controller 透传

`apps/api/src/hot-news/hot-news.controller.ts`：

```typescript
@Get()
list(@Query() query: ListHotNewsQuery): Promise<HotNewsListResponseDto> {
  return this.service.list(
    query.page,
    query.pageSize,
    query.platforms,
    query.sort,
    query.groupMode ?? 'fold',
    query.range,    // NEW
    query.tags,     // NEW
  );
}
```

### 2.5 测试

`apps/api/src/hot-news/hot-news.service.spec.ts` 增加 case：

- `range=1d` → where.OR[*].publishedAt.gte 是 now-24h
- `range=7d` → where.OR[*].publishedAt.gte 是 now-7d，覆盖 community 默认 48h
- `range=30d` → publishedAt.gte 是 now-30d
- `tags=['category:Opinion']` → where 含 `aiTags.hasEvery`
- `tags=['category:Opinion', 'company:OpenAI']` → where 含 AND 两个
- `tags=[]` / 不传 → where 不含 aiTags 子句
- groupMode=fold + tags → raw SQL 也加 `aiTags @> ARRAY[...]`（snapshot 测试 query 拼装）

---

## 3. Web filter UI（PR-B）

### 3.1 文件

```
apps/web/app/news/_components/range-tabs.tsx        ← NEW: 1d/7d/30d segmented
apps/web/app/news/_components/sort-tabs.tsx         ← NEW: time/heat segmented (top-right)
apps/web/app/news/_components/category-chips.tsx    ← NEW: 顶部 11 chip（10 cat + "全部"）
apps/web/app/news/_components/tag-chip-link.tsx     ← NEW: 卡片内可点击 tag wrapper
apps/web/app/news/page.tsx                          ← MOD: 接 range / tags / sort 三参数
apps/web/lib/api.ts                                 ← MOD: fetchHotNewsList(...) 加 range/tags 参数
packages/ui/src/atoms/tag.tsx                       ← MOD: 可选 href prop
```

### 3.2 search params 类型扩展

```typescript
interface PageProps {
  searchParams: Promise<{
    page?: string;
    tab?: string;
    range?: string;     // NEW
    tags?: string;      // NEW
    sort?: string;      // NEW
  }>;
}
```

### 3.3 顶部布局

```
┌──── PageHeader ────────────────────────────────────────────┐
│  Hot Feed · 热点流                                          │
│  ${total} 条精选热点 · 实时聚合 N 个平台                       │
│                                                            │
│  [社区热点 · 48h] [权威媒体 · 7d]    [今天 · 1d] [近 7 天] [近 30 天]
│  ↑ feed-tabs.tsx                  ↑ range-tabs.tsx     [最新/热度] ← sort-tabs.tsx
│                                                            │
│  ┌── category-chips ──────────────────────────────────────┐
│  │ [全部] [开源] [模型发布] [工具] [产品] [文章] [研究]      │
│  │       [观点] [基准] [事故] [融资]                        │
│  └────────────────────────────────────────────────────────┘
└────────────────────────────────────────────────────────────┘
```

### 3.4 category chip 中文标签映射

`apps/web/app/news/_components/category-chips.tsx`：

```typescript
const CATEGORY_LABELS = {
  Release: '模型发布',
  Research: '研究',
  Tutorial: '教程',
  Opinion: '观点',
  Tooling: '工具',
  Benchmark: '基准',
  Incident: '事故',
  Product: '产品',
  OpenSource: '开源',
  Funding: '融资',
} as const;

const CATEGORIES = Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>;
```

- chip URL 构造：`/news?...其它参数...&tags=category:${cat}`
- 多选：当前 URL 已有 `tags=A,B`，点新 chip 在末尾追加 `,category:C`；已选时点击则从 tags 移除该值
- "全部"：清掉 `tags` 参数

### 3.5 Tag 组件 href 改造

`packages/ui/src/atoms/tag.tsx`：

```typescript
export interface TagProps {
  children: ReactNode;
  color?: string;
  index?: number;
  href?: string;       // NEW: 传则渲染为 <a>，否则 <span>
  title?: string;      // NEW: hover tooltip
}

export function Tag({ children, color, index, href, title }: TagProps) {
  const resolvedColor = /* same */;
  const className = "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium";
  const style = { /* same */ };
  if (href) {
    return (
      <a href={href} className={`${className} hover:opacity-80 transition-opacity`} style={style} title={title}>
        {children}
      </a>
    );
  }
  return <span className={className} style={style} title={title}>{children}</span>;
}
```

### 3.6 NewsItem 内 tag href 注入

`apps/web/app/news/_components/news-item.tsx`：

```typescript
{item.aiTags.map((tag, i) => (
  <Tag
    key={tag}
    index={i}
    href={`/news?tags=${encodeURIComponent(tag)}`}
    title={`筛选 ${tag}`}
  >
    {tag}
  </Tag>
))}
```

---

## 4. Web 双列 + 无限滚动（PR-C）

### 4.1 文件

```
apps/web/app/news/_components/news-feed.tsx           ← NEW: client component
apps/web/app/news/_components/news-feed-skeleton.tsx  ← NEW: 加载 placeholder
apps/web/app/news/_components/news-feed.spec.tsx      ← NEW: reducer / IO mock
apps/web/app/news/page.tsx                            ← MOD: RSC 首屏 fetch 第 1 页 → 渲染 NewsFeed
apps/web/app/news/_components/pagination.tsx          ← DELETE: 无限滚动替代
```

### 4.2 RSC + Client 边界

```typescript
// page.tsx (RSC)
export default async function NewsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const platforms = TAB_PLATFORMS[tab];
  const range = parseRange(sp.range);   // default '1d'
  const tags = parseTags(sp.tags);      // default []
  const sort = parseSort(sp.sort);      // default 'time'

  const initial = await fetchHotNewsList(1, 20, platforms, { range, tags, sort });

  return (
    <>
      <div className="px-9 pt-7 pb-3">
        <PageHeader ... />
        <FeedTabs active={tab} />
        <RangeTabs active={range} />
        <SortTabs active={sort} />
        <CategoryChips selected={tags} />
      </div>
      <NewsFeed
        initialData={initial}
        tab={tab}
        platforms={platforms}
        range={range}
        tags={tags}
        sort={sort}
      />
    </>
  );
}
```

```typescript
// news-feed.tsx (client)
'use client';

export function NewsFeed({ initialData, tab, platforms, range, tags, sort }: Props) {
  const [pages, setPages] = useState([initialData]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialData.items.length === initialData.total);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (done || loading) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        loadNext();
      }
    }, { rootMargin: '600px 0px' });  // 距离底部 600px 触发
    if (sentinelRef.current) io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [done, loading]);

  async function loadNext() {
    setLoading(true);
    const nextPage = pages.length + 1;
    const data = await fetchHotNewsListClient(nextPage, 20, platforms, { range, tags, sort });
    setPages([...pages, data]);
    const loaded = pages.reduce((n, p) => n + p.items.length, 0) + data.items.length;
    if (loaded >= data.total || data.items.length === 0) setDone(true);
    setLoading(false);
  }

  const items = pages.flatMap((p) => p.items);
  const total = pages[0].total;

  return (
    <div className="flex-1 overflow-auto px-9 pb-9">
      <ListHeader total={total} latestCrawledAt={items[0]?.crawledAt} />
      <div className="mt-3.5 grid grid-cols-1 md:grid-cols-2 gap-3 fade-up">
        {items.map((item) => <NewsItem key={item.id} item={item} />)}
      </div>
      {loading ? <NewsFeedSkeleton /> : null}
      {done ? (
        <div className="mt-6 text-center text-sm text-ink-3">
          已加载全部 {total} 条
          <NextRangeLink current={range} className="ml-2 text-aurora">看更早 →</NextRangeLink>
        </div>
      ) : (
        <div ref={sentinelRef} className="h-px" />
      )}
    </div>
  );
}
```

### 4.3 NextRangeLink 逻辑

```typescript
const NEXT_RANGE_MAP: Record<AllowedRange, string> = {
  '1d': '/news?range=7d',
  '7d': '/news?range=30d',
  '30d': '/vault',   // 进入搜索页（SP-12）
};
```

注意：在 SP-10 时 `/vault` 还是 mockup；SP-12 才接搜索。但 link 现在指过去也无害（用户能看到 placeholder）。

### 4.4 Client fetch helper

`apps/web/lib/api.ts`：

```typescript
export interface ListFilterOptions {
  range?: '1d' | '7d' | '30d';
  tags?: string[];
  sort?: 'time' | 'heat';
}

export function fetchHotNewsList(
  page: number,
  pageSize: number,
  platforms?: FeedPlatform[],
  options?: ListFilterOptions,
): Promise<HotNewsListResponseDto> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (platforms?.length) params.set('platforms', platforms.join(','));
  if (options?.range) params.set('range', options.range);
  if (options?.tags?.length) params.set('tags', options.tags.join(','));
  if (options?.sort) params.set('sort', options.sort);
  return fetchJson<HotNewsListResponseDto>(`/hot-news?${params}`);
}

// Client-side variant (用绝对 URL to BFF /api/hot-news, not internal API)
export function fetchHotNewsListClient(
  page: number,
  pageSize: number,
  platforms?: FeedPlatform[],
  options?: ListFilterOptions,
): Promise<HotNewsListResponseDto> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (platforms?.length) params.set('platforms', platforms.join(','));
  if (options?.range) params.set('range', options.range);
  if (options?.tags?.length) params.set('tags', options.tags.join(','));
  if (options?.sort) params.set('sort', options.sort);
  const res = await fetch(`/api/hot-news?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
```

### 4.5 测试

- `news-feed.spec.tsx`：mock IntersectionObserver；assert
  - 初始渲染 = initialData.items
  - 触发 IO → fetch 第 2 页 → items 增量
  - done=true 时不再 fetch
- `category-chips.spec.tsx`：纯 URL 构造单测
  - 选 1 chip → `tags=category:A`
  - 已选 A 再选 B → `tags=category:A,category:B`
  - 已选 A 再点 A → `tags=` 清掉
  - "全部" → 清掉 tags
- `tag.spec.tsx`：href 传与不传两种渲染

---

## 5. URL state 合约

```
/news?
  tab=community|media                   ← 必有，默认 community
  &range=1d|7d|30d                       ← 默认 1d
  &tags=category:OpenSource,company:OpenAI  ← 多 tag AND，默认空
  &sort=time|heat                        ← 默认 time
  &page=N                                ← 仅首屏 SSR 用；client 增量 fetch 不写回 URL
```

不写回 URL 的状态：**已加载到第几页**。这个是 client state；refresh 后又回到第 1 页 + 用户重新滚动到 IO 触发点 — 简化设计，且 UX 上 refresh 本来就是"我想看最新的"。

---

## 6. PR 拆分 & 部署 gate

| PR  | 作用域                                                                                | Deploy 后 smoke                                                                                |
| --- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A   | API DTO `range/tags` + service.list 改造 + raw SQL 路径同步 + 6 个 service.spec case        | `curl ?range=1d&tags=category:Opinion` 200，total 正确，items[].aiTags 全含 Opinion              |
| B   | Web filter UI（range/sort tabs + category chips + tag href）+ Tag 组件改造 + UI 包 build  | `curl /news` HTML 含 chip 区 + range tabs；手工点击 chip → URL 变 `?tags=...` 且后端确实过滤                          |
| C   | Web NewsFeed client component + 双列 grid + IO 无限滚动 + 移除 pagination                  | `curl /news` HTML 含 `md:grid-cols-2`；手工滚动 → 卡片从 20 → 40；底部出现 "已加载全部 N 条" + "看更早 →"                   |

每个 PR < 400 行，独立 review、独立 CI、独立 deploy。

---

## 7. 风险与回滚

| 风险                                                  | 影响                                  | 缓解                                                                                                                                                |
| --------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aiTags hasEvery` 在大表上慢                              | filter 慢                            | prod hot_news 仅 1.2k 行 + `aiTags` 已有 GIN 索引（隐式：Prisma `String[]`列默认 GIN），EXPLAIN 走索引；30d 全量也 < 100ms                                          |
| range=30d 把 platform window 完全打开后 → API 返回 1000+ 行 | client 一次性渲染慢                       | API pageSize 上限 50（DTO 已有 `@Max(50)` 校验），无限滚动按 20/页 fetch，每次只渲染 20 张卡片                                                                              |
| Intersection Observer 在某些移动浏览器卡顿                    | 用户滚动到底没自动加载                       | sentinel 仍在；UA fallback 是底部加 "加载更多" 按钮（spec 不做，留作 hot-fix 备选）                                                                                     |
| `category:OpenSource` 召回为 0（SP-5.6 prompt 还没生效或失效） | chip "开源" 点了之后空列表                  | chip 显示数字角标 (todo: phase 2)；deploy +24h 之内 prod smoke 验收即可发现                                                                                       |
| typedRoutes 报错（href 含 `${string}` 动态拼接）            | Web build fail                      | category-chips / news-feed 中 href 用 `as Route` 强 cast 或用 `UrlObject` 形式 — SP-4.5 已踩过坑，沿用                                                          |
| 切换 chip / range / sort 时 Next 重新 SSR 当前页 → "页面闪烁"  | UX 退化                               | RangeTabs / SortTabs / CategoryChips 都用 `<Link prefetch>` + Next 15 自动 client navigation；首屏 fetch < 200ms 实测无闪烁                                  |
| Tag href 改造 breaking dashboard / detail page         | 其它页面 tag 渲染异常                       | href 是可选 prop；不传保持现状；其它页面（dashboard / detail）不传 href                                                                                              |

回滚：

- PR-A revert：DTO 退回 / service.list 退回；旧默认行为完全恢复
- PR-B revert：Web filter UI 退回；保留旧 FeedTabs（不影响 PR-A）
- PR-C revert：Web NewsFeed 退回旧 pagination；filter 仍可用（PR-B 不变）

---

## 8. M5 收尾后衍生

| 后续 SP   | 衔接                                                                                |
| ------- | --------------------------------------------------------------------------------- |
| SP-10.5 | TTL 30d 与 `?range=30d` 边界完全对齐 — 用户最多能看 30 天，是 DB 全量                                |
| SP-12   | "看更早 →" 链接指向 `/vault` 搜索；SP-12 上线后 vault 真正接搜索能力                                  |
| SP-14   | 关键词监控页里"建议关键词"列表从 hot_news.aiTags 高频抽 → top 20 chip                                |
| SP-15 R | 监控页 Radar 用 aiTags 维度做雷达半径                                                        |
| SP-19   | 趋势页按 category chip 做时序聚合                                                          |

---

## 9. 后续动作

1. 起草 `docs/superpowers/plans/2026-05-21-sp10-feedpage-filter-infinite-plan.md`（粒度到任务级别 + 3 PR 拆分）
2. 与 SP-5.6 + SP-10.5 docs 合并到一个 docs PR 承载 implicit approval
3. docs PR merge 后启动 SP-5.6 implementation（前置），再启动 SP-10 PR-A
