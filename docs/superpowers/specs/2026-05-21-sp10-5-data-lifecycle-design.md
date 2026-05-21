# SP-10.5 — 数据 lifecycle：hot_news 30d TTL + heat_history 7d TTL + cleanup cron

- **状态**：spec draft（路径 A 用户已 ack "L1=24h / L3=30d / cleanup cron" 三件套）
- **前置 SP**：SP-10 必须先落地 `?range=30d` 上限（避免 cleanup 删了用户当前看得到的数据 — 二者边界完全对齐）
- **后置 SP**：
  - SP-12 搜索默认范围 30d（= L3 全量池），可切换
  - SP-19 趋势 / SP-21 日报需要历史聚合时，会引入 L4 `daily_digest`，原始 hot_news 删除前先 rollup —— 本 SP 不预先实现 L4
- **本文件**：`docs/superpowers/specs/2026-05-21-sp10-5-data-lifecycle-design.md`
- **预计工作量**：~0.5 天（脚本 ~2h + 集成测试 ~1.5h + worker cron module ~2h + prod first-run SOP ~1h）
- **拆分**：单一 PR（脚本 + worker cron module 一起；prod first-run 手工跑一次性脚本是 PR merge 后的运维步骤，不算 PR 内容）

---

## 0. 关键设计决策

