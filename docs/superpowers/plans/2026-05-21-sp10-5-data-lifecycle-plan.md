# SP-10.5 实施计划 — 数据 lifecycle TTL + cleanup cron

**Spec**：[`docs/superpowers/specs/2026-05-21-sp10-5-data-lifecycle-design.md`](../specs/2026-05-21-sp10-5-data-lifecycle-design.md)
**节奏**：单 PR + first-run SOP（PR merge 之后手工跑的运维步骤）。
**总预计**：~0.5 工作日（脚本 2h + worker module 2h + 集成测试 1.5h + prod first-run SOP 1h）。
**部署模型**：squash-merge to `main` → CI build worker image → workflow_run trigger Deploy → smoke + first-run SOP。
**前置依赖**：SP-10 PR-A 已 merge（确保 `?range=30d` 真的生效后，TTL 30d 才有产品意义）。

---

## PR — sp10-5 cleanup cron

**分支**：`feat/sp10-5-data-lifecycle`
**目标**：脚本 + worker cron 一起落地，prod first-run 一次性脚本验证 idempotent。

### Task 1：pure function spec 失败先行（red）

- **文件**：`packages/db/scripts/cleanup-aged.spec.ts`
- **改动**：按 spec §5.1 写 4 个集成测试 case：
  - case 1: aged hot_news 删 + heat_history CASCADE 自动清
  - case 2: 重跑 idempotent（hotNewsDeleted=0）
  - case 3: heat_history >7d 但 hot_news <30d 单独清
  - case 4: dry-run 不动数据
- **测试 setup**：用 `PREFIX = cleanup_test_${Date.now()}_` 做 row id 前缀，afterAll 清掉自己的 row；遵循 SP-4.5 fileParallelism=false + prefix-scoped 模式
- **验证**：`pnpm --filter @ai-hot-news/db test cleanup-aged` → RED（脚本未实现）
- **commit**：`test(sp10-5): failing integration specs for cleanupAged`

### Task 2：脚本实现（green）

- **文件**：`packages/db/scripts/cleanup-aged.ts`
- **改动**：按 spec §3 实现 pure function + dual-mode entrypoint
- **验证**：spec GREEN
- **commit**：`feat(sp10-5): cleanupAged pure function + one-shot entrypoint`

### Task 3：packages/db 包导出

- **文件**：`packages/db/src/index.ts`
- **改动**：加 `export { cleanupAged } from '../scripts/cleanup-aged';` + `export type { CleanupAgedOptions, CleanupAgedResult }`
- **验证**：`pnpm --filter @ai-hot-news/db build` 成功；worker 可 import `'@ai-hot-news/db'.cleanupAged`
- **commit**：`feat(sp10-5): re-export cleanupAged from @ai-hot-news/db package`

### Task 4：worker cleanup module 骨架（spec + impl 一起，因为 cron processor 是新模式）

- **新文件**：
  - `apps/worker/src/cleanup/cleanup.queue.ts`
  - `apps/worker/src/cleanup/cleanup.config.ts` + `.spec.ts`
  - `apps/worker/src/cleanup/cleanup.module.ts` + `.spec.ts`
  - `apps/worker/src/cleanup/cleanup.cron.ts` + `.spec.ts`
  - `apps/worker/src/cleanup/cleanup.cron.processor.ts` + `.spec.ts`
  - `apps/worker/src/cleanup/cleanup.cron.processor.integration.spec.ts`
  - `apps/worker/src/cleanup/index.ts`
- **改动**：
  - cleanup.queue.ts: `CLEANUP_QUEUE` token + `CLEANUP_QUEUE_NAME = 'cleanup'` + provider factory
  - cleanup.config.ts: `loadCleanupConfig()` 读 3 个 env，default 30/7/3
  - cleanup.module.ts: imports `[RedisModule]`, providers `[CleanupQueueProvider, CleanupCron, CleanupCronProcessor]`，加 `onApplicationBootstrap` clean failed+completed（沿用 SP-5 c64fe93+c1886f3 模式）
  - cleanup.cron.ts: spec §4.1 实现，OnModuleInit 注册 daily repeat
  - cleanup.cron.processor.ts: spec §4.2 实现，consume → call cleanupAged → log result
- **测试**：
  - cleanup.config.spec: 3 case（default / custom / partial env）
  - cleanup.module.spec: smoke test module 能初始化
  - cleanup.cron.spec: mock Queue，assert add() 调用 + delay 正确
  - cleanup.cron.processor.spec: mock Worker constructor，assert processor 函数正确调用 cleanupAged
  - cleanup.cron.processor.integration.spec: real db seed + processor 执行 + assert effects
