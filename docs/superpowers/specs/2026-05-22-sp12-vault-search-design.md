# SP-12 — VaultPage：内容库搜索（pg_trgm 全文检索 + 推荐标签云）

- **状态**：spec draft（路径 A "继续推进" 命令下自主推进；M5 最后一刀）
- **前置 SP**：
  - **SP-10 完整链**（PR-A/B/C 已 prod）：搜索默认 `?range=30d` 复用 ListHotNewsQuery，结果列表复用 `<NewsFeed>` 无限滚动
  - **SP-10.5**（PR #45 已 prod，cron 生效）：30d L3 TTL 等于本 SP 默认范围 — "看到的 = DB 全部存的" 在 vault 同样成立
  - **SP-5.6**（PR #42 已 prod）：taxonomy v4 10 个 category 都已在 prod 数据流转
- **后置 SP**：
  - SP-15 用户关键词监控页：建议关键词列表直接消费本 SP 的 `GET /stats/top-tags` API
  - SP-19 趋势：可按 keyword 搜索结果做 timeseries
- **本文件**：`docs/superpowers/specs/2026-05-22-sp12-vault-search-design.md`
- **预计工作量**：~1 工作日（PR-A migration + API ~3h；PR-B Web /vault rewrite ~3h；测试 ~2h；prod smoke ~1h）
- **拆分**：2 个 PR（A=migration + API；B=Web vault rewrite）

---

## 0. 关键设计决策（自主拍板）

