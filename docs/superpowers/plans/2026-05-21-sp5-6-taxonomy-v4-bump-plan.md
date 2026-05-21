# SP-5.6 实施计划 — Taxonomy v4 bump（+OpenSource +Funding）

**Spec**：[`docs/superpowers/specs/2026-05-21-sp5-6-taxonomy-v4-bump-design.md`](../specs/2026-05-21-sp5-6-taxonomy-v4-bump-design.md)
**节奏**：单 PR，TDD（写失败测试 → 实现 → 通过 → commit）。
**总预计**：~0.5 工作日。
**部署模型**：squash-merge to `main` → CI build prompts/worker/api 镜像 → workflow_run trigger Deploy → smoke。

---

## PR — taxonomy v4

**分支**：`feat/sp5-6-taxonomy-v4`
**目标**：受控词表 categories 8 → 10，prompt 版本 v3 → v4，零数据迁移。

### Task 1：taxonomy.spec.ts 失败测试先行（red）

- **文件**：`packages/prompts/src/taxonomy.spec.ts`
- **改动**：
  - 把现有 `it('categories has exactly 8 entries ...')` 测试名改为 `'exactly 10 entries'`
  - 数组断言扩成 10 个：`['Benchmark', 'Funding', 'Incident', 'OpenSource', 'Opinion', 'Product', 'Release', 'Research', 'Tooling', 'Tutorial']` (alphabetical)
  - 新增 it block：
    ```typescript
    it('contains OpenSource + Funding categories (SP-5.6)', () => {
      expect(TAXONOMY.categories).toContain('OpenSource');
      expect(TAXONOMY.categories).toContain('Funding');
    });
    ```
- **验证**：`pnpm --filter @ai-hot-news/prompts test taxonomy.spec` → RED（"has exactly 8 entries" → 实际 8 expected 10）
- **commit**：`test(sp5-6): failing specs for 10-entry categories with OpenSource + Funding`

### Task 2：taxonomy.ts 加 2 个常量（green）

- **文件**：`packages/prompts/src/taxonomy.ts`
- **改动**：`TAXONOMY.categories` 数组在末尾追加 `'OpenSource'`, `'Funding'`（保持 readonly tuple 形态）
- **验证**：`pnpm --filter @ai-hot-news/prompts test taxonomy.spec` → GREEN
- **commit**：`feat(sp5-6): add OpenSource + Funding to TAXONOMY.categories`

### Task 3：summarize.prompt.ts 版本号 + 注释

- **文件**：`packages/prompts/src/summarize.prompt.ts`
- **改动**：
  - `SUMMARIZE_PROMPT_VERSION` 3 → 4
  - 版本注释行末尾追加：
    ```
    * V4 = 4（SP-5.6：受控词表 categories +OpenSource +Funding；
    *         有意识偏离 "bump → wipe → re-summarize" 默认协议，
    *         老 row 不动，让 7d 内自然 catch-up；SP-19/21 真需历史时单独 backfill）
    ```
- **验证**：`pnpm --filter @ai-hot-news/prompts test summarize.prompt.spec` 仍 GREEN（系统 prompt 自动通过 TAXONOMY join 引用，无需改测试）
- **commit**：`feat(sp5-6): bump SUMMARIZE_PROMPT_VERSION to v4`

### Task 4：summarize.prompt.spec.ts 加 prompt 字符串校验

- **文件**：`packages/prompts/src/summarize.prompt.spec.ts`
- **改动**：新增 it block：
  ```typescript
  it('system prompt mentions OpenSource and Funding categories (SP-5.6)', () => {
    const system = buildSystemPrompt();
    expect(system).toMatch(/OpenSource/);
    expect(system).toMatch(/Funding/);
    expect(system).toMatch(/category:/); // sanity: namespace 仍存在
  });
  ```
- **验证**：GREEN（Task 2 加完常量后系统 prompt 自动出现两个新词）
- **commit**：`test(sp5-6): assert prompt body mentions OpenSource + Funding`

### Task 5：parse.spec.ts 加 round-trip 测试

- **文件**：`packages/prompts/src/parse.spec.ts`
- **改动**：新增 it block，验证 LLM 输出 `category: 'OpenSource'` / `'Funding'` 时 parser 接受（不丢弃）：
  ```typescript
  it('accepts OpenSource as a valid category (SP-5.6)', () => {
    const llmOutput = JSON.stringify({
      titleZh: '某开源项目发布',
      summary: '某团队开源了 X 工具...',
      companies: [],
      models: [],
      category: 'OpenSource',
      tech: ['Tool Use'],
    });
    const parsed = parseSummarizeResponse(llmOutput);
    expect(parsed?.aiTags).toContain('category:OpenSource');
  });

  it('accepts Funding as a valid category (SP-5.6)', () => {
    // 同上 with category: 'Funding'
  });
  ```
- **验证**：GREEN
- **commit**：`test(sp5-6): parser accepts OpenSource + Funding category values`

