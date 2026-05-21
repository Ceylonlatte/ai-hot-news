# SP-10 实施计划 — FeedPage filter + 双列 + 无限滚动

**Spec**：[`docs/superpowers/specs/2026-05-21-sp10-feedpage-filter-infinite-design.md`](../specs/2026-05-21-sp10-feedpage-filter-infinite-design.md)
**节奏**：3 个 PR，TDD（写失败测试 → 实现 → 通过 → commit）。
**总预计**：~3 工作日。
**部署模型**：每个 PR squash-merge to `main` → CI build images → workflow_run trigger Deploy → smoke。
**前置依赖**：SP-5.6 必须先 merge + deploy（taxonomy v4 提供 10 个 category，PR-B 的 CategoryChips 直接 hardcode 10 个）

---

## PR-A — API：range + tags filter

**分支**：`feat/sp10-A-list-filter-api`
**目标**：`GET /hot-news` 接受 `?range=1d|7d|30d&tags=a,b`，前向兼容（无新参数行为不变）。

### Task A1：DTO 单测先行（red）

- **文件**：`apps/api/src/hot-news/dto/list-hot-news.query.spec.ts`（若不存在则新建）
- **改动**：6 个 case
  - `range` 缺省 → undefined
  - `range='1d'` / `'7d'` / `'30d'` → 接受
  - `range='invalid'` → IsIn 校验失败
  - `tags='a,b,c'` → transform 后 = `['a', 'b', 'c']`
  - `tags=' a , b '` → transform trim → `['a', 'b']`
  - `tags=''` → undefined（空字符串过滤掉）
- **验证**：RED（field 不存在）
- **commit**：`test(sp10-A): failing specs for ListHotNewsQuery range + tags`

### Task A2：DTO 实现（green）

- **文件**：`apps/api/src/hot-news/dto/list-hot-news.query.ts`
- **改动**：按 spec §2.1，加 `range?` / `tags?` 两个可选字段 + 导出 `RANGE_HOURS_MAP` / `AllowedRange`
- **验证**：DTO test GREEN
- **commit**：`feat(sp10-A): ListHotNewsQuery accepts range + tags filters`

### Task A3：service 单测先行（red）

- **文件**：`apps/api/src/hot-news/hot-news.service.spec.ts`
- **改动**：在 `describe('list')` 内加 8 个 case
  - 不传 range 不传 tags → where 跟旧版本相同
  - `range='1d'` → where.OR[*].publishedAt.gte ~= now-24h（用 toBeCloseToDate helper）
  - `range='7d'` → where.OR[*].publishedAt.gte ~= now-7d（注意这覆盖了 community 默认 48h）
  - `range='30d'` → where.OR[*].publishedAt.gte ~= now-30d
  - `tags=['category:Opinion']` → where 含 `aiTags: { hasEvery: [...] }`
  - `tags=['category:Opinion', 'company:OpenAI']` → AND 两个
  - `range='7d' + tags=['category:Tooling']` 组合 → where 同时含两段
  - `groupMode='fold' + tags` → raw SQL 路径调用，spy 拿 query 含 `@>` 操作符
- **验证**：RED
- **commit**：`test(sp10-A): failing specs for list service range + tags filters`

### Task A4：service 实现（green）

- **文件**：`apps/api/src/hot-news/hot-news.service.ts`
- **改动**：
  - `list()` 签名加 `range?: AllowedRange, tags?: string[]`
  - 计算 `userHours`，覆盖 platform window（按 spec §2.2）
  - `where` 加 `aiTags: { hasEvery: tags }` 子句（当 tags 非空）
  - raw SQL fold 路径 `whereSql` 加 `AND "aiTags" @> ${tags}::text[]`（按 spec §2.3）
- **验证**：service spec GREEN
- **commit**：`feat(sp10-A): list service applies range + tags filters`

### Task A5：controller 透传 + spec