| #   | 维度                          | 选择                                                                                                              | 理由                                                                                                                                                                                |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | endpoint 设计                 | **扩展 `GET /hot-news` 加 `?q=`**，不新建 `/search`                                                                  | 复用所有 SP-10 filter (`platforms / range / tags / sort / groupMode / page / pageSize`)；URL 哲学一致；client 端 `<NewsFeed>` 不需要任何分叉                                                  |
| Q2  | 搜索引擎                       | **pg_trgm GIN index**（Postgres contrib，prod 16 自带，0 cost extension）                                          | 中文友好（trigram 切 3-gram 不依赖分词），prefix / substring 都支持；vs `tsvector` 中文要装 `zhparser` 等额外 extension，复杂度上升；vs `ILIKE` 慢 + 无索引                                |
| Q3  | 搜索域                         | `COALESCE(titleZh, '') \|\| ' ' \|\| title \|\| ' ' \|\| COALESCE(summary, '') \|\| ' ' \|\| array_to_string("aiTags", ' ') \|\| ' ' \|\| array_to_string("matchedKeywords", ' ')` | 5 列拼接成一列建 GIN index — 一次扫，命中任一字段都返；author / content 不进搜索（author 噪声大、content 文档过大让 trigram 太慢）                                                                                       |
| Q4  | GIN index 形式                | **生成列 `search_text TEXT` (`GENERATED ALWAYS AS (...) STORED`)** + `CREATE INDEX gin (search_text gin_trgm_ops)` | 比 functional index `gin (lower(...))` 更直观、可被 EXPLAIN 看到；STORED 仅 1377 rows × 200 chars ≈ 270KB 极小；Prisma 不原生 generated column → migration 用 raw SQL                  |
| Q5  | trigram similarity 阈值       | `% operator` 默认阈值（pg_trgm.similarity_threshold = 0.3）                                                          | 默认对中文混合查询命中率 OK；prod 实测后如召回低再调（`SET pg_trgm.similarity_threshold = 0.2` SQL 调即可）                                                                                  |
| Q6  | q 排序                        | **匹配优先**：`ORDER BY similarity(search_text, q) DESC, "publishedAt" DESC`（仅当 `?q=` 存在时）；否则沿用 SP-10 `?sort=` | "搜出来的最像的排第一" 是搜索引擎默认 UX；同分时新的优先；`?sort=heat` 显式传时让 heat 接管搜索的次排                                                                                                |
| Q7  | 默认范围                       | `?range=30d`（vs SP-10 `/news` 默认 1d）                                                                            | "vault = 内容库" 心智是回看；30d 与 L3 TTL 上限对齐 — "看到的就是所有"                                                                                                                            |
| Q8  | 默认 platforms                | 不限制（去掉 SP-4.5 community-only 默认）                                                                              | 搜索意图是 "找内容"，不区分平台；URL 不带 `?platforms=` 时 service 端走 ALL_PLATFORMS = `['HACKERNEWS', 'REDDIT', 'RSS']`                                                                          |
| Q9  | 推荐标签云                     | 新加 `GET /stats/top-tags?days=30&limit=20`                                                                       | 频次最高的 aiTags（不含 tech: 自由维度的 chip 太多）— SP-12 vault 入口展示，SP-15 关键词建议复用                                                                                                       |
| Q10 | 推荐标签命名空间筛选           | 仅返回 `company:` + `model:` + `category:` 三种（**不含 `tech:`**）                                                  | tech: 是 LLM 自由生成的，长尾词太多噪声大；前三个 namespace 是受控词表稳定                                                                                                                              |
| Q11 | 推荐标签数据范围               | 默认 `days=30`                                                                                                    | 与 vault 默认 range 对齐；用户改 range 时 tag cloud 也应该跟新（但 V1 不联动，tag cloud 只取 30d 全量 — 简化）                                                                                            |
| Q12 | 空 query 行为                  | 显示推荐标签云 + 最近 30d 全量列表（按 publishedAt desc 复用 NewsFeed）                                                  | 不引导成 "搜索引擎主页"，而是 "可浏览的内容库"；EmptyState 在 query=非空但命中=0 时才显示                                                                                                                                                     |
| Q13 | 列表渲染                      | **完全复用 `<NewsFeed>`**（client component + IO 无限滚动 + 双列 grid）                                                | SP-10 PR-C 已抽出来；vault 只是不同入口的"另一种 query" — 一致 UX                                                                                                                                                       |
| Q14 | 收藏功能                       | **不做**（YAGNI, 留给 SP-15）                                                                                       | 设计稿原意 vault = 内容库 ≠ 收藏夹；收藏依赖用户体系（SP-13 认证），与本 SP 解耦                                                                                                                                                  |
| Q15 | mockup 处理                   | **完全替换** `apps/web/app/vault/page.tsx`（原 SP-8 mockup banner + 2 fake 卡片）                                  | SP-8 mockup 是 placeholder 性质，没有迁移成本；MockupBanner 在本 SP 后还有别的 mockup（radar/trends）继续用                                                                                                                                                  |
| Q16 | author 是否进搜索             | **不进**                                                                                                          | author 是 platform-specific（HN handle / Reddit u/xxx / RSS 站点名）噪声大；用户找内容靠主题，找作者靠 SP-15 关键词监控更准                                                                                                                                                  |
| Q17 | content 是否进搜索            | **不进**                                                                                                          | content 平均 5.7k chars 峰 25k；trigram index 包含 content 会膨胀 ~20×；命中率提升对"看 vault"场景边际收益低；命中 title+summary+aiTags 已覆盖 99% 用户 query                                                                                                                                                  |
| Q18 | 排序切换 UI                    | **不显式暴露**（保留 SP-10 `?sort=` URL 兼容，但 /vault 顶部不渲染 SortTabs）                                                | vault 搜索默认 similarity > heat > time，UI 简洁；power-user 仍可手工带 `?sort=heat`                                                                                                                                                  |
| Q19 | q URL 参数命名                | `?q=` (短)，不用 `?query=` 或 `?search=`                                                                          | URL 友好；与 Google / Bing / Reddit 业内标准一致                                                                                                                                                  |
| Q20 | q 长度上限 / 校验             | DTO 加 `@MaxLength(200)`，超长 reject 400                                                                          | 防御性；trigram 对超长 query 无意义                                                                                                                                                  |
| Q21 | 搜索框组件位置                  | apps/web/app/vault/_components/search-input.tsx + 表单 submit 提交 navigation                                       | RSC 友好；无 client state；URL 即状态                                                                                                                                                  |
| Q22 | 推荐标签云组件                  | apps/web/app/vault/_components/tag-cloud.tsx，复用 Tag atom 的 href prop（SP-10 PR-B 已就位）                            | 每个标签点击 → `/vault?tags=<tag>` URL 跳转；与 NewsItem 内可点击 tag 行为完全一致                                                                                                                                                  |
| Q23 | PR 拆分                       | **A=API + migration**（pg_trgm extension + search_text generated column + GIN index + ?q= 加进 list service + /stats/top-tags）<br>**B=Web /vault rewrite**（搜索框 + tag cloud + NewsFeed 接入 vault） | A 独立可上线（前向兼容，?q 是新参数）；B 加 UI 但 prod 仍可访问                                                                                                                                                  |