- **commit**：`feat(sp10-5): cleanup worker module with daily cron + boot backstop`

### Task 5：worker module 串入

- **文件**：`apps/worker/src/worker.module.ts`
- **改动**：imports 数组加 `CleanupModule`
- **验证**：`pnpm --filter @ai-hot-news/worker build` 成功；worker startup 不抛
- **commit**：`feat(sp10-5): register CleanupModule in worker root`

### Task 6：env / docker compose 透传

- **改 `docker/docker-compose.prod.yml`**：worker.environment 加：
  ```yaml
  CLEANUP_HOT_NEWS_DAYS: ${CLEANUP_HOT_NEWS_DAYS:-30}
  CLEANUP_HEAT_HISTORY_DAYS: ${CLEANUP_HEAT_HISTORY_DAYS:-7}
  CLEANUP_CRON_HOUR_UTC: ${CLEANUP_CRON_HOUR_UTC:-3}
  ```
- **改 `.env.example`**：同 3 个 env 加注释说明
- **commit**：`feat(sp10-5): pass cleanup env vars to worker container`

### Task 7：本地全套绿

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null 2>&1
pnpm --filter @ai-hot-news/db test                       # cleanup-aged.spec
pnpm --filter @ai-hot-news/worker test                    # cleanup.* specs + 既有 heat/embed/summarize 不破
pnpm --filter @ai-hot-news/worker build
pnpm -w lint
pnpm -w typecheck

# 本地 dry-run smoke
pnpm --filter @ai-hot-news/db exec tsx scripts/cleanup-aged.ts --dry-run
# 期望：JSON { hotNewsDeleted: <count>, heatHistoryCascaded: 0, heatHistoryAged: <count> }
```

### Task 8：开 PR

- **PR title**：`feat(sp10-5): hot_news 30d + heat_history 7d TTL via daily cleanup cron`
- **PR body**：
  ```markdown
  ## Summary
  - 新 `packages/db/scripts/cleanup-aged.ts` 一次性脚本 + 集成测试 4 case
  - 新 `apps/worker/src/cleanup/` 模块（CleanupModule + Cron + Processor）
  - 每天 03:00 UTC 自动 DELETE: hot_news.publishedAt < now-30d + heat_history.bucketAt < now-7d
  - hot_news 删 → CASCADE 自动清 heat_history + keyword_hits
  - 沿用 SP-6 HeatCron 同款 BullMQ repeatable job + boot backstop 模式
  - env: CLEANUP_HOT_NEWS_DAYS / CLEANUP_HEAT_HISTORY_DAYS / CLEANUP_CRON_HOUR_UTC

  ## Why
  - 用户产品定位"只关注当天"（路径 A 决策）
  - 与 SP-10 ?range=30d 上限对齐："看到的 = DB 全部存的"
  - 防止数据无限堆积；prod 现在 58MB DB，月增 ~20MB
  - 给 SP-12 搜索 / SP-19 趋势 / SP-21 日报铺好数据边界

  ## Test plan
  - [x] cleanup-aged.spec: 4 个集成 case 全过
  - [x] cleanup.cron / processor / module / config unit tests
  - [x] cleanup.cron.processor.integration.spec: real db end-to-end
  - [ ] prod first-run SOP（详见 plan §First-run SOP）
  - [ ] prod smoke 24h 后看 daily cron log
  ```

### Task 9：First-run SOP（PR merge + Deploy 完成后立即执行）

完全按 spec §6.3 + 项目 prod-access.mdc 规则。

```bash
# Step 1: stop worker（保 single-writer 习惯，虽然 spec §0 Q7 说 cron 不需要）
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env stop worker'

# Step 2: dry-run 看会删多少行
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && bash scripts/run-prod-oneshot.sh packages/db scripts/cleanup-aged.ts --dry-run'
# 期望：JSON 输出 { hotNewsDeleted: 0~10, heatHistoryAged: 0~K }
# 当前 prod 没有 >30d 数据，预期 hotNewsDeleted=0；heatHistoryAged 可能有少量

# Step 3: 真跑
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && bash scripts/run-prod-oneshot.sh packages/db scripts/cleanup-aged.ts'
# 期望：JSON 数字与 dry-run 一致或更小（dry-run 到真跑之间可能又老化几行）