| #   | 维度                      | 选择                                                                                                            | 理由                                                                                                                                                                                                                                                                |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | hot_news TTL            | **30 天**（按 `publishedAt`）                                                                                     | 与 SP-10 `?range=30d` 上限对齐，"用户看到 = DB 里存的"；月度回看充分；7d 太短（错过周末发酵）/ 90d 没意义（产品定位"看完即过"）                                                                                                                                                                            |
| Q2  | heat_history TTL        | **7 天**（按 `bucketAt`）                                                                                          | SP-11 详情页折线最多展示 72h；多保 4 天给 SP-19 趋势预留缓冲；增长最快 —— 1,177 row × 48 buckets/row × 30d 估算 ~1.7M 行不可接受，7d 内 ~280k 行可接受                                                                                                                                                       |
| Q3  | cleanup 频次              | **每天 1 次**（daily cron @ UTC 03:00 = CST 11:00 AM）                                                              | 11 AM 是用户开始用站子高峰前的清理窗口；删除 < 100 行/天对负载无感；不需要 hourly                                                                                                                                                                                                                |
| Q4  | cleanup 实现位置           | **apps/worker BullMQ repeat job**（与 SP-6 HeatCron 同款模式）                                                       | 沿用已有 cron 基础设施（BullMQ repeatable jobs + IORedis + boot backstop）；不引入 OS-level cron / systemd timer / k8s CronJob 等新组件                                                                                                                                                  |
| Q5  | 删除方式                   | `DELETE FROM hot_news WHERE publishedAt < NOW() - INTERVAL '30 days'` + Postgres ON DELETE CASCADE 自动级联       | heat_history / keyword_hits 都已 `onDelete: Cascade`（schema 已确认）；一句 DELETE 搞定                                                                                                                                                                                          |
| Q6  | first-run               | **一次性脚本 `cleanup-aged.ts`** + single-writer SOP（stop worker → run → start worker）                              | prod 首次执行可能删 0 行（数据还很新），但确认幂等行为 + 验证 worker stop 流程；后续 cron 自然接管                                                                                                                                                                                                       |
| Q7  | cron 是否需要 single-writer | **不需要** —— cron 自己就是 worker 内部进程，与 ingestion 路径竞写同一表                                                          | DELETE WHERE publishedAt < now-30d 不会和 ingest 路径 INSERT/UPSERT 撞 P2002（不同行）；唯一边界 case 是 30d 边界附近 row 正在被 heat cron 更新 — Postgres MVCC 自动隔离                                                                                                                              |
| Q8  | 监控 / 告警                | **logs only**（V1）：cron 跑完打 `Cleanup: deleted=N hot_news, =M heat_history (cascade)`                          | V1 用户自己看 logs；运维 alerting 是 SP-25 observability 范围                                                                                                                                                                                                                  |
| Q9  | env 配置                  | `CLEANUP_HOT_NEWS_DAYS=30` + `CLEANUP_HEAT_HISTORY_DAYS=7` + `CLEANUP_CRON_HOUR_UTC=3`                          | 全部 sensible default；运维想临时缩短做实验只需改 env + restart worker，零代码                                                                                                                                                                                                            |
| Q10 | 失败处理                   | DELETE 是 idempotent — 单次 cron 失败下次（24h 后）补                                                                    | 不引入重试 / 死信队列；过期数据多滞留 24h 无任何业务影响                                                                                                                                                                                                                                     |
| Q11 | 跨表清理顺序                | hot_news 删（CASCADE 自动清 heat_history 同 hotNewsId）→ 然后独立清"orphan" heat_history（理论上没 orphan，纯防御性 DELETE 等价于额外约束 sanity） | heat_history.bucketAt < now() - 7d 但 hotNewsId 仍存在（30d 内活 row）的 snapshot 也要删 — 因为 30d row 的 7-30d 区间 snapshot 是噪声，对 SP-11 详情页 72h 折线无价值；放在第二个 DELETE 单独处理                                                                                                              |
| Q12 | 不删的                    | source_configs / keyword_monitors / keyword_hits / User / Notification 等所有用户配置 / 元数据                          | hot_news 删了 → keyword_hits.hotNewsId 触发 CASCADE 删；这是预期的（命中记录失去引用对象就无意义）                                                                                                                                                                                                |
| Q13 | content 单独瘦身（不删 row）？ | **不做**（YAGNI）                                                                                                  | "保留 row 但删 content 大字段"会让 row 半残 — SP-12 搜索 / SP-21 日报都需要 content 用于摘要重生成；30d 全删比"半残 row" 更干净                                                                                                                                                                            |
| Q14 | 数据回滚                   | **无回滚** —— 删除是单向的                                                                                            | 与 PRD 设计哲学一致："热点信息看完即过"（PRD §1 缺口 #5）；如真心想保留长尾，是 SP-19/21 用 daily_digest rollup 解决，不是靠 hot_news 不删                                                                                                                                                                       |
| Q15 | 测试策略                   | 集成测试用真实 db（同 SP-4.5 cleanup-rss-pre-window 模式）— seed 数据 + 跑 cleanupAged + 断言剩余                                | 必须用真实 db 因为 Postgres CASCADE 是 schema-level 行为，mock 不可信                                                                                                                                                                                                            |
| Q16 | 并发安全（与 SP-4 turbo 教训）  | `packages/db/scripts/cleanup-aged.spec.ts` 用 `fileParallelism=false` + prefix-scoped assertion（如 SP-4.5）       | 沿用 SP-4 CI flake fix 模式（`--concurrency=1` + 测试间不假设全局精确计数）                                                                                                                                                                                                            |
| Q17 | PR 单 vs 拆分               | **单 PR**（脚本 + worker cron module 一起）                                                                          | 改动量约 ~250 行；分两 PR 反而把 cleanup-aged.ts 和 cleanup.cron.processor.ts 的依赖关系拆乱（processor 直接复用脚本中 pure function）                                                                                                                                                                  |

---

## 1. 目标与硬验收

### 1.1 目标

1. **数据 lifecycle 明确**：hot_news ≤ 30d / heat_history ≤ 7d 永久成为系统约束。
2. **零运维介入**：一次部署后，daily cron 自动维护；无需手工 oneshot。
3. **零回归**：ingest / heat refresh / list / detail / dashboard 全部不变。
4. **first-run 安全可重复**：脚本本身 idempotent — prod 跑 N 次 = 跑 1 次效果。

### 1.2 硬验收