---

## 1. 目标与硬验收

### 1.1 目标

1. **API**：`GET /hot-news?q=<keyword>` 在 30d 窗口内做 trigram 模糊匹配，返回按 similarity DESC 的列表；`GET /stats/top-tags` 返回 top 20 aiTags。
2. **Web `/vault`**：搜索框 + 推荐标签云 + 结果列表（复用 NewsFeed），与 `/news` 一致的 Aurora 视觉。
3. **零回归**：`/news` 不动；`/api/hot-news` 没带 `?q=` 时行为完全不变。
4. **性能**：1377 rows × trigram GIN index，single-keyword query EXPLAIN 走索引 + 全表 `<100ms`（local docker）。

### 1.2 硬验收

```bash
# A. Migration 落地
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U ai_hot_news -d ai_hot_news_prod -c "\dx pg_trgm; \d hot_news;" | head -50'
# 期望：pg_trgm 1.6 installed；hot_news 含 search_text 生成列 + GIN index

# B. API ?q= 工作
curl -sS 'https://hotnews.shinpeionline.top/api/hot-news?q=OpenAI&range=30d&pageSize=5' | jq '{total, sample_titles: [.items[].title]}'
# 期望：total >= 10，items 全部含 OpenAI 关键词（直接或 via aiTags）

# C. API ?q= 中文也工作
curl -sS 'https://hotnews.shinpeionline.top/api/hot-news?q=智能体&range=30d&pageSize=3' | jq '.total'
# 期望：> 0（trigram 对中文 3-gram 命中）

# D. /stats/top-tags
curl -sS 'https://hotnews.shinpeionline.top/api/stats/top-tags?days=30&limit=20' | jq '.tags | length, .tags[0]'
# 期望：20 个 tags，第一个含 {tag, count} 形态

# E. /vault HTML
curl -sS 'https://hotnews.shinpeionline.top/vault' | grep -cE 'name="q"|tag-cloud|内容库'
# 期望：>= 3 (search input + tag cloud + heading)

# F. 零回归
curl -sS 'https://hotnews.shinpeionline.top/api/hot-news?pageSize=1' | jq '{total, baseline: .items[0].id}'
# 期望：与 SP-10 时代行为完全一致
```

---

## 2. 数据模型 / Migration

### 2.1 Migration: `add_search_text_column`

`packages/db/prisma/migrations/<timestamp>_add_search_text_column/migration.sql`：

```sql
-- SP-12 (2026-05-22): pg_trgm full-text search infrastructure.

-- 1. pg_trgm extension (Postgres 16 contrib, no extra package install)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Generated column concatenating searchable fields.
--    STORED so it's persisted on row write — read fast, no per-query CPU.
--    Concatenation order = title visibility order (titleZh first for CN users).
ALTER TABLE hot_news
  ADD COLUMN search_text TEXT GENERATED ALWAYS AS (
    COALESCE("titleZh", '')
      || ' '
      || title
      || ' '
      || COALESCE(summary, '')
      || ' '
      || array_to_string("aiTags", ' ')
      || ' '
      || array_to_string("matchedKeywords", ' ')
  ) STORED;

-- 3. GIN index for fast trigram lookup.
CREATE INDEX hot_news_search_text_trgm_idx
  ON hot_news USING GIN (search_text gin_trgm_ops);
```