- **文件**：`apps/api/src/hot-news/hot-news.controller.ts` + spec
- **改动**：list() 把 query.range / query.tags 传给 service；controller spec 加 2 个 case 验证透传
- **commit**：`feat(sp10-A): controller passes range + tags to list service`

### Task A6：本地全套绿 + 集成 smoke

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null 2>&1
pnpm --filter @ai-hot-news/api test
pnpm -w lint
pnpm -w typecheck

# 起本地 api + db，跑 curl smoke
pnpm --filter @ai-hot-news/db dev:up    # postgres up
pnpm --filter @ai-hot-news/api dev &
curl 'http://localhost:4000/hot-news?range=1d&pageSize=5' | jq '.total'
curl 'http://localhost:4000/hot-news?tags=category:Opinion&pageSize=5' | jq '.items[0].aiTags'
```

### Task A7：开 PR-A

- **PR body**：
  ```markdown
  ## Summary
  - `GET /hot-news` 新增 `?range=1d|7d|30d` + `?tags=a,b,c`
  - 前向兼容：旧 client（SP-9 fetchHotNewsList、SP-11 etc.）无新参数行为完全不变
  - range 显式覆盖 platform window（用户选 7d 真看 7d）
  - tags 多 tag AND 语义（hasEvery / Postgres @>）
  - DTO 6 case + service 8 case + controller 2 case 全过

  ## Test plan
  - [x] DTO / service / controller unit tests
  - [ ] prod smoke: curl 4 个组合验证 total + items[].publishedAt 边界
  ```

### Task A8：smoke prod

```bash
# 默认行为不变
curl -sS 'https://hotnews.shinpeionline.top/api/hot-news?pageSize=1' | jq '{total, sample: .items[0].id}'

# range=1d
curl -sS 'https://hotnews.shinpeionline.top/api/hot-news?range=1d&pageSize=50' | jq '{total, oldest: (.items | map(.publishedAt) | min)}'

# tags=category:Opinion
curl -sS 'https://hotnews.shinpeionline.top/api/hot-news?range=30d&tags=category:Opinion&pageSize=5' | jq '.items[].aiTags'