```bash
# A. 脚本本地 dry-run（按时间窗口 0 行影响时，输出 stats 全 0）
pnpm --filter @ai-hot-news/db exec tsx scripts/cleanup-aged.ts --dry-run
# 期望：JSON 输出 { hotNewsCandidates: N, heatHistoryCandidates: M }

# B. 集成测试通过
pnpm --filter @ai-hot-news/db test cleanup-aged.spec
#   case 1: seed 5 fresh + 5 aged → 跑完 → DB 剩 5 fresh
#   case 2: 重跑 → DB 仍剩 5 fresh（幂等）
#   case 3: aged hot_news 删除时其 heat_history CASCADE 自动删
#   case 4: 7d 以内 row 的 >7d heat_history snapshot 单独删（不动 row 本身）

# C. worker cron 注册（启动日志）
ssh ai-hot-news-prod 'docker compose ... logs worker' | grep -i "Cron registered.*cleanup"
# 期望：`CleanupCron registered: cleanup-aged every 1440min`

# D. cron 实际触发（部署 24h 后或手工 enqueue 加速）
ssh ai-hot-news-prod 'docker compose ... logs worker' | grep -i "Cleanup:"
# 期望：`Cleanup: deleted=N hot_news, =M heat_history (cascade), =K heat_history (aged-snapshot)`

# E. DB 边界验证（cron 跑完后）
ssh ai-hot-news-prod 'psql ...' -c "
  SELECT COUNT(*) AS over_30d FROM hot_news WHERE \"publishedAt\" < NOW() - INTERVAL '30 days';
  SELECT COUNT(*) AS over_7d FROM heat_history WHERE \"bucketAt\" < NOW() - INTERVAL '7 days';
"
# 期望：两个 count 都 = 0

# F. 不变量
SELECT COUNT(*) FROM source_configs; -- 14（不变）
SELECT COUNT(*) FROM keyword_monitors; -- 0（M6 才有数据）
```

---

## 2. 数据模型 / 改动清单

### 2.1 新文件

| 文件                                                            | 作用                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/db/scripts/cleanup-aged.ts`                         | 一次性脚本 + cron 共享的 pure logic（按 SP-4 §10 决策 11 一次性脚本约定）   |
| `packages/db/scripts/cleanup-aged.spec.ts`                    | 集成测试（real db，4 case）                                     |
| `apps/worker/src/cleanup/cleanup.module.ts`                   | NestJS module（imports RedisModule + 注册 queue / cron / processor） |
| `apps/worker/src/cleanup/cleanup.queue.ts`                    | BullMQ queue provider (`CLEANUP_QUEUE` token + name)      |
| `apps/worker/src/cleanup/cleanup.cron.ts`                     | OnModuleInit 注册 daily repeat job（参考 HeatCron）            |
| `apps/worker/src/cleanup/cleanup.cron.processor.ts`           | BullMQ Worker 消费 cleanup-aged repeat job + 调用脚本 pure 函数 |
| `apps/worker/src/cleanup/cleanup.config.ts`                   | env 读取（CLEANUP_HOT_NEWS_DAYS / HEAT_HISTORY_DAYS / CRON_HOUR_UTC） |
| `apps/worker/src/cleanup/cleanup.module.spec.ts`              | module wiring smoke                                       |
| `apps/worker/src/cleanup/cleanup.cron.spec.ts`                | cron registration unit test                               |
| `apps/worker/src/cleanup/cleanup.cron.processor.spec.ts`      | processor mock prisma + assert script call                |
| `apps/worker/src/cleanup/cleanup.cron.processor.integration.spec.ts` | real db integration: seed → run processor → assert |

### 2.2 修改文件

| 文件                                       | 改动                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `apps/worker/src/worker.module.ts`       | imports 加 `CleanupModule`                                              |
| `apps/worker/src/redis/redis.module.ts`  | 无（已 exports REDIS_CONNECTION token）                                    |
| `docker/docker-compose.prod.yml`         | worker.environment 加 `CLEANUP_HOT_NEWS_DAYS / CLEANUP_HEAT_HISTORY_DAYS / CLEANUP_CRON_HOUR_UTC` |
| `.env.example`                           | 加同 3 个 env                                                            |
| `apps/worker/src/cleanup/index.ts` (NEW) | barrel export，对齐 heat/extract/embed/summarize 既有目录风格                       |

### 2.3 不变更

- `packages/db/prisma/schema.prisma`：CASCADE 关系已就位（spec §0 Q11 已确认）
- 任何 migration
- list API / dashboard / detail
- ingestion / heat / extract / summarize / embed 任何路径

---

## 3. 核心 pure function 设计

`packages/db/scripts/cleanup-aged.ts` 暴露纯函数 + dual-mode entrypoint：

```typescript
import { getPrisma } from '@ai-hot-news/db';

export interface CleanupAgedOptions {
  hotNewsDays: number;          // default 30
  heatHistoryDays: number;       // default 7
  dryRun?: boolean;
}