Prisma schema 不动 — generated column 不需要在 schema.prisma 里声明；Prisma 客户端只用它做 `WHERE` 子句，而 raw SQL where 直接写列名即可。

### 2.2 Migration 安全性

- `CREATE EXTENSION` 幂等（`IF NOT EXISTS`）
- 加列 + 索引在 1377 rows 上 << 1s（生成列 STORED 也是同步写）
- 不停 worker（与 SP-11 `add_heat_history` 同款风险等级）

---

## 3. API 改造（PR-A）

### 3.1 DTO 扩展

`apps/api/src/hot-news/dto/list-hot-news.query.ts` 加：

```typescript
@IsOptional()
@IsString()
@MaxLength(200)
@Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
)
q?: string;
```

### 3.2 service.list() 改造

签名加 `query?: string`，service 内：

```typescript
// SP-12: trigram search overlay. Only kicks in when `?q=` is non-empty
// (after DTO trim). Service stays drift-tolerant — empty/whitespace q
// is treated as "no search" and existing filters apply unchanged.
const hasQuery = query != null && query.length > 0;
```

`fold` 路径（raw SQL）加 `search_text % ${query}` 子句到 `whereSql`，**并**改 `ORDER BY` 加 `similarity(search_text, ${query}) DESC` 前置。

`expand` 路径（Prisma findMany）：Prisma 不原生支持 `%` 操作符；用 `prisma.$queryRaw` 或者 fallback 到 `WHERE search_text ILIKE '%...%'`（trgm GIN 对 `ILIKE` 也加速）。**决策**：expand 路径在搜索时也走 `$queryRaw`（同 fold 路径），调用 `hydrateRows` 共享。

实际上为了不重复，**搜索时强制 `groupMode='expand'`**（按 spec §0 Q13 决定）—— 没必要在搜索结果做 group fold（用户找的就是具体文章，不是 cluster）。

### 3.3 新 endpoint: `GET /stats/top-tags`

`apps/api/src/stats/stats.controller.ts` + `stats.service.ts`：

```typescript
@Get('top-tags')
topTags(
  @Query('days', new DefaultValuePipe(30), ParseIntPipe) daysRaw: number,
  @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limitRaw: number,
): Promise<TopTagsDto> {
  const days = Math.min(90, Math.max(1, daysRaw));
  const limit = Math.min(50, Math.max(1, limitRaw));
  return this.service.topTags(days, limit);
}
```

Service 用 `prisma.$queryRaw`：

```sql
SELECT tag, COUNT(*)::int AS count
FROM (
  SELECT unnest("aiTags") AS tag
  FROM hot_news
  WHERE status = 'VISIBLE'
    AND "publishedAt" >= NOW() - INTERVAL '${days} days'
) t
WHERE tag LIKE 'company:%' OR tag LIKE 'model:%' OR tag LIKE 'category:%'
GROUP BY tag
ORDER BY count DESC
LIMIT ${limit};
```

DTO（`packages/types/src/dtos.ts`）：

```typescript
export interface TopTagDto {
  tag: string;
  count: number;
}

export interface TopTagsDto {
  tags: TopTagDto[];
  days: number;
  limit: number;
}
```

### 3.4 BFF route

`apps/web/app/api/stats/top-tags/route.ts` 新建（与现有 stats proxies 同款）。

### 3.5 测试

