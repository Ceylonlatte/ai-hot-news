# SP-5.6 — Taxonomy v4 bump（+OpenSource +Funding，零数据迁移）

- **状态**：spec draft（自主决策，路径 A 用户已 ack 整体节奏）
- **前置 SP**：SP-5（受控词表 + prompt 版本协议 + boot backstop）
- **本文件**：`docs/superpowers/specs/2026-05-21-sp5-6-taxonomy-v4-bump-design.md`
- **预计工作量**：~0.5 天（taxonomy 加 2 个常量 + prompt v3→v4 + 单测 + 部署观察）
- **拆分**：单一 PR
- **路径 A 上下文**：SP-10 的 "顶部 10 chip category filter" 需要 taxonomy 覆盖 PRD §5.2 完整 6 类；本 SP 是 SP-10 的纯前置依赖

---

## 0. 关键设计决策（自主拍板）

| #   | 维度                       | 选择                                                                                                  | 理由                                                                                                                                                                                                                                          |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | 加哪些 category             | `OpenSource` + `Funding`                                                                            | PRD §5.2 6 类映射：模型发布→Release / 工具产品→Tooling∪Product / 技术文章→Tutorial∪Research / 行业观点→Opinion / **开源项目→新加 OpenSource** / **融资动态→新加 Funding**                                                                                            |
| Q2  | 是否同时改 companies / models | **不改**                                                                                              | 受控词表分层稳定 — 公司/模型是命名实体，category 是事件分类；OpenSource/Funding 都是事件类型，归 category 是最干净的命名空间归属                                                                                                                                                                                          |
| Q3  | 是否触发全量重摘                | **不触发**（**有意识偏离** `summarize.prompt.ts` 第 5-6 行写的默认协议）                                              | 1) prod 现状只有 1,177 行 visible，其中 91% 在 7d 内；2) HN/Reddit 48h 内 row 一周自然轮换，自然 catch up；3) OpenSource/Funding 在历史数据里召回率本来就低（LLM 之前没这两个标签可选）；4) 重摘成本 $0.37 + 25min worker downtime 对"管理界面里两个 chip 可能更全"的边际收益不值；5) 真正需要历史聚合是 M7（SP-19 趋势 / SP-21 日报），到时候单独跑一次 backfill |
| Q4  | prompt 版本号             | `SUMMARIZE_PROMPT_VERSION` 3 → 4                                                                    | 沿用 SP-5 协议；版本号是历史溯源凭据（"这条行用 v4 prompt 打的标签"），不是触发重摘的开关 — 触发重摘是显式 `UPDATE summary=NULL` 才发生的事                                                                                                                                                                                          |
| Q5  | 受控词表位置                  | `packages/prompts/src/taxonomy.ts` `TAXONOMY.categories` 数组追加                                       | 单源真理；其它 spec/parser/test 都从这里读                                                                                                                                                                                                              |
| Q6  | LLM drift 容忍             | parser `parse.ts` 已经严格匹配 TAXONOMY.categories 数组；LLM 若胡乱输出 `category:Open Source`（带空格）→ 落到 unknown 丢弃 | 不为兜底花精力 — taxonomy 是 prompt 里 join 给 LLM 看的，drift 概率非常低                                                                                                                                                                                                                                                                  |
| Q7  | 部署后验证窗口                | 24h（HN/Reddit 48h 窗口的一半），检查是否有任何新 row 拿到 `category:OpenSource` 或 `category:Funding` 标签                | 主要 OpenSource 信号源 r/MachineLearning + HN Show HN + 各 GitHub trending RSS 每天都有内容，24h 不出现就是 prompt 没生效                                                                                                                                            |
| Q8  | 是否需要 schema 改动            | **不需要**                                                                                             | `HotNews.aiTags` 是 `String[]`，category 只是新加值，DB 不感知                                                                                                                                                                                          |

---

## 1. 目标与硬验收

### 1.1 目标

1. **prompt v4 上线**：新 ingest 的 row 在 LLM 可见的受控词表里包含 `OpenSource` + `Funding` 两个新值
2. **零数据迁移**：老 row 完全不动，`UPDATE hot_news SET summary=NULL ...` 一句都不跑
3. **零 worker 停机**：boot backstop 不被本 SP 触发；worker 滚动重启即可
4. **零回归**：SP-5 整套摘要流水线（ingest → LLM → parse → upsert → embed → heat）行为不变

### 1.2 硬验收

```bash
# A. 单测
pnpm --filter @ai-hot-news/prompts test
#   taxonomy.spec.ts → categories.length === 10
#   taxonomy.spec.ts → 新增 case：contains 'OpenSource' / 'Funding'
#   summarize.prompt.spec.ts → buildSystemPrompt() 字符串含 'OpenSource' 与 'Funding'
#   parse.spec.ts → 已有 case 不破

# B. 部署
git push origin main → CI build prompts/worker/api 镜像 → Deploy → worker auto-restart
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env logs --tail=50 worker' | grep -i "boot backstop"
#   预期：boot backstop 扫到 NULL count = 0（或仅 ingest pipeline 残留的少量），不是 1100+

# C. 部署后 24h 观察
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U ai_hot_news -d ai_hot_news_prod -c "
SELECT \"aiTags\", title, \"crawledAt\" 
FROM hot_news 
WHERE \"crawledAt\" > NOW() - INTERVAL '\''24 hours'\''
  AND ('\''category:OpenSource'\'' = ANY(\"aiTags\") OR '\''category:Funding'\'' = ANY(\"aiTags\"))
LIMIT 10;
"'
#   预期：返回 >= 1 行；若 0 行则 spec §4 风险 R1 兑现，需要 debug prompt

# D. 不变量
SELECT COUNT(*) FROM hot_news WHERE summary IS NOT NULL AND "aiTags" = ARRAY[]::text[]; -- 跟部署前对比，应不变
```

