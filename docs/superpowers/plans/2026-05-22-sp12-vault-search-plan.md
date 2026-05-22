# SP-12 实施计划 — VaultPage 搜索 + pg_trgm

**Spec**：[`docs/superpowers/specs/2026-05-22-sp12-vault-search-design.md`](../specs/2026-05-22-sp12-vault-search-design.md)
**节奏**：2 PR，TDD。
**总预计**：~1 工作日。
**部署模型**：每 PR squash → CI → Deploy → smoke。

---

## PR-A — API：?q= + pg_trgm migration + /stats/top-tags

**分支**：`feat/sp12-A-search-api`

### Task A1：Prisma migration

- `pnpm --filter @ai-hot-news/db exec prisma migrate dev --name add_search_text_column`
- 在生成的 migration.sql 内**完整替换**为 spec §2.1 内容（Prisma 不会自动生成 EXTENSION + GENERATED COLUMN + GIN，要手写 raw SQL）
- 验证：本地 dev DB `\d hot_news` 看到 search_text + idx
- **commit**：`feat(sp12-A): add search_text generated column + pg_trgm GIN index`

### Task A2：DTO `q` field (failing test first)

- `apps/api/src/hot-news/dto/list-hot-news.query.spec.ts` 加 5 case (default undefined / 'OpenAI' / trim / maxLength reject / 中文)
- 写完 → RED
- 实现：DTO 加 `@IsString @MaxLength(200) @Transform(trim) q?: string`
- → GREEN
- **commits**: `test(sp12-A): failing specs for ListHotNewsQuery q` + `feat(sp12-A): ListHotNewsQuery accepts q filter`

### Task A3：Service ?q= (failing test first)

- `apps/api/src/hot-news/hot-news.service.spec.ts` 加 5 case：
  - q 不传 → 不调 search-specific code path (默认行为)
  - q="OpenAI" → fold raw SQL 含 `search_text %` + `similarity(...) DESC`
  - q + tags AND
  - q + range=7d
  - q + sort=heat (heat 第二优先)
- → RED
- 实现：service.list 签名加 `query?: string`；fold 路径 raw SQL 加 `AND search_text % ${query}::text` + ORDER BY `similarity DESC` 前置
- → GREEN
- **commits**: `test(sp12-A): failing specs for list service q similarity search` + `feat(sp12-A): list service overlays trigram search when q is set`

### Task A4：Controller 透传

- `hot-news.controller.spec.ts` +2 case (q='X' / q+range 透传)
- `hot-news.controller.ts` list() 加 `query.q` 透传
- **commit**: `feat(sp12-A): controller passes q through to list service`

### Task A5：`/stats/top-tags`

- `packages/types/src/dtos.ts` 加 `TopTagDto` / `TopTagsDto`
- `apps/api/src/stats/stats.service.spec.ts` 加 3 case：
  - 默认 days=30 limit=20 → raw SQL 参数化 OK
  - limit clamp 100→50
  - days clamp 365→90
- `stats.service.ts` 加 `topTags(days, limit)` 用 `$queryRaw`
- `stats.controller.ts` 加 `@Get('top-tags')` 入口
- `stats.controller.spec.ts` +2 case
- **commits**: `test(sp12-A) failing for top-tags` + `feat(sp12-A): /stats/top-tags endpoint`

### Task A6：BFF route

- 新建 `apps/web/app/api/stats/top-tags/route.ts`，参考 `app/api/stats/sources/route.ts`
- **commit**: `feat(sp12-A): BFF proxy /api/stats/top-tags`

### Task A7：local 全套 + 集成 smoke

```bash
pnpm --filter @ai-hot-news/db exec prisma migrate dev   # 应用新 migration
pnpm --filter @ai-hot-news/db build
pnpm --filter @ai-hot-news/api test
pnpm turbo run lint typecheck
```

本地起 api + db smoke：

```bash
curl 'http://localhost:4000/hot-news?q=OpenAI&pageSize=3' | jq
curl 'http://localhost:4000/stats/top-tags?days=30&limit=10' | jq
```

### Task A8：开 PR-A + prod smoke

