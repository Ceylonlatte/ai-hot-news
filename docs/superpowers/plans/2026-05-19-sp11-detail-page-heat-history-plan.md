# SP-11 实施计划 — 详情页 + heat_history

**Spec**：[`docs/superpowers/specs/2026-05-19-sp11-detail-page-heat-history-design.md`](../specs/2026-05-19-sp11-detail-page-heat-history-design.md)
**节奏**：3 个 PR，TDD（写失败测试 → 实现 → 通过 → commit）。
**总预计**：~1.5 工作日。
**部署模型**：每个 PR squash-merge to `main` → CI build images → workflow_run trigger Deploy → smoke。

---

## PR-A — heat_history schema + worker upsert

**分支**：`feat/sp11-A-heat-history-schema`
**目标**：新表落地 + cron 每 30min 写 snapshot；list / dashboard / heat cron 零回归。

### Task A1：bucketAt 工具函数 + 单测

- **文件**：
  - `apps/worker/src/heat/bucket-at.ts`
  - `apps/worker/src/heat/bucket-at.spec.ts`
- **核心代码**：
  ```typescript
  /** Round Date down to nearest 30-min boundary (UTC). */
  export function computeBucketAt(date: Date): Date {
    const d = new Date(date);
    d.setUTCSeconds(0, 0);
    const minutes = d.getUTCMinutes();
    d.setUTCMinutes(minutes < 30 ? 0 : 30);
    return d;
  }
  ```
- **测试 case**（vitest）：
  - 14:00:01 → 14:00:00
  - 14:14:59 → 14:00:00
  - 14:29:59 → 14:00:00
  - 14:30:00 → 14:30:00
  - 14:44:59 → 14:30:00
  - 14:59:59 → 14:30:00
- **commit**：`feat(sp11-A): computeBucketAt 30-min UTC alignment helper`

### Task A2：Prisma schema + migration

- **改 `packages/db/prisma/schema.prisma`**：
  - 新 `HeatHistory` model（按 spec §2.1）
  - `HotNews` 加反向 `heatHistory HeatHistory[]`
- **migration**：
  ```bash
  pnpm --filter @ai-hot-news/db exec prisma migrate dev --name add_heat_history
  ```
  - 文件名：`packages/db/prisma/migrations/2026MMDDHHMM_add_heat_history/migration.sql`
  - 必须包含两个 `CREATE INDEX` + `ALTER TABLE ADD CONSTRAINT`。
- **smoke (local)**：`psql -c "\d heat_history"` 显示 5 列。
- **commit**：`feat(sp11-A): heat_history snapshot table + migration`

### Task A3：worker upsert（在 cron processor 内）

- **改 `apps/worker/src/heat/heat.cron.processor.ts`**：
  - 在 NTILE 重排 SQL **之后** 追加一段 raw SQL（spec §3）
  - 用 `computeBucketAt(now)` 算 bucketAt 传参
  - 包一层 `try/catch + logger.error`，history 失败不影响 heat 主流程
- **测试**：扩 `heat.cron.processor.integration.spec.ts`
  - 跑一次 processor → 查 `heat_history.count() === visible_count`
  - 再跑一次同 bucket → count 不增加（UPSERT 幂等）
- **commit**：`feat(sp11-A): worker writes heat snapshot per cron tick`

### Task A4：local lint/typecheck/test/build

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null 2>&1
pnpm --filter @ai-hot-news/db build
pnpm --filter @ai-hot-news/worker test
pnpm -w lint
pnpm -w typecheck
```

### Task A5：开 PR-A

- **commit 列表（最终）**：A1 → A2 → A3
- **PR body**：
  ```
  ## Summary
  - 新建 heat_history 表（30min snapshot，UPSERT 幂等）
  - worker SP-6 cron 在 NTILE 重排后写 snapshot
  - 影响范围：仅 worker；list / dashboard / API 零回归

  ## Test plan
  - [x] computeBucketAt 6 个边界 case
  - [x] worker integration spec：count == visible，重跑幂等
  - [ ] prod smoke：等一次 cron（≤30min）后 `SELECT count(*) FROM heat_history` >= visible_count
  ```

### Task A6：smoke prod（PR-A merge + Deploy 完成后）

```bash
# schema 验证
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U ai_hot_news -d ai_hot_news_prod -c "\d heat_history"'