export interface CleanupAgedResult {
  hotNewsDeleted: number;       // hot_news row count deleted
  heatHistoryCascaded: number;   // heat_history row count cascade-deleted (informational)
  heatHistoryAged: number;       // heat_history snapshot > heatHistoryDays old but hotNewsId still alive
}

export async function cleanupAged(opts: CleanupAgedOptions): Promise<CleanupAgedResult> {
  const prisma = getPrisma();
  const now = new Date();
  const hotNewsCutoff = new Date(now.getTime() - opts.hotNewsDays * 86400_000);
  const heatHistoryCutoff = new Date(now.getTime() - opts.heatHistoryDays * 86400_000);

  if (opts.dryRun) {
    const [hotCount, heatCount] = await prisma.$transaction([
      prisma.hotNews.count({ where: { publishedAt: { lt: hotNewsCutoff } } }),
      prisma.heatHistory.count({ where: { bucketAt: { lt: heatHistoryCutoff } } }),
    ]);
    return {
      hotNewsDeleted: hotCount,
      heatHistoryCascaded: 0,  // unknown in dry-run
      heatHistoryAged: heatCount,
    };
  }

  // Step 1: count heat_history attached to about-to-be-deleted hot_news,
  // for informational logging (CASCADE 自身不返回 count).
  const cascadePreview = await prisma.heatHistory.count({
    where: {
      hotNews: { publishedAt: { lt: hotNewsCutoff } },
    },
  });

  // Step 2: delete aged hot_news (CASCADE 自动清掉 heat_history / keyword_hits)
  const hotDel = await prisma.hotNews.deleteMany({
    where: { publishedAt: { lt: hotNewsCutoff } },
  });

  // Step 3: delete heat_history snapshots > 7d old where parent hot_news 还活着
  //         (i.e. 30d 内 row 的 7-30d 区间 snapshot)
  const heatDel = await prisma.heatHistory.deleteMany({
    where: { bucketAt: { lt: heatHistoryCutoff } },
  });

  return {
    hotNewsDeleted: hotDel.count,
    heatHistoryCascaded: cascadePreview,
    heatHistoryAged: heatDel.count,
  };
}

