# SP-7 — pgvector 跨平台热点合并

- **状态**：PR-α 实现完成，等 prod 部署 + backfill smoke；PR-β 本地代码就绪
- **依赖**：
  - SP-5 v3.4 已完成（titleZh + summary 是 embedding 输入源）
  - SP-4.7（ArticleExtractor + antibot 兜底，确保 content 不污染）
  - 一次性脚本范式（SP-4 §10 决策 11）
- **本文件**：`docs/superpowers/specs/2026-05-08-sp7-pgvector-cross-platform-merge-design.md`
- **预计工作量**：~2 天（embed worker 模块 + group 算法 + backfill 脚本 + UI 列表 group badge + 集成测试）

---

> **🛠️ ADR v2（2026-05-15）— Embedding provider 改为 OpenRouter 路由**
>
> 原 spec 选 **OpenAI direct `/v1/embeddings`** 作为 embedding provider，理由（§0
> 表 row 1 + §6 风险表 row 3）写的是 "OpenRouter 不暴露 embeddings 接口"。
> **该陈述在 spec 起草时（2026-05-08）正确，但在 PR-α 实现完成、准备上线阶段
> （2026-05-15）核查发现 OpenRouter 现已上线 OpenAI-compatible embeddings 端点**：
>
> - 端点：`POST https://openrouter.ai/api/v1/embeddings`
> - 模型 ID：`openai/text-embedding-3-small`（前缀 `openai/` 是 OpenRouter 路由约定）
> - 价格：**$0.020 / 1M input tokens，与 OpenAI direct 完全一致（无 markup）**
> - Schema：100% OpenAI-compatible（`input` / `model` / `dimensions` / `encoding_format`
>   请求 + `data[0].embedding` / `usage.prompt_tokens` 响应）
> - 来源：[OpenRouter embeddings API ref](https://openrouter.ai/docs/api/api-reference/embeddings/create-embeddings)
>   + [openai/text-embedding-3-small pricing](https://openrouter.ai/openai/text-embedding-3-small)
>
> **决策**：放弃 OpenAI direct，全 SP-7 链路（worker `callEmbed` + backfill 脚本
> 的 `callEmbedInline`）切到 OpenRouter，复用 SP-5 已经在用的 `OPENROUTER_API_KEY`。
>
> **理由**：
>
> 1. **运维简化**：去掉 OpenAI Platform 账号注册 + 充值 + 第二个 key 轮换 +
>    `.env.example` 多列一个变量的整套负担 —— 一份 credit，一份 key，一套 rate
>    limit。
> 2. **零功能损失**：价格、维度、schema、模型本身（OpenRouter 把请求转发给 OpenAI）
>    全部 byte-equivalent。
> 3. **零代码额外复杂度**：只改 `embed-client.ts` 的 base URL + env var name + model
>    prefix，4 行 diff；spec 列出的所有阈值（COSINE_THRESHOLD=0.85 / TAG_BOOST=0.07
>    等）一字未动。
>
> **trade-off**：增加一跳网络（client → OpenRouter → OpenAI），p50 延迟可能多
> 10–30ms。SP-7 是异步队列消费，单次 embed 30s timeout，10ms 完全 negligible。
>
> **本 spec 下文凡是出现 `OPENAI_API_KEY` / `api.openai.com/v1/embeddings` /
> "OpenRouter 不支持 embeddings" / "$0.02 per 1M" 字样，均以本 ADR 为准**，请把心
> 智模型替换为：
>
> - env：`OPENROUTER_API_KEY`（已在 prod `.env`，复用 SP-5）
> - URL：`https://openrouter.ai/api/v1/embeddings`
> - model：`openai/text-embedding-3-small`（注意 `openai/` 前缀）
> - cost：$0.020 / 1M input tokens（不变）
>
> 风险表 §6 row 3 ("OpenAI direct 而非 OpenRouter") 标记为 **OBSOLETE（OpenRouter
> 现已支持，已切换）**。

---

## 0. 关键设计决策（已在 brainstorming 阶段拍板）


| 维度             | 选择                                                           | 理由                                                   |
| -------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| Embedding 模型   | **OpenAI text-embedding-3-small**（1536 维）                    | schema 已就位 / $0.02 per 1M tokens / 与 SP-5 同 provider |
| Embedding 输入   | `**titleZh + '\n' + summary`**                               | 中文同源、SP-5 已生成、信息密度高                                  |
| 触发时机           | **SP-5 摘要后 push `embed:<id>`**                               | 解耦 / 复用 SP-5 boot backstop pattern / 必须等 summary 写完  |
| 相似度阈值          | **余弦 ≥ 0.85**，含 ≥1 共享 `company:X / model:Y` tag 时降到 **0.78** | PRD 默认 0.85 + tag 加成提高跨语言/跨措辞召回                      |
| HotNewsGroup 表 | **不建独立表，仅 `groupId String?`**                                | YAGNI — 165 行/天，运行时聚合无性能压力                           |
| 历史 backfill    | **做**                                                        | $0.005 一次性跑完，立竿见影                                    |
| V1 UI 范围       | **后端 + 列表卡片底部 "N 个平台报道" badge**                              | 详情页 widget / 自动折叠列表推到 SP-11                          |


## 1. 目标与硬验收标准

### 1.1 目标

让"同一事件的多平台报道"在 `/news` 列表上可视化合并：

```
[Reddit ★] Anthropic Secures SpaceX Colossus 1...
            "Anthropic 估值达 1.2 万亿美元..."
            🔗 同事件 4 个平台报道  ← SP-7 新增
```

### 1.2 In-scope


| 模块                                               | 新增内容                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `apps/worker/src/embed/`（新增模块）                   | `embed.module.ts` / `embed.queue.ts` / `embed.processor.ts` / `embed.service.ts` / `embed-client.ts` / `group.service.ts` |
| `apps/worker/src/summarize/summarize.service.ts` | 写完 summary 后 push `embed:<id>`                                                                                            |
| `packages/db/scripts/backfill-embeddings-sp7.ts` | 一次性脚本：扫 `summary IS NOT NULL AND embedding IS NULL`，调 OpenAI batch embed API，写入 + 计算 group                                |
| `packages/types/src/dtos.ts`                     | `HotNewsListItemDto` 加 `groupId: string                                                                                   |
| `apps/api/src/hot-news/hot-news.service.ts`      | `findMany` select 加 `groupId`，并在结果 map 时 join 同 group count                                                               |
| `apps/web/app/news/_components/news-item.tsx`    | `groupSize > 1` 时渲染 "N 个平台报道" badge                                                                                       |
| `.env.example` + `docker-compose.prod.yml`       | 加 `OPENAI_API_KEY`（区别于 OpenRouter 的 SUMMARY，OpenAI 直 API 的 embeddings 接口） + `EMBED_CONCURRENCY` + `EMBED_MODEL`           |


### 1.3 Out-of-scope（明确不做）

- ❌ 详情页"相关热点"widget — SP-11
- ❌ `GET /hot-news/:id/related` 接口 — SP-11（前端要时再开）
- ❌ 列表自动折叠同 group N 行 → 1 行（leader 选择）— SP-10 重做列表时
- ❌ HotNewsGroup 独立表 / heatSum 缓存 — SP-19 时序聚合时再评估
- ❌ 30 天归档冷表 — 单独 SP（后续）
- ❌ embedding 模型切换的灰度 / re-embed 工具 — YAGNI，prompt v 改了就跑 backfill 脚本

### 1.4 硬验收标准

```bash
# 1. Local
pnpm turbo run lint typecheck test  # 全绿

# 2. Prod backfill smoke
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && bash scripts/run-prod-oneshot.sh packages/db scripts/backfill-embeddings-sp7.ts'
# 输出 JSON：
#   { scanned: 165, embedded: 165, groupsFormed: ~20, multiPlatformGroups: ~5, cost: "$0.005" }

# 3. Prod data invariants
SELECT COUNT(*) FILTER (WHERE summary IS NOT NULL AND embedding IS NULL) FROM hot_news WHERE status='VISIBLE';  -- = 0 (boot backstop catches up)
SELECT COUNT(*) FROM hot_news WHERE "groupId" IS NOT NULL GROUP BY "groupId" HAVING COUNT(*) > 1;  -- > 0 (cross-platform groups exist)

# 4. UI smoke
curl 'https://hotnews.shinpeionline.top/api/hot-news?pageSize=50' | jq '.items[] | select(.groupSize > 1) | {title, groupSize}'
# 至少有 5 条 groupSize >= 2 的 row
```

---

## 2. 架构

### 2.1 数据流

```text
ingest VISIBLE row
      ↓
   SP-5 summarize  (existing)
      ↓
   write summary + titleZh
      ↓
   ★ NEW: push embed:<id>          (SP-7)
      ↓
   EmbedService.run(id)
      ├─ findUnique select(title, titleZh, summary)
      ├─ buildEmbedInput(titleZh ?? title, summary)  // → 中文文本
      ├─ callEmbedClient (OpenAI v3-small)            // → 1536-dim float[]
      ├─ UPDATE hot_news SET embedding = $1
      └─ groupService.assignGroup(id)                  // → 同事 query + UPDATE groupId
              ├─ pgvector cosine query (top 5 candidates within 7d window, threshold 0.78)
              ├─ tag overlap boost: candidate score = cosine + 0.07 * (shared company:/model: tags >= 1 ? 1 : 0)
              ├─ if best candidate score >= 0.85 → reuse its groupId (or create one)
              └─ else → leave groupId = NULL (singleton)
```

### 2.2 模块结构

```
apps/worker/src/embed/
  embed.module.ts          # NestJS module, imports RedisModule, OnApplicationBootstrap
  embed.queue.ts           # SUMMARY_QUEUE_NAME = 'embed', SUMMARY_QUEUE token, queue provider
  embed.processor.ts       # processEmbedJob(jobData, service)
  embed.service.ts         # EmbedService.run(hotNewsId): fetch row → call embed → persist → assign group
  embed-client.ts          # callEmbedClient(text): OpenAI v3-small via fetch (no SDK dep beyond what we have)
  group.service.ts         # GroupService.assignGroup(hotNewsId): pgvector query + threshold + UPDATE groupId
  embed.service.spec.ts
  group.service.spec.ts
  embed.module.spec.ts     # boot backstop test (mirrors summarize.module.spec.ts pattern)
```

### 2.3 关键代码草图

```typescript
// embed.service.ts
async run(hotNewsId: string): Promise<void> {
  const row = await prisma.hotNews.findUnique({
    where: { id: hotNewsId },
    select: { id: true, title: true, titleZh: true, summary: true, status: true },
  });
  if (!row || row.status !== 'VISIBLE' || !row.summary) {
    this.logger.log(`embed skip ${hotNewsId} (not visible / no summary)`);
    return;
  }

  const input = `${row.titleZh ?? row.title}\n${row.summary}`;
  const vec = await callEmbedClient(input);  // float[1536]

  // pgvector raw SQL (Prisma can't type 1536-d vector literals)
  await prisma.$executeRaw`
    UPDATE hot_news SET embedding = ${vec}::vector(1536)::text::vector(1536)
    WHERE id = ${hotNewsId}
  `;

  await this.groupService.assignGroup(hotNewsId);
}

// group.service.ts
async assignGroup(hotNewsId: string): Promise<void> {
  // 1. find top-5 nearest neighbors within 7d publishedAt window
  const candidates = await prisma.$queryRaw<Array<{ id: string; groupId: string | null; aiTags: string[]; cosine: number }>>`
    SELECT id, "groupId", "aiTags",
           1 - (embedding <=> (SELECT embedding FROM hot_news WHERE id = ${hotNewsId})) AS cosine
    FROM hot_news
    WHERE id <> ${hotNewsId}
      AND embedding IS NOT NULL
      AND status = 'VISIBLE'
      AND "publishedAt" > NOW() - INTERVAL '7 days'
    ORDER BY embedding <=> (SELECT embedding FROM hot_news WHERE id = ${hotNewsId})
    LIMIT 5
  `;

  // 2. score = cosine + 0.07 if shared company/model tag
  const target = await prisma.hotNews.findUnique({ where: { id: hotNewsId }, select: { aiTags: true } });
  const targetTags = new Set(target!.aiTags.filter(t => t.startsWith('company:') || t.startsWith('model:')));
  const scored = candidates.map(c => ({
    ...c,
    score: c.cosine + (c.aiTags.some(t => targetTags.has(t)) ? 0.07 : 0),
  })).sort((a, b) => b.score - a.score);

  // 3. pick best if score >= 0.85
  const best = scored[0];
  if (!best || best.score < 0.85) return;  // keep groupId = NULL

  const groupId = best.groupId ?? `grp-${createId()}`;
  await prisma.$transaction([
    prisma.hotNews.update({ where: { id: hotNewsId }, data: { groupId } }),
    // if best candidate didn't have a groupId (was a singleton), assign it the same one
    ...(best.groupId ? [] : [prisma.hotNews.update({ where: { id: best.id }, data: { groupId } })]),
  ]);
}
```

### 2.4 API 改动

```typescript
// hot-news.service.ts
async list(...): Promise<HotNewsListResponseDto> {
  const rows = await prisma.hotNews.findMany({
    where, skip, take, orderBy,
    select: {
      // ... existing fields ...
      groupId: true,  // ★ NEW
    },
  });

  // collect distinct non-null groupIds
  const groupIds = [...new Set(rows.map(r => r.groupId).filter((g): g is string => g !== null))];

  // count members per group (one query, not N+1)
  const counts = groupIds.length === 0 ? [] : await prisma.hotNews.groupBy({
    by: ['groupId'],
    where: { groupId: { in: groupIds }, status: 'VISIBLE' },
    _count: true,
  });
  const sizeMap = new Map(counts.map(c => [c.groupId!, c._count]));

  return {
    items: rows.map(r => ({
      // ...
      groupId: r.groupId,
      groupSize: r.groupId ? (sizeMap.get(r.groupId) ?? 1) : 1,
    })),
    // ...
  };
}
```

### 2.5 Web 改动

```tsx
// news-item.tsx
{item.groupSize > 1 ? (
  <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[11px] font-medium text-purple-700">
    🔗 {item.groupSize} 个平台报道
  </span>
) : null}
```

---

## 3. 决策日志


| #   | 决策                             | 替代                           | 理由                                                                                      |
| --- | ------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------- |
| 1   | OpenAI v3-small 而非 large       | large 准 ~10% 但贵 6x           | 165 行/天的体量没必要 large；schema 已按 1536 维设计；不准的话再升级                                          |
| 2   | 输入用 titleZh + summary 而非 title | titleZh 已是 SP-5 翻译过的中文       | 跨语言一致性（英文 title 和中文 title 各算 embedding 距离会很远）                                           |
| 3   | OpenAI direct 而非 OpenRouter    | OpenRouter 不暴露 embeddings 接口 | 必须直 OpenAI；新加 `OPENAI_API_KEY` 与 `OPENROUTER_API_KEY` 并存                                |
| 4   | 7d window 过滤候选                 | 全局查询                         | 跨平台报道窗口通常 ≤ 48h，留 7d buffer 已足；查询性能从 O(N) 降到 O(N within 7d)                             |
| 5   | 阈值 0.85 / tag 加成 0.07          | 单纯 cosine                    | tag 加成解决"同事件不同措辞"召回低问题（实测 SP-5 摘要差异化大时 cosine 可能 0.78 但 tag 重叠明确）                       |
| 6   | groupId 形式 `grp-<cuid>`        | 数字递增 / UUID                  | 与 hot_news.id 视觉区分 + cuid 排序友好                                                          |
| 7   | 不建 HotNewsGroup 表              | spec §3.1 原计划建               | YAGNI；leader/heatSum 都可运行时聚合                                                            |
| 8   | backfill 跑一次而非按需               | forward-only                 | $0.005 + 30s 投入产出比无敌                                                                    |
| 9   | 不动 IngestionService            | 入库时同步 embed                  | 解耦 + IngestionService 已经做 4 件事（quality / dedupe / extract trigger / summary push），不再加责任 |


---

## 4. 实施 Plan（任务清单）

### Task 1: `packages/prompts` 暴露 embed 输入构造（小，可选）

或者直接在 embed.service.ts 内联，无需新包。**决策：内联**。

### Task 2: `apps/worker/src/embed/` 模块骨架

- Create `embed.queue.ts` — EMBED_QUEUE_NAME='embed', EMBED_QUEUE token, queueProvider, EMBED_WORKER token + factory（mirror summarize.queue.ts）
- Create `embed-client.ts` — `callEmbed(text): Promise<{ vector: number[], tokensIn: number }>`，用 fetch + OpenAI v3-small endpoint，env: `OPENAI_API_KEY`、`EMBED_MODEL` (default `text-embedding-3-small`)
- Create `embed.service.ts` — `EmbedService.run(hotNewsId)` 核心逻辑（见 §2.3）
- Create `group.service.ts` — `GroupService.assignGroup(hotNewsId)` 见 §2.3
- Create `embed.processor.ts` — `processEmbedJob(jobData: { hotNewsId }, service)`
- Create `embed.module.ts` — providers + boot backstop OnApplicationBootstrap（扫 `summary IS NOT NULL AND embedding IS NULL`，clean failed + completed 然后入队，复用 summarize.module pattern）
- Wire into `worker.module.ts` imports

### Task 3: `summarize.service.ts` push embed:`<id>`

- inject EMBED_QUEUE
- 在 prisma.hotNews.update({ summary, titleZh, aiTags }) 成功后 `await embedQueue.add('embed', { hotNewsId }, { jobId: \`embed-{hotNewsId}, attempts: 3, ... })`

### Task 4: backfill 脚本

- Create `packages/db/scripts/backfill-embeddings-sp7.ts`
  - findMany rows where summary IS NOT NULL AND embedding IS NULL
  - batch 100 → call OpenAI batch embed API（batch 节省 tokens）
  - UPDATE embedding raw SQL
  - 跑 GroupService.assignGroup for each
  - 输出 JSON stats: `{ scanned, embedded, groupsFormed, multiPlatformGroups, cost }`
- Create `packages/db/scripts/backfill-embeddings-sp7.spec.ts`（integration tests，3-4 cases）

### Task 5: API + DTO 改动

- `packages/types/src/dtos.ts`：`HotNewsListItemDto` 加 `groupId: string \| null` + `groupSize: number`
- `apps/api/src/hot-news/hot-news.service.ts`：select groupId + groupBy 计算 size + map 到 DTO
- `apps/api/src/hot-news/hot-news.service.spec.ts` 加 3 case：(a) groupSize=1 default, (b) cross-platform group with size=3, (c) singleton 行 groupId=null

### Task 6: Web 改动

- `apps/web/app/news/_components/news-item.tsx` 加 groupSize badge

### Task 7: env + compose 透传

- `.env.example` 加 `OPENAI_API_KEY` / `EMBED_MODEL` / `EMBED_CONCURRENCY`
- `docker/docker-compose.prod.yml` worker.environment 透传上面 3 个

### Task 8: 部署 + smoke

- `git push origin main` → CI → Deploy → 自动 worker restart 触发 boot backstop（拉所有现有有 summary 但无 embedding 的行）
- 部署后 ssh prod 跑 `bash scripts/run-prod-oneshot.sh packages/db scripts/backfill-embeddings-sp7.ts` 一次性 backfill（虽然 boot backstop 也会做，但 backfill 脚本更可控、有 stats 输出）
- 验证 §1.4 硬验收标准

---

## 5. 风险与缓解


| 风险                                                   | 缓解                                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenAI v3-small 中文质量不够 → 阈值 0.85 召回低                 | 用 prod 实测数据调阈值；如长期不行换 voyage-3（schema 列宽改动 = 1 个 migration）                                                                                      |
| pgvector 查询慢（170 行没问题，1000 行后呢？）                     | 加 ivfflat 索引 `CREATE INDEX hot_news_embedding_idx ON hot_news USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`；这一步放 backfill 脚本里做 |
| group leader 切换：A 入了 group X，后来 B 跟 C 更像，导致 X 变成两个亚组 | V1 不解决（群体内部一致性靠 cosine 阈值已经强约束）；如果实测看到这种情况再加 GroupService.recompute                                                                              |
| OpenAI key 泄露（prod env 比 SP-5 多一个 key）               | 同 SP-5 OPENROUTER 流程：`.env` 不进 git，docker compose 透传，vault 里有备份                                                                                  |
| embedding write race：worker 跑到一半被 stop               | 幂等：`UPDATE embedding=$1 WHERE id=$X AND embedding IS NULL`；但 SP-5 现有写入也没加这种约束，遵循同 pattern（直接覆写）。retry 时即使覆写也是相同 vector                           |
| backfill 脚本撞 OpenAI rate limit                       | OpenAI v3-small batch 接口 5000 RPM 远超我们 165 行；不需要限速                                                                                               |


---

## 6. 后续 SP

- **SP-11 详情页**：消费 `/hot-news/:id/related`（需要 SP-11 时再开接口）
- **SP-10 列表重做（Aurora）**：可能加 list-level group 折叠（leader 选择 + "+ N 个相关"）
- **SP-19 KeywordTimeSeries**：时序聚合时如果发现 group 维度数据需求强，再建 HotNewsGroup 表
- **30 天归档冷表**：单独 SP，触发条件：hot_news 表行数 > 5000 时考虑