# tags 多 AND
curl -sS 'https://hotnews.shinpeionline.top/api/hot-news?range=30d&tags=category:Opinion,company:OpenAI&pageSize=5' | jq '.items[].aiTags'
```

---

## PR-B — Web：filter UI（range/sort tabs + category chips + tag href）

**分支**：`feat/sp10-B-filter-ui`（基于 PR-A 分支或 rebase 到 main）
**目标**：`/news` 顶部加 3 个 filter 控件 + 卡片 tag 可点击；分页仍保留（PR-C 才换无限滚动）。

### Task B1：Tag 组件改造 + spec（packages/ui）

- **文件**：`packages/ui/src/atoms/tag.tsx` + `packages/ui/src/atoms/tag.spec.tsx`（新建）
- **改动**：
  - `Tag` 接受可选 `href?: string` + `title?: string`
  - href 存在 → 渲染 `<a>`，否则 `<span>`
  - 加 hover effect for `<a>` 版本
- **测试**：2 case（href / no href）
- **commit**：`feat(sp10-B): Tag atom accepts optional href`

### Task B2：search params parser 工具

- **文件**：`apps/web/app/news/_components/search-params.ts`（NEW）
- **改动**：3 个 pure 函数 + spec
  - `parseRange(raw?: string): '1d' | '7d' | '30d'`（default '1d'）
  - `parseTags(raw?: string): string[]`（split by ',', trim, filter empty）
  - `parseSort(raw?: string): 'time' | 'heat'`（default 'time'）
  - URL helper：`buildNewsUrl({ tab, range, tags, sort })` → 构造 `/news?...` UrlObject
- **测试**：覆盖 default / invalid / 空字符串 / 多 tag
- **commit**：`feat(sp10-B): search params parsers + URL builder for /news`

### Task B3：RangeTabs / SortTabs / CategoryChips 组件 + spec

- **文件**：3 个组件文件 + 3 个 spec 文件
- **改动**：
  - `range-tabs.tsx`：3 个 Link，按 `active` 高亮，URL 拼接 buildNewsUrl
  - `sort-tabs.tsx`：2 个 Link，同
  - `category-chips.tsx`：11 个 chip（"全部" + 10 category），点击逻辑：
    - "全部"：tags 清空
    - 其他：toggle `category:${name}` 在 tags 数组里
- **测试**：每个组件 4-5 case URL 构造 + 高亮状态
- **commit**：`feat(sp10-B): range / sort / category chip components`

### Task B4：fetchHotNewsList 扩参 + spec

- **文件**：`apps/web/lib/api.ts` + 单测（如 vitest infra 缺则跳过）
- **改动**：按 spec §4.4，加 `options: ListFilterOptions` 参数
- **commit**：`feat(sp10-B): fetchHotNewsList accepts range/tags/sort options`

### Task B5：page.tsx 串通

- **文件**：`apps/web/app/news/page.tsx`
- **改动**：
  - searchParams 类型加 range/tags/sort
  - parse 三参数 → 传给 fetchHotNewsList
  - PageHeader 下加 RangeTabs / SortTabs / CategoryChips
  - Pagination 暂时保留（PR-C 才删）
- **commit**：`feat(sp10-B): wire range/sort/category filters into /news RSC`

### Task B6：NewsItem 内 Tag href 注入

- **文件**：`apps/web/app/news/_components/news-item.tsx`
- **改动**：`<Tag>` 加 `href` + `title` 属性（按 spec §3.6）
- **commit**：`feat(sp10-B): clickable aiTag chips in NewsItem`

### Task B7：local typecheck/build/test

```bash
pnpm --filter @ai-hot-news/ui test
pnpm --filter @ai-hot-news/web typecheck
pnpm --filter @ai-hot-news/web build
pnpm -w lint
```

### Task B8：开 PR-B + smoke

```bash
# 部署后
curl -sS https://hotnews.shinpeionline.top/news | grep -E 'range=7d|category:|sort=heat'
# HTML 含三套 filter 的 anchor href

# 手工浏览：访问 /news?range=7d&tags=category:Opinion → 顶部 chip "观点" 高亮 + range "近 7 天" 高亮
```

---

## PR-C — Web：双列 + 无限滚动

**分支**：`feat/sp10-C-infinite-scroll`（基于 PR-B 分支）
**目标**：换 client component NewsFeed，IO 无限滚动，双列 grid。

### Task C1：NewsFeed client component + spec

- **文件**：`apps/web/app/news/_components/news-feed.tsx` + `news-feed.spec.tsx`
- **改动**：按 spec §4.2 实现
  - props: initialData / tab / platforms / range / tags / sort
  - state: pages / loading / done
  - IO 在 sentinel ref，rootMargin '600px 0px'
  - loadNext 拼下一页 + 判 done
- **测试**：
  - mock IntersectionObserver
  - initial render = initialData
  - 触发 IO → fetch 第 2 页 → items 增量
  - total 已达 → done=true
  - fetch 抛错 → loading=false，console.error
- **commit**：`feat(sp10-C): NewsFeed client component with intersection observer`

### Task C2：NewsFeedSkeleton 占位

- **文件**：`apps/web/app/news/_components/news-feed-skeleton.tsx`
- **改动**：4 个 Glass shimmer placeholder，2x2 grid
- **commit**：`feat(sp10-C): NewsFeedSkeleton for loading state`

### Task C3：NextRangeLink + done state UI

- **文件**：作为 news-feed.tsx 的内部小组件即可，不单独成文件
- **改动**：按 spec §4.3 NEXT_RANGE_MAP；done=true 时渲染 "已加载全部 N 条 · 看更早 →"
- **commit**：`feat(sp10-C): end-of-feed marker with next-range link`

### Task C4：page.tsx 切换 + 删 Pagination

- **文件**：`apps/web/app/news/page.tsx`
- **改动**：
  - 删 Pagination import + 调用
  - 渲染部分用 `<NewsFeed initialData={data} ... />` 替代旧 div + map + Pagination
- **DELETE**：`apps/web/app/news/_components/pagination.tsx`（及其 spec 如果有）
- **commit**：`refactor(sp10-C): replace pagination with infinite NewsFeed`

### Task C5：双列 grid

- **改动**：NewsFeed 内 wrapper class 从 `space-y-3` 改 `grid grid-cols-1 md:grid-cols-2 gap-3`
- **commit**：`feat(sp10-C): two-column grid on desktop`（可与 C1 合并）

### Task C6：local typecheck/build/test

```bash
pnpm --filter @ai-hot-news/web test
pnpm --filter @ai-hot-news/web typecheck
pnpm --filter @ai-hot-news/web build
pnpm -w lint
```

### Task C7：开 PR-C + smoke

```bash
# 部署后
curl -sS https://hotnews.shinpeionline.top/news | grep -E 'md:grid-cols-2'