# 等 30min 后
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U ai_hot_news -d ai_hot_news_prod -c "SELECT count(*) FROM heat_history WHERE \"bucketAt\" > now() - interval '\''1 hour'\'';"'
```

---

## PR-B — detail + heat-history API

**分支**：`feat/sp11-B-detail-api`（基于 PR-A 分支，必要时 rebase 到 main）
**目标**：`GET /hot-news/:id` + `GET /hot-news/:id/heat-history` 两条 endpoint 上线。

### Task B1：DTO 在 `packages/types/src/dtos.ts`

按 spec §4.3 添加 `HotNewsRelatedDto` / `HotNewsDetailDto` / `HeatHistoryItemDto` / `HeatHistoryDto`。

**commit**：`feat(sp11-B): DTOs for hot-news detail + heat-history`

### Task B2：service 单测先行（red）

- **文件**：`apps/api/src/hot-news/hot-news.service.spec.ts`
- 新增 `describe('detail')`：
  - 命中：`prisma.hotNews.findUnique` mock 返回 row → 返回 detail
  - 404：mock 返回 null → service 返回 null
  - related via groupId：mock `findUnique` + `findMany` 返回 5 条
  - related fallback aiTag：groupId=null，aiTags=['a','b']，`findMany` mock 命中
- 新增 `describe('heatHistory')`：
  - hours=24 → mock 返回 48 行
  - hours=48 → mock 返回 96 行
  - hours=72 → mock 返回 144 行
  - hours=100 → 实际查询用 48（dto.hours=48）

**commit**：`test(sp11-B): failing specs for hot-news detail + heat-history service`

### Task B3：service 实现（green）

按 spec §4.2 实现 `detail()` + `heatHistory()`。
**commit**：`feat(sp11-B): HotNewsService.detail + .heatHistory implementations`

### Task B4：controller + spec

- **改 `apps/api/src/hot-news/hot-news.controller.ts`**：加 `@Get(':id')` + `@Get(':id/heat-history')`
- **新 spec case**（mock service）：
  - GET /hot-news/:id 200
  - GET /hot-news/:id 404
  - GET /hot-news/:id/heat-history?hours=72 → service 收到 72
  - GET /hot-news/:id/heat-history?hours=100 → service 收到 48

**commit**：`feat(sp11-B): controller GET /hot-news/:id + heat-history endpoint`

### Task B5：local lint/test/build → 开 PR-B

```bash
pnpm --filter @ai-hot-news/api test
pnpm -w lint
pnpm -w typecheck
```

**PR body**：
```
## Summary
- 新 endpoint：GET /hot-news/:id（带 relatedItems[]）
- 新 endpoint：GET /hot-news/:id/heat-history?hours=24|48|72
- DTO 4 个新接口加在 @ai-hot-news/types
- service spec 9 个 case，controller spec 4 个 case