```bash
# 部署后
curl -sS 'https://hotnews.shinpeionline.top/api/hot-news?q=OpenAI&range=30d&pageSize=5' | jq '{total, sample_titles: [.items[].title]}'
curl -sS 'https://hotnews.shinpeionline.top/api/hot-news?q=智能体&range=30d&pageSize=3' | jq '.total'
curl -sS 'https://hotnews.shinpeionline.top/api/hot-news?q=Claude&tags=category:Release&range=30d' | jq '.items[].aiTags'
curl -sS 'https://hotnews.shinpeionline.top/api/stats/top-tags?days=30&limit=20' | jq '.tags | length, .tags[0]'
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U ai_hot_news -d ai_hot_news_prod -c "\dx pg_trgm; \d hot_news;" | head -50'
# 默认行为零回归
curl -sS 'https://hotnews.shinpeionline.top/api/hot-news?pageSize=1' | jq '{total, baseline: .items[0].id}'
```

---

## PR-B — Web：/vault 搜索页重写

**分支**：`feat/sp12-B-vault-page`（基于 PR-A 已 merge 后的 main）

### Task B1：fetchHotNewsList 加 q + fetchTopTags

- `lib/api.ts`：
  - `ListFilterOptions` 加 `q?: string`
  - `buildHotNewsQueryString` 加 q 处理
  - `fetchHotNewsListClient` 同步加
  - 新加 `fetchTopTags(days, limit): Promise<TopTagsDto>`
- **commit**: `feat(sp12-B): fetchHotNewsList accepts q + fetchTopTags helper`

### Task B2：SearchInput 组件 + spec

- `apps/web/app/vault/_components/search-input.tsx`：'use client'，form submit → router.push
- `apps/web/app/vault/_components/search-input.spec.tsx`：4 case（空 / 有内容 / 中文 / 超长截断 200）
- **commits**: `test(sp12-B): failing specs SearchInput` + `feat(sp12-B): SearchInput client component`

### Task B3：TagCloud 组件 + spec

- `apps/web/app/vault/_components/tag-cloud.tsx`：复用 Tag atom 的 href
- spec：5 case (空 tag / 5 tag 渲染 / 选中高亮 / click URL 构造 / count 显示)
- **commits**: `test(sp12-B): failing specs TagCloud` + `feat(sp12-B): TagCloud component`

### Task B4：NewsFeed 加 q prop

- `apps/web/app/news/_components/news-feed.tsx` props 加 `q?: string`
- loadNext 把 q 透传给 fetchHotNewsListClient
- spec 加 1 case：q 透传
- **commit**: `feat(sp12-B): NewsFeed accepts q for vault search infinite scroll`

### Task B5：/vault page rewrite

- 完全替换 `apps/web/app/vault/page.tsx`（按 spec §4.2）
- 删 MockupBanner 引用（vault 内）
- **commit**: `feat(sp12-B): /vault search page rewrite (SearchInput + TagCloud + NewsFeed)`

### Task B6：local typecheck + build + test

```bash
pnpm --filter @ai-hot-news/web test
pnpm --filter @ai-hot-news/web typecheck
pnpm --filter @ai-hot-news/web build
pnpm turbo run lint
```

### Task B7：开 PR-B + smoke

```bash
# 部署后
curl -sS 'https://hotnews.shinpeionline.top/vault' -o /tmp/vault.html
grep -cE 'name="q"|tag-cloud|tags=company%3A' /tmp/vault.html

# 手工浏览：
# 1. 进 /vault → 显示 20 个 tag chip + 30d 全量列表
# 2. 输入 "OpenAI" → URL 变 /vault?q=OpenAI → 列表过滤
# 3. 输入中文 "智能体" → 看结果
# 4. 点 tag chip → URL 跳转 /vault?tags=<tag>
# 5. 滚动 → IntersectionObserver 加载下一页
```

---

## 部署 sequence

```
PR-A merge → CI (api + worker build, web 没必要) → Deploy → smoke 6 个 curl
   ↓
PR-B merge → CI (web build) → Deploy → smoke /vault HTML + 手工浏览
   ↓
M5 整体完成 ★ → M6 SP-13 开启
```

---

## 与既有 SP 经验对照

1. **Migration 模式**（SP-11 add_heat_history 同款）：纯加列 + 索引 + 加 extension，无需 single-writer stop worker（生成列同步写）。
2. **`?q` API 前向兼容**（SP-10 PR-A 同款）：旧 client 完全不变；新参数 optional。
3. **/stats/top-tags 与 SP-9 stats 模式一致**：BFF route 加进 `apps/web/app/api/stats/`。
4. **NewsFeed q prop**：sleek extension，不破 /news；同款 client component 双场景复用。
5. **vitest infra 已就位**（SP-10 PR-B 装好）：直接写 spec，不需要再装 jsdom + RTL。
6. **typedRoutes 兼容**（SP-4.5 教训）：/vault?... 同样用 `<Link href={...}>` 字符串 — vault 路径是静态 segment，typedRoutes OK。