# 手工浏览：
# 1. 默认进入 → 看到 20 条 1d 内热点，双列布局
# 2. 滚到底 → 自动加载 → 20 → 40 条
# 3. 滚到全部加载完 → 底部 "已加载全部 N 条 · 看更早 →" 链接（点击跳 ?range=7d）
# 4. 点击 chip "OpenSource" → 列表变成只含 category:OpenSource 的 row
# 5. 点击卡片内 tag → URL 跳 /news?tags=...
```

---

## 部署 sequence（与 SP-5.6 → SP-10 顺序）

| 步 | 动作                                                                                |
| - | --------------------------------------------------------------------------------- |
| 0 | SP-5.6 merge + deploy + 24h 验证 OpenSource/Funding chip 有真实数据                       |
| 1 | PR-A merge → CI build api image → Deploy → smoke 4 个 curl 组合                       |
| 2 | PR-B merge → CI build ui + web image → Deploy → smoke chip / range / sort URL 切换 |
| 3 | PR-C merge → CI build web image → Deploy → smoke 双列 + 无限滚动 + 看更早链接                   |

每步 deploy 失败 → revert 当前 PR；PR-A revert 是纯代码回滚（DTO 退回，service 退回），PR-B / PR-C 也是。

---

## 与 SP-4.5 / SP-9 / SP-11 经验对照

1. **`typedRoutes:true` 兼容**：所有 `<Link href>` 含动态拼接的字符串必须用 `UrlObject` 形式 `{pathname:'/news', query:{...}}`，**不能**用模板字符串 — SP-4.5 已踩过坑。CategoryChips / RangeTabs / SortTabs 全部走 UrlObject。
2. **`apps/web` 测试基础设施**：SP-4.5 已经标过 implicit debt — Web 包至今 `test` script 是 `echo 'no tests yet (P4)'`。本 SP PR-B / PR-C 引入了 client 组件，应该**借机**装 vitest+jsdom+RTL infrastructure，但**不**作为本 SP 阻塞项 — 如果时间紧，client spec 用 mock 风格的纯 reducer 测试代替 RTL（news-feed reducer 是 pure function 抽象时易于单测）。
3. **API 升级前向兼容**：PR-A 完成后但 PR-B 未上线时，prod `/news` 仍是旧 UI 走旧 fetchHotNewsList 调用，新 query 参数完全不被前端使用 — 不破任何东西。
4. **`docker/docker-compose.prod.yml` 透传**：本 SP 零新 env var，compose 不需要改。
5. **Aurora 视觉一致性**：所有新组件复用 `@ai-hot-news/ui` 的 `Glass` / `Pill` / `HeatBadge` / `Tag`，颜色全部走 `var(--grad)` / `var(--aurora)` / `var(--aurora-soft)` / `var(--ink)` tokens — 与 SP-8 design system 严格对齐，避免视觉漂移（参考 PR #30 SP-8 drift fix 教训）。