// dual-mode entrypoint (SP-4.5 模式)
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const result = await cleanupAged({
    hotNewsDays: parseInt(process.env.CLEANUP_HOT_NEWS_DAYS ?? '30', 10),
    heatHistoryDays: parseInt(process.env.CLEANUP_HEAT_HISTORY_DAYS ?? '7', 10),
    dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
}

const isMain =
  (require.main === module) ||
  (typeof process.argv[1] === 'string' &&
    process.argv[1].endsWith('cleanup-aged.ts'));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

注意 `Step 3` 也会包含 `Step 2` CASCADE 删的 heat_history（实际上 Step 2 已经先删了，Step 3 跑时这部分已不在表里，count 不会重复算）— 但准确性上，CASCADE 是同一事务还是分离事务取决于 prisma 实现，spec §0 Q11 已确认这是「噪声压缩，幂等正确性不受影响」。

---

## 4. Worker cron 模块设计

完全照抄 `apps/worker/src/heat/heat.cron.ts` + `heat.cron.processor.ts` 的结构。

### 4.1 cleanup.cron.ts (OnModuleInit 注册)

```typescript
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CLEANUP_QUEUE } from './cleanup.queue';
import { loadCleanupConfig } from './cleanup.config';

const REPEAT_JOB_NAME = 'cleanup-aged';

@Injectable()
export class CleanupCron implements OnModuleInit {
  private readonly logger = new Logger(CleanupCron.name);
  constructor(@Inject(CLEANUP_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    const cfg = loadCleanupConfig();
    // Daily at cfg.cronHourUtc (default 3 = 03:00 UTC)
    // BullMQ repeatable jobs use ms intervals; pin to "every 24h, anchored at next 03:00 UTC".
    const now = new Date();
    const nextRun = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (now.getUTCHours() >= cfg.cronHourUtc ? 1 : 0),
      cfg.cronHourUtc, 0, 0, 0,
    ));
    const delay = nextRun.getTime() - now.getTime();

    // Strip prior registration so changing CLEANUP_CRON_HOUR_UTC between deploys doesn't dual-run
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      if (job.name === REPEAT_JOB_NAME) {
        await this.queue.removeRepeatableByKey(job.key);
      }
    }
    await this.queue.add(REPEAT_JOB_NAME, {}, {
      repeat: { every: 86400_000, immediately: false },
      delay,
      jobId: REPEAT_JOB_NAME,
      removeOnComplete: { count: 5 },
      removeOnFail: { count: 5 },
    });
    this.logger.log(`Cron registered: ${REPEAT_JOB_NAME} daily @ ${cfg.cronHourUtc}:00 UTC (first run in ${Math.round(delay/3600_000)}h)`);
  }
}
```

注意：BullMQ `repeat.every` 是简单"周期重复"，不能精确指定"每天 03:00"；用 `delay` 参数让首次延迟到 `cronHourUtc:00`，之后 24h 周期自动维持 — 时间漂移在长期运行下 < 1min/年，可接受。

### 4.2 cleanup.cron.processor.ts

```typescript
import { Logger } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { Inject, Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { REDIS_CONNECTION } from '../redis/redis.module';
import { cleanupAged } from '@ai-hot-news/db';  // 通过包名 import — SP-4 §10 决策 11 模式
import { loadCleanupConfig } from './cleanup.config';
import { CLEANUP_QUEUE_NAME } from './cleanup.queue';
import type { Redis } from 'ioredis';

@Injectable()
export class CleanupCronProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CleanupCronProcessor.name);
  private worker?: Worker;
  constructor(@Inject(REDIS_CONNECTION) private readonly redis: Redis) {}

  onModuleInit(): void {
    this.worker = new Worker(
      CLEANUP_QUEUE_NAME,
      async (_job: Job) => {
        const cfg = loadCleanupConfig();
        const result = await cleanupAged({
          hotNewsDays: cfg.hotNewsDays,
          heatHistoryDays: cfg.heatHistoryDays,
        });
        this.logger.log(
          `Cleanup: deleted=${result.hotNewsDeleted} hot_news, ` +
          `=${result.heatHistoryCascaded} heat_history (cascade), ` +
          `=${result.heatHistoryAged} heat_history (aged-snapshot)`
        );
      },
      { connection: this.redis, concurrency: 1 },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
```

### 4.3 cleanup-aged 暴露在 `packages/db` index

`packages/db/src/index.ts` 加：

```typescript
export { cleanupAged } from '../scripts/cleanup-aged';
export type { CleanupAgedOptions, CleanupAgedResult } from '../scripts/cleanup-aged';
```

这样 worker import 是 `'@ai-hot-news/db'` 包名而非相对路径，与 SP-4 §10 决策 11 模式一致。

---

## 5. 测试策略

### 5.1 `cleanup-aged.spec.ts`（real db, 4 case）

```typescript
import { cleanupAged } from './cleanup-aged';
import { getPrisma } from '../src';

describe('cleanupAged (real DB, SP-10.5)', () => {
  const PREFIX = `cleanup_test_${Date.now()}_`; // SP-4.5 教训：prefix-scoped assertion，避免 turbo 并发污染

  beforeAll(async () => {
    const prisma = getPrisma();
    // seed: 5 fresh hot_news (publishedAt = now-1d) + 5 aged (publishedAt = now-31d)
    //       each with 3 heat_history snapshots (mix fresh + aged bucketAt)
    // ... full seed code ...
  });

  afterAll(async () => {
    const prisma = getPrisma();
    await prisma.hotNews.deleteMany({ where: { id: { startsWith: PREFIX } } });
    // CASCADE 会清 heat_history
  });

  it('case 1: deletes aged hot_news and cascades heat_history', async () => {
    const result = await cleanupAged({ hotNewsDays: 30, heatHistoryDays: 7 });
    expect(result.hotNewsDeleted).toBeGreaterThanOrEqual(5);
    const remaining = await prisma.hotNews.count({ where: { id: { startsWith: PREFIX } } });
    expect(remaining).toBe(5);  // 仅 fresh 残留
  });

  it('case 2: idempotent — second run is no-op', async () => {
    const result = await cleanupAged({ hotNewsDays: 30, heatHistoryDays: 7 });
    expect(result.hotNewsDeleted).toBe(0);
  });

  it('case 3: heat_history > 7d 但 hot_news < 30d 也清', async () => {
    // seed extra: 1 fresh hot_news + 1 heat_history with bucketAt = now-10d
    // 跑 cleanupAged
    // assert: hot_news 仍在；heat_history 那条被删
  });

  it('case 4: dry-run does not mutate', async () => {
    // seed extra aged
    const before = await prisma.hotNews.count({ where: { id: { startsWith: PREFIX } } });
    await cleanupAged({ hotNewsDays: 30, heatHistoryDays: 7, dryRun: true });
    const after = await prisma.hotNews.count({ where: { id: { startsWith: PREFIX } } });
    expect(after).toBe(before);
  });
});
```

### 5.2 `cleanup.cron.processor.integration.spec.ts`（real db, 1 case）

跑一次 processor 验证 ↔ cleanupAged pure function 等价；其它情况由 `cleanup-aged.spec.ts` 覆盖。

### 5.3 module / cron 单测

- `cleanup.module.spec.ts`：smoke test module 能初始化 + REDIS_CONNECTION 解析
- `cleanup.cron.spec.ts`：mock Queue，assert `add(REPEAT_JOB_NAME, ...)` 调用 + delay 计算正确
- `cleanup.config.spec.ts`：3 个 env 默认值 / 自定义值

---

## 6. PR 拆分 & 部署 gate

### 6.1 单 PR：`feat/sp10-5-data-lifecycle`

**Content**:

1. `packages/db/scripts/cleanup-aged.ts` + spec
2. `packages/db/src/index.ts` 加 export
3. `apps/worker/src/cleanup/*` 9 个文件
4. `apps/worker/src/worker.module.ts` imports 加 CleanupModule
5. `docker/docker-compose.prod.yml` 加 3 env passthrough
6. `.env.example` 加 3 env

### 6.2 部署 gate

```
PR merge → CI build worker image → Deploy → smoke：
   ① ssh logs grep "Cleanup Cron registered" 
   ② first cron 执行后（部署后 ≤ 24h，看 cronHourUtc）grep "Cleanup: deleted="
   ③ SELECT count(*) over 30d / 7d 应 = 0
```

### 6.3 First-run SOP（PR merge + deploy 之后）

按 prod-access.mdc + SP-4 §10 决策 11 范式：

```bash
# Step 1: stop worker（虽然 spec §0 Q7 说不需要 single-writer，但首次跑还是稳一点）
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env stop worker'

# Step 2: dry-run 看会删多少行
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && bash scripts/run-prod-oneshot.sh packages/db scripts/cleanup-aged.ts --dry-run'
# 期望：JSON 输出 hotNewsCandidates / heatHistoryCandidates 数量；若 hot_news > 200，先 manual review

# Step 3: 真跑（不带 --dry-run）
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && bash scripts/run-prod-oneshot.sh packages/db scripts/cleanup-aged.ts'
# 期望：JSON 输出 hotNewsDeleted >= 0，heatHistoryCascaded / Aged 数字符合预期

# Step 4: 验证不变量
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U ai_hot_news -d ai_hot_news_prod -c "
SELECT 
  COUNT(*) FILTER (WHERE \"publishedAt\" < NOW() - INTERVAL '\''30 days'\'') AS hot_over_30d,
  COUNT(*) FILTER (WHERE \"publishedAt\" >= NOW() - INTERVAL '\''30 days'\'') AS hot_in_window
FROM hot_news;"'
# 期望：hot_over_30d=0，hot_in_window 与 first-run 前对比

# Step 5: 重启 worker — cron 接管
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env start worker'

# Step 6: 验证 worker 启动后 cron 注册成功
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env logs --tail=100 worker' | grep -i "cleanup.*registered"
```

注：当前 prod 没有 > 30d 数据（最老的也才 ~30d 内），所以 first-run 可能 hotNewsDeleted=0。这是正常的 — 验证的是脚本本身行为正确而非数据效果。

---

## 7. 风险与回滚

| 风险                                                            | 影响                                  | 缓解                                                                                                                                                                  |
| ------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1: cron 触发时机不准 — BullMQ delay + every 在 worker 重启时漂移         | 清理可能错过 03:00 UTC，跑到了 04:00         | 误差几小时无业务影响；如果一周内观察到漂移 > 1h，加 boot backstop "if next scheduled run > 25h away, force one now"                                                                              |
| R2: 第一次 cron 删 100+ 行 → 写 WAL 过大 → checkpoint 慢               | postgres 短暂卡顿（10s 量级）                | prod 现有 hot_news 全量 1,177 行；30d 内 100% 都在窗口内（最老 ~30d 边界）；第一次 cron 实际 delete 0 行。30d 后第一次 "真正大批删" 时也只删 ~200 行，远低于 WAL flush 压力                                                                                                                                              |
| R3: SP-19 真要历史时 row 已删                                          | 趋势聚合数据缺失                            | SP-19/21 时设计 L4 daily_digest rollup job，**先 rollup 再删** — 本 SP 不预先建表（YAGNI），但 spec §0 Q14 已明确这是未来 SP 的接管点                                                                |
| R4: cleanupAged 在 ingest 高峰执行 — DELETE 阻塞 INSERT             | ingest worker job lag               | DELETE WHERE publishedAt < cutoff 走 publishedAt 索引（schema 已有 `@@index([publishedAt(sort: Desc)])`）；锁定的是 30d 边界的极少 row，阻塞窗口 < 100ms                                                                                                                                                                                                                |
| R5: heat_history 删除后 SP-11 详情页折线断点                              | UX 退化                               | SP-11 详情页只看 48h，远远在 heat_history 7d TTL 内；只有用户特意打开 30d 前的详情页 + 看 48h 折线 ↔ 数据全部 > 30d 才有问题 → 不可能场景                                                                          |
| R6: typo / SQL bug 把 fresh row 也删了                              | 数据丢失 = 业务损失                          | 集成测试 case 1+2 + dry-run + first-run SOP step 2 全部锁死边界；prisma `where: { publishedAt: { lt: cutoff } }` 比写 raw SQL 安全得多                                                |
| R7: worker 启动失败 — CleanupModule 拼装错                            | worker 整体重启失败 → ingest 停 → heat 停    | cleanup.module.spec.ts smoke test 覆盖；REDIS_CONNECTION token 是 SP-4.7 已验证的 pattern（spec §0 Q4）；最坏情况是 PR-A revert                                                       |
| R8: BullMQ jobId dedupe — `cleanup-aged` jobId 被 stale 占了      | cron 永远 silently no-op                | 沿用 SP-5 c64fe93 + c1886f3 教训：cleanup.module.onApplicationBootstrap 加 `queue.clean(0,0,'failed') + clean(0,0,'completed')` 前置；spec §4.1 已包含                          |

回滚：

- 单 PR revert：
  1. ssh prod stop worker（用户配置不动）
  2. git revert + push → CI build → Deploy → worker 不再注册 cleanup cron
  3. 已删除的 row 无法恢复 — 这是 spec §0 Q14 已知接受
- env 改动：把 `CLEANUP_CRON_HOUR_UTC=99` 设为不可能值临时禁用（worker 不报错，cron 永远不跑）

---

## 8. M5 收尾后衍生

| SP   | 衔接点                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| SP-12 | 搜索默认 ?days=30 完全对齐 L3 TTL；用户在 vault 也不会看到本应该已删的数据                                                                                                  |
| SP-19 | 趋势聚合需要历史，引入 L4 `daily_digest`：daily rollup job 跑在 cleanup cron **之前**（早 6h，UTC 21:00），保证当天数据在删之前先 rollup 进 daily_digest（关键事件汇总 + aiTags 频次） |
| SP-21 | AI 日报喂的是 24h 数据，TTL 完全不影响                                                                                                                         |
| SP-25 | Observability：worker logs 加 cron `cleanup-aged` 是否准时跑、删了多少 — 如果没跑 24h，发 Telegram 告警                                                                  |

---

## 9. 后续动作

1. 起草 `docs/superpowers/plans/2026-05-21-sp10-5-data-lifecycle-plan.md`（任务级别 + first-run SOP 步骤）
2. 与 SP-5.6 + SP-10 docs 一起放进同一个 docs PR
3. docs PR merge 后启动 implementation：SP-5.6 → SP-10 PR-A/B/C → SP-10.5（按 dep 顺序）