- `list-hot-news.query.spec.ts` +3 case (q / q trim / q maxLength)
- `hot-news.service.spec.ts` +4 case (q empty / q triggers similarity orderBy / q + tags AND / q + range)
- `stats.service.spec.ts` +3 case (top-tags / limit clamp / days clamp)
- `stats.controller.spec.ts` +2 case (defaults / custom)

---

## 4. Web `/vault` 重写（PR-B）

### 4.1 文件

```
apps/web/app/vault/page.tsx                  ← REWRITE: 完整重写，移除 mockup
apps/web/app/vault/_components/search-input.tsx ← NEW: 搜索框（form submit navigation）
apps/web/app/vault/_components/tag-cloud.tsx    ← NEW: 推荐标签云（top 20 aiTags chip）
apps/web/lib/api.ts                          ← MOD: fetchTopTags + fetchHotNewsList 加 q
```

### 4.2 page.tsx 结构

```tsx
const PAGE_SIZE = 20;
const DEFAULT_RANGE = '30d';  // vault 默认 30d (vs /news 默认 1d)

interface PageProps {
  searchParams: Promise<{
    q?: string;
    tags?: string;
    range?: string;
    sort?: string;
  }>;
}

export default async function VaultPage({ searchParams }) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? '';
  const tags = parseTags(sp.tags);
  const range = parseRange(sp.range) ?? '30d';  // 不 fall back 到 /news 默认 1d
  const sort = parseSort(sp.sort);

  // 并行：搜索结果 + 推荐标签云
  const [data, topTags] = await Promise.all([
    fetchHotNewsList(1, PAGE_SIZE, undefined, sort, { range, tags, q }),
    fetchTopTags(30, 20),
  ]);

  return (
    <>
      <div className="px-9 pt-7 pb-3">
        <PageHeader kicker="Vault" title="内容库" sub={`${data.total} 条 · 跨平台 ${q ? `搜索 "${q}"` : '回看库'}`} />
        <SearchInput initialQ={q} />
        {!q ? <TagCloud tags={topTags.tags} selectedTags={tags} /> : null}
      </div>
      <div className="flex-1 overflow-auto px-9 pb-9">
        {data.items.length === 0 ? (
          <EmptyState message={q ? `没找到 "${q}"，换个关键词试试` : '内容库暂时为空'} />
        ) : (
          <NewsFeed
            initialData={data}
            platforms={['HACKERNEWS', 'REDDIT', 'RSS']}  // vault 全平台
            range={range}
            sort={sort}
            tags={tags}
            q={q}  // SP-12: q 参数透传给 client fetcher
          />
        )}
      </div>
    </>
  );
}
```

### 4.3 NewsFeed 改造（向后兼容）

`apps/web/app/news/_components/news-feed.tsx` 接受可选 `q?: string` prop，loadNext 把 q 透传给 `fetchHotNewsListClient`。/news 页不传 q → 行为完全不变。

### 4.4 SearchInput

```tsx
// 'use client' 因为表单 onSubmit 改 URL，但不依赖 client state — 用 native
// form action navigation 让 SSR 友好。
'use client';
import { useRouter } from 'next/navigation';
export function SearchInput({ initialQ }: { initialQ: string }) {
  const router = useRouter();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const q = String(fd.get('q') ?? '').trim();
        router.push(q ? `/vault?q=${encodeURIComponent(q)}` : '/vault');
      }}
      className="mt-2"
    >
      <input
        name="q"
        type="text"
        defaultValue={initialQ}
        placeholder="搜索热点 · 标题 / 摘要 / 标签 / 关键词"
        className="..."
        maxLength={200}
      />
    </form>
  );
}
```

### 4.5 TagCloud

```tsx
import { Tag } from '@ai-hot-news/ui';

export function TagCloud({ tags, selectedTags }: { tags: TopTagDto[]; selectedTags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {tags.map((t, i) => (
        <Tag
          key={t.tag}
          index={i}
          href={`/vault?tags=${encodeURIComponent(t.tag)}`}
          title={`${t.count} 条命中`}
        >
          {t.tag} · {t.count}
        </Tag>
      ))}
    </div>
  );
}
```