# Step 4: 不变量验证
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U ai_hot_news -d ai_hot_news_prod -v ON_ERROR_STOP=1 -c "
SELECT
  COUNT(*) FILTER (WHERE \"publishedAt\" < NOW() - INTERVAL '\''30 days'\'') AS hot_over_30d_should_be_0,
  COUNT(*) FILTER (WHERE \"publishedAt\" >= NOW() - INTERVAL '\''30 days'\'') AS hot_in_window
FROM hot_news;
SELECT
  COUNT(*) FILTER (WHERE \"bucketAt\" < NOW() - INTERVAL '\''7 days'\'') AS heat_over_7d_should_be_0,
  COUNT(*) FILTER (WHERE \"bucketAt\" >= NOW() - INTERVAL '\''7 days'\'') AS heat_in_window
FROM heat_history;
SELECT COUNT(*) AS source_configs_unchanged FROM source_configs;  -- 应该 = 14
"'

# Step 5: 重启 worker → cron 自动注册接管
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env start worker'

# Step 6: cron 注册日志验证（worker 启动后 ~5s）
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env logs --tail=200 worker' | grep -iE "cleanup|Cron registered"
# 期望看到：
#   "[CleanupCron] Cron registered: cleanup-aged daily @ 3:00 UTC (first run in Nh)"
#   "[CleanupModule] Boot backstop ... cleaned failed/completed"
```

### Task 10：24h 后再验

```bash
# 等 03:00 UTC 之后（北京 11 AM）
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env logs --since=24h worker' | grep -iE "Cleanup:"
# 期望：包含一行
#   "[CleanupCronProcessor] Cleanup: deleted=0 hot_news, =0 heat_history (cascade), =M heat_history (aged-snapshot)"
# 数字会随时间增长但 hot_news 在前 30 天会一直是 0（无数据触达 cutoff）
```

---

## 部署 sequence（在路径 A 中的位置）

```
SP-5.6 merge + deploy + 24h ack (OpenSource/Funding 真出现)
   ↓
SP-10 PR-A merge + deploy + smoke
   ↓
SP-10 PR-B merge + deploy + smoke
   ↓
SP-10 PR-C merge + deploy + smoke
   ↓
SP-10.5 merge + deploy + First-run SOP（Task 9）
   ↓
M5 完整收尾，进 SP-12 VaultPage 搜索
```

注意 SP-10.5 **要在 SP-10 PR-A 之后**，因为 ?range=30d 必须先生效；如果先上 TTL 后上 ?range=30d，用户能在 UI 切到 30d 但看到的列表是 DB 全部存的（也许更多 / 更少），有"内部不一致"风险。SP-10 PR-A 是 API 改动 + 前向兼容，merge 后单独 deploy 安全。

---

## 与 SP-4 / SP-4.5 / SP-6 经验对照

1. **一次性脚本架构契约**（SP-4 §10 决策 11 + SP-4.5 sealed）：脚本用 `'@ai-hot-news/db'` 包名 import；worker Dockerfile 已 `COPY packages/db/scripts`；prod 跑用 `scripts/run-prod-oneshot.sh packages/db scripts/<file>.ts`。本 SP 完全遵守。

2. **集成测试 fileParallelism=false 契约**（SP-4.5）：`packages/db/vitest.config.ts` 已锁；新 spec `cleanup-aged.spec.ts` 用 prefix-scoped assertion 避免 turbo 并发污染。**关键**：spec 必须用 `id: { startsWith: PREFIX }` 而不是 `count()` 整表 assertion。

3. **BullMQ 模式契约**（SP-5/SP-6/SP-11 reinforced）：
   - 每个 NestJS Module imports `[RedisModule]` 共享 `REDIS_CONNECTION` token（SP-4.7 sealed）
   - `onApplicationBootstrap` 必须 `queue.clean(0,0,'failed') + clean(0,0,'completed')`，否则 jobId dedupe 会让 cron 永久 silently no-op（SP-5 c64fe93+c1886f3 教训）
   - 本 SP cleanup.module.ts 必须有 onApplicationBootstrap 实现该模式

4. **Prisma deleteMany + CASCADE 正确性**：schema 已确认 `HeatHistory.hotNews onDelete: Cascade` + `KeywordHit.hotNews onDelete: Cascade`；DELETE FROM hot_news 自动级联清子表 — 不需要手工写两段 DELETE。

5. **Cron 时间漂移容忍**：BullMQ `repeat.every` 是简单周期重复，不是真 cron expression；spec §4.1 用 `delay` 把首次锚到 03:00 UTC，之后 24h 周期维持。一年漂移 < 1min，可接受 — 不引入 cron-parser 等额外依赖。