### Task 6：本地全套绿

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null 2>&1
pnpm --filter @ai-hot-news/prompts build
pnpm --filter @ai-hot-news/prompts test
pnpm --filter @ai-hot-news/worker test  # 间接消费 TAXONOMY，应该全过
pnpm -w lint
pnpm -w typecheck
```

### Task 7：开 PR

- **PR title**：`feat(sp5-6): taxonomy v4 — add OpenSource + Funding categories (no re-summarize)`
- **PR body**：
  ```markdown
  ## Summary
  - 受控词表 `TAXONOMY.categories` 8 → 10，加 `OpenSource` + `Funding`
  - `SUMMARIZE_PROMPT_VERSION` 3 → 4
  - **有意识偏离** `summarize.prompt.ts` 注释里写的默认协议（"bump → UPDATE summary=NULL → boot backstop 重摘"）
  - 老 row 不动，让 7d 内 ingest 自然 catch up
  - SP-19/21 真要历史数据时再单独 backfill

  ## Why no re-summarize
  - prod 现有 1,177 row 全量重摘成本 ~$0.37 + 25min worker 串行 LLM
  - OpenSource/Funding 在历史 prod 数据里召回率本来就低（LLM 之前没这两个 category 可选）
  - 真正需要历史聚合是 M7（SP-19 趋势 / SP-21 日报），到时单独 backfill 更可控

  ## Test plan
  - [x] taxonomy.spec: 10 entries + contains OpenSource/Funding
  - [x] summarize.prompt.spec: system prompt mentions both
  - [x] parse.spec: parser round-trip 2 个新 category
  - [ ] prod smoke: deploy +5min worker logs 中 boot backstop 重入队 count ≤ 10
  - [ ] prod smoke: deploy +24h `SELECT ... WHERE aiTags @> ARRAY['category:OpenSource'|'category:Funding']` 至少 1 行
  ```

### Task 8：smoke prod（PR merge + Deploy 完成后）

#### Step 1：deploy +5min — boot backstop sanity check

```bash
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env logs --tail=200 worker 2>&1' | grep -iE "boot backstop|backstop reenqueued|summary IS NULL"
```

预期：包含 `Boot backstop reenqueued N items` 且 `N <= 10`（正常 ingest 残留）。如果 `N > 100`，**立刻 revert** —— 说明 prompt v 协议被破坏，有人在本 SP 之外做了 wipe。

#### Step 2：deploy +24h — 新 category 召回 sanity check

```bash
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U ai_hot_news -d ai_hot_news_prod -v ON_ERROR_STOP=1 -c "
SELECT title, \"aiTags\", \"crawledAt\"
FROM hot_news
WHERE \"crawledAt\" > NOW() - INTERVAL '\''24 hours'\''
  AND ('\''category:OpenSource'\'' = ANY(\"aiTags\") OR '\''category:Funding'\'' = ANY(\"aiTags\"))
ORDER BY \"crawledAt\" DESC
LIMIT 10;
"'
```

预期：至少 1-3 行。如果 24h 后还是 0 行，去查 OpenRouter 返回看看 LLM 是不是真的没用新 category；可能需要再加 ✓ 示例锚定（hot-fix PR）。

#### Step 3：deploy +7d — 自然 catch up 验证

```bash
# 检查 community tab 内（HN+Reddit 48h 内）的 row 是否全部用 v4 prompt 标过
ssh ai-hot-news-prod 'cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U ai_hot_news -d ai_hot_news_prod -c "
SELECT COUNT(*) AS total_in_window,
       COUNT(*) FILTER (WHERE array_length(\"aiTags\", 1) > 0) AS with_tags
FROM hot_news
WHERE status = '\''VISIBLE'\''
  AND \"sourcePlatform\" IN ('\''HACKERNEWS'\'', '\''REDDIT'\'')
  AND \"publishedAt\" >= NOW() - INTERVAL '\''48 hours'\'';
"'
```

预期：with_tags / total_in_window > 95%（少数 LLM 失败行除外，正常）。

---

## 与 SP-5 v3.3 / v3.4 经验对照

1. **`summarize.prompt.ts` 注释里写的协议是"默认行为"**，本 SP 是"显式偏离"。spec §0 Q3 + PR title 都明确写了"no re-summarize"，避免后续 SP 维护者重复踩 v3.3 c64fe93 / v3.4 boot backstop 重摘 26 min 的运维步骤。

2. **boot backstop 不应该被触发**：v3.3 / v3.4 之所以触发是因为它们 `UPDATE summary=NULL`；本 SP 不做这个 UPDATE，boot backstop 扫到的 NULL 数量就只有 ingest pipeline 残留（< 10）。这是 spec §1 验收 B 的核心 sanity check。

3. **OpenRouter gemini-flash 对受控词表的服从度**：SP-5 v3.3 v3.4 实测 LLM 对 8 个 category 服从度 ~99%；新加 2 个 category 由系统 prompt 拼接的 `categories: A | B | C ...` 自动喂给 LLM，预期同样高服从。如果 deploy +24h 验收 C 0 行，可能是 prompt 里的 ✗ / ✓ 示例没覆盖到开源/融资场景的语感，hot-fix 加一两个示例即可。

4. **build pipeline**：`packages/prompts` 用 esbuild bundle + 把 `keywords.md` raw 进 bundle；本 SP 没改 keywords.md，只改 taxonomy.ts，bundle 行为不变。