### 4.6 测试

- `search-input.spec.tsx`：submit empty → /vault；submit "Claude" → `/vault?q=Claude`
- `tag-cloud.spec.tsx`：渲染 5 tag + 点击跳转
- `vault/page.spec.tsx`：snapshot URL 解析（如果 vitest infra 允许）

---

## 5. PR 拆分 & 部署 gate

| PR  | 作用域                                                                                              | Deploy 后 smoke                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | migration + DTO `q` + service `q` + new `/stats/top-tags` + BFF route + tests                    | curl `?q=OpenAI` 命中 20+；curl `?q=智能体` 命中 > 0；curl `/stats/top-tags` 返回 20 个                                                                                                                                                                                |
| B   | Web /vault rewrite + SearchInput + TagCloud + NewsFeed q prop + fetchTopTags                     | HTML 含 `name="q"` 表单 + 20 个 tag chip href + 搜索结果列表                                                                                                                                                                                                          |

---

## 6. 风险与回滚

| 风险                                                       | 影响                                  | 缓解                                                                                                                                                |
| ------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| pg_trgm 默认阈值 0.3 对中文 query 召回偏低                       | 中文搜索命中少                          | prod 实测后 SQL `SET pg_trgm.similarity_threshold = 0.2` 调（可在 service 内 per-connection SET 也行）— 不需要 redeploy                                |
| GIN index 加索引慢（prod 1377 rows）                          | migration 卡 deploy step             | < 1s 实际无感；如果未来 row 数膨胀到 100k+ 才会成为问题，那时考虑 partial index                                                                                            |
| 搜索 `?q=` 与 `?sort=heat` 同时存在的排序优先级冲突                  | 行为不明确                            | spec §0 Q6 明确：q 存在时 similarity 第一优先，heat / time 仅作为次排                                                                                              |
| `search_text` 生成列影响 hot_news INSERT 性能                  | ingest 慢                          | 1 column STORED concatenation = 几 µs/row 量级；prod ingest 是 ~150 rows/day 完全无感                                                                            |
| /vault 替换 mockup 后 SP-8 MockupBanner 留在 radar/trends 仍 OK | 风格不一致                            | radar / trends 仍是 mockup（M7 SP-19/20 才接通），banner 留存合理                                                                                                  |
| /stats/top-tags 缓存                                       | 大量重复请求时 DB 压力                       | V1 不缓存（与 SP-9 stats 一致）；后续 SP-15 监控页消费时再加 60s 缓存                                                                                                |

回滚：

- PR-A revert：列保留无影响（hot_news 多个不读列）+ 索引保留（占小磁盘）；如真要彻底回滚，单独 SQL `DROP INDEX + ALTER TABLE DROP COLUMN`。/stats/top-tags 404 自然回滚
- PR-B revert：/vault 回到 mockup（git revert）

---

## 7. M5 收尾完成后路径

| SP   | 衔接                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------- |
| M6 SP-13 | NestJS JWT 极简 admin 认证（~1 day）                                                                                |
| SP-14 | KeywordMonitor CRUD API（消费 /stats/top-tags 给"建议关键词"列表）                                                       |
| SP-15 | 监控页 Radar SVG + 关键词列表（**SP-12 search 直接复用 — 用户在监控页点关键词跳 /vault?q=<keyword>**）                              |
| SP-16 | 命中检测 worker（matchedKeywords 反写 hot_news.matchedKeywords 列 — 本 SP-12 已经把 matchedKeywords 加进 search_text）  |

---

## 8. 后续动作

1. 起草 `docs/superpowers/plans/2026-05-22-sp12-vault-search-plan.md`（任务级 PR 拆分）
2. docs PR
3. PR-A merge → deploy → 6 curl smoke
4. PR-B merge → deploy → /vault 浏览 smoke
5. M5 完整结束 → M6 SP-13 启动