---

## 2. 数据模型 / 改动清单

### 2.1 改动文件

| 文件                                              | 改动                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/prompts/src/taxonomy.ts`              | `TAXONOMY.categories` 数组追加 `'OpenSource'`, `'Funding'`，总数 8 → 10                          |
| `packages/prompts/src/summarize.prompt.ts`      | `SUMMARIZE_PROMPT_VERSION` 3 → 4；版本注释行加 "V4 = 4（SP-5.6：+OpenSource +Funding，不触发重摘）" |
| `packages/prompts/src/taxonomy.spec.ts`         | 已有 "exactly 8 entries" case 改为 "exactly 10 entries"；追加 `toContain('OpenSource')` + `toContain('Funding')` |
| `packages/prompts/src/summarize.prompt.spec.ts` | 加 1 个 case：`expect(buildSystemPrompt()).toMatch(/OpenSource/)` + `Funding`            |
| `packages/prompts/src/parse.spec.ts`            | 加 1 个 case：parser 接受 `category: 'OpenSource'` / `'Funding'`，不丢弃                          |

### 2.2 不改的

- `apps/worker/src/summarize/strategies/*`（策略层）
- `apps/worker/src/summarize/summarize.service.ts`（boot backstop 逻辑）
- `apps/worker/src/summarize/summarize.module.ts`（onApplicationBootstrap）
- 任何 DB schema / migration
- `packages/prompts/keywords.md`（这是 ingest 阶段 AI_TOPIC_REGEX 用的，与 category 无关）

---

## 3. 部署节奏

### 3.1 单 PR

`feat(sp5-6): taxonomy v4 — add OpenSource + Funding categories`

- **依赖**：无（独立于 SP-10 / SP-10.5，但 SP-10 chip filter UI 期望 10 个 category 都在）
- **CI**：跑 prompts + worker 包测试（worker 的 summarize.service.spec 间接消费 TAXONOMY）
- **部署**：标准 deploy.sh（pull → migrate(no-op) → seed(no-op) → compose up）
- **回滚**：revert PR，prompt 退回 v3，新 ingest 不再产 OpenSource/Funding，老 row 不动

### 3.2 部署后 follow-up

| 时间        | 检查                                                                                  |
| --------- | ----------------------------------------------------------------------------------- |
| deploy +5min | worker logs `Boot backstop ... reenqueued N items` 中 N 应该 ≤ 10（正常 ingest 残留），**不是 1100+**。如果 N > 100，说明 prompt-version 协议被破坏，立刻回滚 |
| deploy +24h  | 验收 C 的 psql 查询，确认至少有 1 行新 row 拿到了 OpenSource / Funding 标签                |
| deploy +7d   | 触发自然 catch-up — community tab 内 100% row 用 v4 prompt 打过标签                              |

---

## 4. 风险与回滚

| 风险                                                | 影响                                                  | 缓解                                                                                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1: LLM 拒绝输出新 category（gemini-flash 训练样本里 OpenSource 罕见）   | 24h 内验收 C 返回 0 行，需要 prompt 调优 — 比如加 1 个 ✓ 示例锚定 |  非阻塞，prompt 是热修；最坏情况是 chip filter "开源项目" 召回率低，UX 退化但不破                                                                                                                                                                  |
| R2: parser 误判 `category:Open Source`（带空格）          | 该 row aiTags 缺 category                              | parse.ts 已严格匹配；本 SP 不动 parser 兜底逻辑                                                                                                                                            |
| R3: 有人误以为 prompt bump = 全量重摘，手工跑了 `UPDATE summary=NULL`   | 1,177 行无谓重摘 + $0.37 + 25min worker busy + heat_history boot backstop 关联触发 | 把 "不触发重摘" 写进 PR title 和 spec §0 Q3；明确告知任何人切勿在本 SP 之后手工跑 NULL update |
| R4: 重摘开关上线（SP-21 真要历史数据时）忘了 boot backstop dedupe 教训 | jobId 冲突 silently no-op，重摘失败                              | SP-5 c64fe93 + c1886f3 已修；SummarizeModule.onApplicationBootstrap 已 `queue.clean(failed) + clean(completed)`；本 SP 不再操心                                                          |

回滚：

- 单 PR revert；categories 退回 8 个；prompt 退回 v3
- 老 row aiTags 里已经存在的 OpenSource/Funding 标签不动（极少；deploy +24h 内可能就 1-5 行）
- 不需要 DB 改动 / worker stop

---

## 5. 后续衔接

| 下一 SP    | 衔接点                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------- |
| **SP-10**    | 顶部 chip 栏 hardcode 10 个 `category:` 值；从 `TAXONOMY.categories` 静态读出，保持 build-time 单源真理               |
| SP-19    | 趋势聚合时如果需要"过去 90 天 OpenSource 趋势"，那时再决策是否跑一次性 backfill 重摘老 row；现在不预设计                                  |
| SP-21    | AI 日报 "今日开源项目" 段落，喂给 LLM 的 hot_news 子集靠 `aiTags @> ARRAY['category:OpenSource']` 过滤 — 但 24h 内 row 必然是 v4 标签，无回填需要 |

---

## 6. 后续动作

1. 起草 `docs/superpowers/plans/2026-05-21-sp5-6-taxonomy-v4-bump-plan.md`
2. 与 SP-10 / SP-10.5 docs 合并到一个 docs PR 承载 implicit approval
3. docs PR merge 后开 implementation PR `feat/sp5-6-taxonomy-v4`，~半天完成