## Test plan
- [x] hot-news.service.spec：9 case 全过
- [x] hot-news.controller.spec：4 case 全过
- [ ] prod smoke：随便挑一个 list 第一条 id 拉详情 + 拉 history
```

### Task B6：smoke prod

```bash
ID=$(curl -sS 'https://hotnews.shinpeionline.top/api/hot-news?pageSize=1' | python3 -c 'import sys,json;print(json.load(sys.stdin)["items"][0]["id"])')
curl -sS "https://hotnews.shinpeionline.top/api/hot-news/$ID" | head -c 500
curl -sS "https://hotnews.shinpeionline.top/api/hot-news/$ID/heat-history?hours=48"
```

---

## PR-C — Web `/news/[id]` RSC

**分支**：`feat/sp11-C-detail-page`（基于 PR-B 分支）
**目标**：详情页 SSR 真实数据；视觉对齐 SP-9 HomePage。

### Task C1：fetcher 扩展

- **改 `apps/web/lib/api.ts`**：
  ```typescript
  export function fetchHotNewsDetail(id: string): Promise<HotNewsDetailDto> {
    return fetchJson<HotNewsDetailDto>(`/hot-news/${encodeURIComponent(id)}`);
  }
  export function fetchHeatHistory(id: string, hours: 24 | 48 | 72 = 48): Promise<HeatHistoryDto> {
    return fetchJson<HeatHistoryDto>(`/hot-news/${encodeURIComponent(id)}/heat-history?hours=${hours}`);
  }
  ```
- **commit**：`feat(sp11-C): fetchHotNewsDetail + fetchHeatHistory client helpers`

### Task C2：详情页 RSC + 子组件

- **新 `apps/web/app/news/[id]/page.tsx`**（按 spec §5.2-§5.3）：
  - `Promise.all` 两个 fetcher
  - 失败 → `notFound()`
  - Hero 区 + 双栏 + HeatCurve + 相关推荐
- **复用** `@ai-hot-news/ui` 的 `Glass / HeatBadge / HeatCurve / PageHeader / Pill`
- **commit**：`feat(sp11-C): /news/[id] RSC with hero, content, related, heat curve`

### Task C3：相对时间 helper（如未存在）

- **检查** `apps/web/lib/` 下是否已有 `formatRelativeTime`；若无则新加：
  ```typescript
  export function formatRelativeTime(iso: string, now = new Date()): string {
    const then = new Date(iso);
    const diffSec = Math.round((now.getTime() - then.getTime()) / 1000);
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const abs = Math.abs(diffSec);
    if (abs < 60) return rtf.format(-diffSec, 'second');
    if (abs < 3600) return rtf.format(-Math.round(diffSec / 60), 'minute');
    if (abs < 86400) return rtf.format(-Math.round(diffSec / 3600), 'hour');
    return rtf.format(-Math.round(diffSec / 86400), 'day');
  }
  ```
- 单测：5 case（30s / 5min / 2h / 1d / 7d）
- **commit**（如果新加）：`feat(sp11-C): formatRelativeTime intl helper`

### Task C4：local lint/typecheck/test/build

```bash
pnpm --filter @ai-hot-news/web typecheck
pnpm --filter @ai-hot-news/web build
pnpm -w lint
```

### Task C5：开 PR-C

- **PR body**：
  ```
  ## Summary
  - 详情页 /news/[id] 上线（RSC SSR + Promise.all 拉详情+history）
  - 视觉对齐 SP-9 HomePage：Glass / fade-up / HeatCurve / Pill / HeatBadge
  - 相关推荐：groupId 优先 → aiTag fallback（5 条上限，service 层处理）

  ## Test plan
  - [x] formatRelativeTime 5 case
  - [x] page build 通过
  - [ ] prod smoke：手动打开几条详情页，确认 polyline、title、related 正常
  ```

### Task C6：smoke prod

```bash
ID=$(curl -sS 'https://hotnews.shinpeionline.top/api/hot-news?pageSize=1' | python3 -c 'import sys,json;print(json.load(sys.stdin)["items"][0]["id"])')
curl -sS "https://hotnews.shinpeionline.top/news/$ID" > /tmp/detail.html
grep -c 'polyline\|HeatCurve\|相关热点\|↗' /tmp/detail.html
```

---

## 部署 sequence（与 SP-9 一致）

| 步 | 动作                                                       |
| - | -------------------------------------------------------- |
| 1 | PR-A merge → CI build worker image → Deploy → smoke heat_history schema + count |
| 2 | PR-B merge → CI build api image    → Deploy → smoke /hot-news/:id           |
| 3 | PR-C merge → CI build web image    → Deploy → smoke /news/<id>              |

每步 deploy 失败 → 立即 revert（PR-A revert 需 stop worker + drop table SOP；B/C revert 是纯代码回滚）。

---

## 与 SP-9 经验对照（避免重蹈覆辙）

1. **Dockerfile 同步**：本 SP 不引入新 workspace package（utils 已经在了），无需改 `apps/api/Dockerfile` 的 copy 列表。
2. **squash merge 后 main 触发 CI**：现已经验证可靠（PR #33 之后那次 webhook 失败是 GitHub 偶发，不是工作流缺陷）。
3. **GHCR 偶发超时**：若 Deploy 失败在 "Login to GHCR" step，直接 re-run failed jobs；不需要回滚。
4. **api 镜像缺包**：本 SP 不引入新 npm 依赖，仅 prisma client 已自动更新。
