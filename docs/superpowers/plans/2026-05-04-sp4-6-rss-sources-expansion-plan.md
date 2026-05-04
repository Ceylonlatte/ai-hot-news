# SP-4.6 RSS 数据源扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Anthropic 切换到工作的 RSS 镜像，新增 Cursor / Claude / Claude Code Changelog 三个源，并通过精确白名单让 `normalizeUrl` 在 Mintlify changelog 一个 URL 上保留 fragment，使每个版本能各自独立入库。

**Architecture:** 4 个 source_configs 行变更（1 update + 3 insert），1 个精确路径前缀白名单加在 `normalizeUrl` 的 fragment-strip 之前；不动 schema、不动去重哈希算法、不动 `RssCrawler`/`IngestionService`/调度器。SP-4.5 的 7d ingest cutoff 和 48h HN/Reddit 显示窗口完全不变。

**Tech Stack:** Prisma + PostgreSQL；NestJS worker；TypeScript；vitest；现有 `RssCrawler`（rss-parser）。

**Spec:** `docs/superpowers/specs/2026-05-04-sp4-6-rss-sources-expansion-design.md`

---

## File Structure

| 文件 | 作用 | 改动 |
|---|---|---|
| `packages/utils/src/url.ts` | URL 规范化 | 加 `ANCHOR_INDEXED_PREFIXES` 常量 + 改 fragment 剥除逻辑为条件分支 |
| `packages/utils/src/url.spec.ts` | URL 规范化单测 | 追加一个 `describe('SP-4.6 anchor-indexed prefix whitelist')` block，4 个 case |
| `packages/db/prisma/seed.ts` | seed 脚本 | `seedRss()` 改为按 name 查找 + update url/enabled，并把 4 行新数据加入 `rssCandidates` |
| `packages/db/scripts/sp4.6-add-rss-sources.sql` | 生产应急 fallback SQL | 新建（idempotent） |
| `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md` | 项目分解 spec | 加 SP-4.6 状态行 + 部署凭据小节 |

无需新建 NestJS 模块、无需 schema migration、无需新 Platform。

---

## Task 1: `normalizeUrl` 精确白名单（TDD）

**Files:**
- Modify: `packages/utils/src/url.ts`
- Test: `packages/utils/src/url.spec.ts`

- [ ] **Step 1: 在 `url.spec.ts` 末尾追加失败测试**

把以下 block 加到 `url.spec.ts` 文件末尾的 `describe('normalizeUrl', () => { ... })` 内（紧接最后一个 `it(...)` 之后，闭合 `})` 之前）：

```typescript
  // === SP-4.6: anchor-indexed prefix whitelist ===

  it('preserves fragment for code.claude.com/docs/en/changelog (anchor-indexed)', () => {
    expect(normalizeUrl('https://code.claude.com/docs/en/changelog#2-1-126')).toBe(
      'https://code.claude.com/docs/en/changelog#2-1-126',
    );
  });

  it('strips fragment for sibling paths under code.claude.com/docs (whats-new etc.)', () => {
    expect(normalizeUrl('https://code.claude.com/docs/en/whats-new#abc')).toBe(
      'https://code.claude.com/docs/en/whats-new',
    );
    expect(normalizeUrl('https://code.claude.com/docs/en/changelog/foo#x')).toBe(
      'https://code.claude.com/docs/en/changelog/foo',
    );
  });

  it('still strips fragment for unrelated hosts after SP-4.6', () => {
    expect(normalizeUrl('https://example.com/post#section-1')).toBe('https://example.com/post');
    expect(normalizeUrl('https://cursor.com/blog/x#a')).toBe('https://cursor.com/blog/x');
    expect(normalizeUrl('https://claude.com/blog/y#b')).toBe('https://claude.com/blog/y');
    expect(normalizeUrl('https://www.anthropic.com/news/z#c')).toBe(
      'https://www.anthropic.com/news/z',
    );
  });
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
pnpm --filter @ai-hot-news/utils test -- url.spec
```

Expected: 第一个新 case (`preserves fragment for code.claude.com/docs/en/changelog`) 失败，因为现有 `parsed.hash = ''` 会无条件剥掉 `#2-1-126`。其他三个新 case 此时是 PASS。

- [ ] **Step 3: 在 `url.ts` 加 `ANCHOR_INDEXED_PREFIXES` 常量**

紧接 `MOBILE_PREFIXES` 那一行之后（第 24 行附近），插入：

```typescript
// SP-4.6: a small whitelist of (host, exact-pathname) pairs whose RSS feeds
// rely on URL fragments (#anchor) as the only per-item identifier. For these
// pages we MUST preserve the fragment so each item gets a distinct sourceUrl
// and clears HotNews.sourceUrl @unique + dedupeHash.
//
// Match is exact on `pathname` (not startsWith) — sibling pages under the
// same host (e.g. /docs/en/whats-new, /docs/en/changelog/foo) keep the
// default fragment-strip behavior.
const ANCHOR_INDEXED_PREFIXES: ReadonlyArray<{ hostname: string; pathname: string }> = [
  { hostname: 'code.claude.com', pathname: '/docs/en/changelog' },
];
```

- [ ] **Step 4: 把 `parsed.hash = ''` 包成条件分支**

把现有这一段：

```typescript
  // SP-1 (existing): drop fragment
  parsed.hash = '';
```

替换成：

```typescript
  // SP-1 + SP-4.6: drop fragment, except for anchor-indexed RSS pages.
  const preserveHash = ANCHOR_INDEXED_PREFIXES.some(
    (entry) => parsed.hostname === entry.hostname && parsed.pathname === entry.pathname,
  );
  if (!preserveHash) {
    parsed.hash = '';
  }
```

注意：这段必须放在 host alias / mobile prefix 处理**之后**，因为白名单匹配的是规范化之后的 `parsed.hostname`（防止 `m.code.claude.com` 之类的边角误命中——尽管事实上这个 host 没有 mobile 别名）。当前文件结构（host alias → mobile strip → fragment）保持不变，只把 fragment 那一行替换。

- [ ] **Step 5: 跑测试，确认全绿**

```bash
pnpm --filter @ai-hot-news/utils test -- url.spec
```

Expected: 所有 case PASS（含原有 16 个 + 新增 3 个 case 共 19 个）。

特别确认 `'removes the URL fragment'` 这个旧 case（针对 `https://example.com/post#section-1`）仍然 PASS——白名单未命中时行为不变。

- [ ] **Step 6: 跑整包 typecheck + lint**

```bash
pnpm --filter @ai-hot-news/utils typecheck
pnpm --filter @ai-hot-news/utils lint
```

Expected: 全绿，无报错。

- [ ] **Step 7: 提交**

```bash
git add packages/utils/src/url.ts packages/utils/src/url.spec.ts
git commit -m "feat(sp4.6): preserve fragment for anchor-indexed RSS pages

Add ANCHOR_INDEXED_PREFIXES whitelist to normalizeUrl so
https://code.claude.com/docs/en/changelog can keep its
#X.Y.Z anchor — the Mintlify-generated RSS feed uses
fragments as the only per-item discriminator.

Match is exact on pathname (not startsWith) so sibling
pages under the same host keep default fragment-strip.

Spec: docs/superpowers/specs/2026-05-04-sp4-6-rss-sources-expansion-design.md"
```

---

## Task 2: `seedRss()` 重构 + 4 行新数据

**Files:**
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: 改 `rssCandidates` 列表**

把 `seed.ts` 第 26-31 行的 `rssCandidates` 数组替换成：

```typescript
const rssCandidates: RssCandidate[] = [
  { name: 'OpenAI News',           url: 'https://openai.com/news/rss.xml',                                                                                  enabled: true },
  { name: 'Anthropic News',        url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml',                          enabled: true },
  { name: 'Google Research Blog',  url: 'https://research.google/blog/rss/',                                                                                enabled: true },
  { name: 'Google DeepMind Blog',  url: 'https://deepmind.google/blog/rss.xml',                                                                             enabled: true },
  { name: 'Cursor Blog',           url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_cursor.xml',                                  enabled: true },
  { name: 'Claude Blog',           url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_claude.xml',                                  enabled: true },
  { name: 'Claude Code Changelog', url: 'https://code.claude.com/docs/en/changelog/rss.xml',                                                                enabled: true },
];
```

> 关键变化：`Anthropic News` 的 url 换 + enabled=true；新增 Cursor / Claude / Claude Code Changelog 三行。

- [ ] **Step 2: 把 `seedRss()` 改为按 name 查找模式**

把当前 `seedRss()` 函数（第 50-65 行）整体替换成：

```typescript
async function seedRss() {
  for (const c of rssCandidates) {
    const existing = await prisma.sourceConfig.findFirst({
      where: { platform: 'RSS', name: c.name },
    });
    if (existing) {
      await prisma.sourceConfig.update({
        where: { id: existing.id },
        data: {
          url: c.url,
          enabled: c.enabled,
          crawlInterval: 86400,
        },
      });
    } else {
      await prisma.sourceConfig.create({
        data: {
          platform: 'RSS',
          name: c.name,
          url: c.url,
          enabled: c.enabled,
          crawlInterval: 86400,
        },
      });
    }
    console.log(`seeded RSS: ${c.name} (enabled=${c.enabled}, url=${c.url})`);
  }
}
```

> 改动点：
> - 之前用 `prisma.sourceConfig.upsert({ where: { platform_url: { platform, url } }, update: { name } })` —— url 变了会创建新行。
> - 现在按 (platform, name) 查找现有行，找到则 update url/enabled/crawlInterval；找不到则 create。形态对齐 `seedHn()` / `seedReddit()`。
> - `crawlInterval: 86400` 沿用 SP-4.5 的 RSS 1 天约定（不再按"创建时 1800、之后保留"），统一所有 RSS 源到 1 天。这是 SP-4.5 SQL 已经在生产做过的事，本任务只是让本地 seed 与生产一致。

- [ ] **Step 3: 本地启 PG（如果还没起）+ 跑 db:seed**

```bash
docker compose up -d postgres
pnpm --filter @ai-hot-news/db db:push
pnpm --filter @ai-hot-news/db db:seed
```

Expected: 输出包含

```
seeded RSS: OpenAI News (enabled=true, url=https://openai.com/news/rss.xml)
seeded RSS: Anthropic News (enabled=true, url=https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml)
seeded RSS: Google Research Blog (enabled=true, url=https://research.google/blog/rss/)
seeded RSS: Google DeepMind Blog (enabled=true, url=https://deepmind.google/blog/rss.xml)
seeded RSS: Cursor Blog (enabled=true, url=https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_cursor.xml)
seeded RSS: Claude Blog (enabled=true, url=https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_claude.xml)
seeded RSS: Claude Code Changelog (enabled=true, url=https://code.claude.com/docs/en/changelog/rss.xml)
```

- [ ] **Step 4: 验证 DB 状态**

```bash
docker compose exec -T postgres psql -U postgres -d ai_hot_news -c \
  "SELECT name, url, enabled, \"crawlInterval\" FROM source_configs WHERE platform='RSS' ORDER BY name;"
```

Expected: 7 行，每行 `enabled = t`、`crawlInterval = 86400`，url 与 Step 1 列表完全一致。**特别确认**：

- `Anthropic News` 这一行只有一行，url 是 GitHub raw 镜像，不是 `https://www.anthropic.com/news/rss`（如果发现两行，说明本地 DB 里有 SP-4.5 之前残留的旧 disabled 行；执行 `DELETE FROM source_configs WHERE platform='RSS' AND name='Anthropic News' AND url='https://www.anthropic.com/news/rss';` 清掉，然后重跑 seed）。

- [ ] **Step 5: 跑全包 typecheck + lint**

```bash
pnpm --filter @ai-hot-news/db typecheck
pnpm --filter @ai-hot-news/db lint
```

Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add packages/db/prisma/seed.ts
git commit -m "feat(sp4.6): expand RSS sources (Anthropic remap + Cursor/Claude/Claude Code Changelog)

- Anthropic News: switch url to Olshansk/rss-feeds mirror, enable
- Cursor Blog: new (Olshansk mirror)
- Claude Blog: new (Olshansk mirror)
- Claude Code Changelog: new (official Mintlify .../changelog/rss.xml)
- All four use crawlInterval=86400 per SP-4.5 RSS-1-day convention

Refactor seedRss() from upsert-on-(platform,url) to findFirst-by-name
+ update/create, matching seedHn()/seedReddit(). Avoids zombie rows
when a source's url changes (as for Anthropic News here)."
```

---

## Task 3: 生产应急 SQL 脚本（fallback 路径）

**Files:**
- Create: `packages/db/scripts/sp4.6-add-rss-sources.sql`

> 主路径是 deploy + worker 内 `pnpm db:seed`（Task 6）。这个 SQL 是应急回放，在主路径失败 / 需要不重 deploy 立即修复 RSS 源 / 需要把生产 DB 拖到目标状态时用。

- [ ] **Step 1: 新建 SQL 文件**

写入 `packages/db/scripts/sp4.6-add-rss-sources.sql`：

```sql
-- SP-4.6 RSS sources (idempotent fallback).
-- Primary deploy path: redeploy + `pnpm db:seed` inside the worker container.
-- Use this script when redeploying is not desirable (e.g. immediate prod fix).
-- Run via: scripts/run-prod-oneshot.sh psql -f /workspace/packages/db/scripts/sp4.6-add-rss-sources.sql
-- or:      docker compose exec -T postgres psql -U postgres -d ai_hot_news -f /...

-- Anthropic News: rebind url + enable (idempotent: only updates the row keyed by name).
UPDATE source_configs
   SET url = 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml',
       enabled = true,
       "crawlInterval" = 86400,
       "updatedAt" = now()
 WHERE platform = 'RSS' AND name = 'Anthropic News';

-- Drop legacy zombie row (the old disabled entry pointing at .../news/rss),
-- in case both the old and new urls coexist after a prior partial migration.
DELETE FROM source_configs
 WHERE platform = 'RSS'
   AND name = 'Anthropic News'
   AND url = 'https://www.anthropic.com/news/rss';

-- Cursor Blog
INSERT INTO source_configs (id, platform, name, url, identifier, enabled, "crawlInterval", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'RSS', 'Cursor Blog',
       'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_cursor.xml',
       NULL, true, 86400, now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM source_configs WHERE platform = 'RSS' AND name = 'Cursor Blog');

-- Claude Blog
INSERT INTO source_configs (id, platform, name, url, identifier, enabled, "crawlInterval", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'RSS', 'Claude Blog',
       'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_claude.xml',
       NULL, true, 86400, now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM source_configs WHERE platform = 'RSS' AND name = 'Claude Blog');

-- Claude Code Changelog (Mintlify-generated official RSS)
INSERT INTO source_configs (id, platform, name, url, identifier, enabled, "crawlInterval", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'RSS', 'Claude Code Changelog',
       'https://code.claude.com/docs/en/changelog/rss.xml',
       NULL, true, 86400, now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM source_configs WHERE platform = 'RSS' AND name = 'Claude Code Changelog');

-- Sanity check (read-only).
SELECT name, url, enabled, "crawlInterval"
  FROM source_configs
 WHERE platform = 'RSS'
 ORDER BY name;
```

- [ ] **Step 2: 本地 dry-run 验证（在已经 seed 过的本地 DB 上跑）**

```bash
docker compose exec -T postgres psql -U postgres -d ai_hot_news \
  -f /docker-entrypoint-initdb.d/dev-init.sql 2>/dev/null || true
cat packages/db/scripts/sp4.6-add-rss-sources.sql | \
  docker compose exec -T postgres psql -U postgres -d ai_hot_news
```

Expected: 最后的 `SELECT` 返回 7 行（OpenAI / Anthropic / Google Research / Google DeepMind / Cursor / Claude / Claude Code Changelog），全部 enabled=t、crawlInterval=86400。`UPDATE 1` / `DELETE 0` / `INSERT 0 0` 等的 NOTICE 也是预期（idempotent，本地已经 seed 过的话什么都不会变）。

- [ ] **Step 3: 提交**

```bash
git add packages/db/scripts/sp4.6-add-rss-sources.sql
git commit -m "chore(sp4.6): idempotent SQL fallback for RSS source upsert

Mirrors seed.ts's seedRss() target state. Use only when the
primary deploy path (redeploy + db:seed inside worker) is not
viable. Drops the legacy disabled Anthropic row if it exists.

Run via scripts/run-prod-oneshot.sh psql -f ... ."
```

---

## Task 4: 更新 decomposition design doc 加 SP-4.6 状态行

**Files:**
- Modify: `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md`

> 这是文档任务，不需要测试。先做这一步把"SP-4.6 进入 in-progress"标在公共 spec 上；部署凭据小节会在 Task 6 部署完成后补回来（保持 SP-4.5 的相同节奏）。

- [ ] **Step 1: 找到 SP-4.5 状态条目**

在 `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md` 里搜索 `SP-4.5`，定位到 Phase 3 status table 中 SP-4.5 的那一行（应该已经存在，状态 ✅）。

- [ ] **Step 2: 在 SP-4.5 行下面新增一行 SP-4.6**

在 SP-4.5 行的下方紧接着插入：

```markdown
| SP-4.6 | RSS 数据源扩展 | ⏳ 进行中 | Anthropic 换 GitHub raw 镜像并启用；新增 Cursor Blog / Claude Blog / Claude Code Changelog；`normalizeUrl` 加 `code.claude.com/docs/en/changelog` 精确路径白名单以保留 Mintlify changelog 的 `#X.Y.Z` 锚点；不动 schema、不动 `dedupeHash`、不动 SP-4.5 的 7d 入库窗口；7 个 RSS 源全部 `crawlInterval=86400`。 |
```

> 注：表头列数若和 SP-4.5 行不一致，按 SP-4.5 那一行的实际列结构调整（同一个文件内部已统一格式）。Status 列字符使用与已有行一致的 emoji。

- [ ] **Step 3: 提交（仅 in-progress 标记，不写部署凭据）**

```bash
git add docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md
git commit -m "docs(sp4.6): mark SP-4.6 in-progress in decomposition design

Deployment credentials section will be appended after Task 6
(prod deploy + smoke), matching the SP-4.5 doc-update cadence."
```

---

## Task 5: 本地全绿 + push + PR

**Files:** （只跑命令，不改代码）

- [ ] **Step 1: 跑整 monorepo lint + typecheck + test**

```bash
pnpm turbo run lint typecheck test
```

Expected: 全部 PASS。重点关注：

- `packages/utils` 的 `url.spec.ts` 全绿（含 SP-4.6 新 case）
- `packages/db` 的现有 spec 不受影响（特别是 `cleanup-rss-pre-window.spec.ts` 和 `migrate-sp4.spec.ts`，它们读 `source_configs` 但不依赖具体 RSS 源的内容，应该零影响）
- `apps/api` / `apps/worker` 全绿

如果 `packages/db` 的 spec 在本地 DB 上失败，先 `pnpm --filter @ai-hot-news/db db:push && pnpm --filter @ai-hot-news/db db:seed` 把 schema + seed 同步到最新，再重跑。

- [ ] **Step 2: 跑 web 包 build（typedRoutes 仍是 SP-4.5 引入的硬约束）**

```bash
pnpm --filter @ai-hot-news/web build
```

Expected: build 成功，无 typedRoutes 错误。SP-4.6 没碰 web，应该零影响；这一步是预防性 smoke。

- [ ] **Step 3: 推 branch / 创建 PR**

如果当前在 main 上，先创分支：

```bash
git status -sb
# 如果当前 HEAD 是 main 上的 SP-4.6 三个 commit（task 1/2/3/4），创分支：
git switch -c sp4.6-rss-sources-expansion
git push -u origin sp4.6-rss-sources-expansion
```

然后用 `gh pr create`：

```bash
gh pr create --title "SP-4.6: RSS 数据源扩展（Anthropic 换源 + Cursor/Claude/Claude Code Changelog）" --body "$(cat <<'EOF'
## Summary
- Anthropic News: 切换 url 到 Olshansk/rss-feeds 上的 GitHub raw 镜像并启用（原官方 url 已 404）
- 新增 Cursor Blog / Claude Blog / Claude Code Changelog 三个 RSS 源，`crawlInterval=86400`
- `normalizeUrl` 加 `(code.claude.com, /docs/en/changelog)` 精确路径白名单，保留 Mintlify changelog 的 `#X.Y.Z` 锚点；其他所有 URL 行为零变化
- `seedRss()` 重构为按 name 查找 + update/create（对齐 HN/Reddit），避免 url 变更产生僵尸行
- 一次性应急 SQL `packages/db/scripts/sp4.6-add-rss-sources.sql`

## 不变量
- `HotNews.sourceUrl @unique` 不动；`dedupeHash` 算法不动
- SP-4.5 的 7d 入库窗口、48h HN/Reddit 显示窗口、`/api/hot-news?platforms=` 行为完全不变
- 其他 RSS 源（OpenAI / Google Research / Google DeepMind）零变化

## Test plan
- [x] `pnpm --filter @ai-hot-news/utils test -- url.spec` 全绿（19 个 case）
- [x] `pnpm --filter @ai-hot-news/db db:seed` 后 `source_configs` 7 行 RSS 全部 enabled、url 正确
- [x] `pnpm turbo run lint typecheck test` 全绿
- [x] `pnpm --filter @ai-hot-news/web build` 全绿
- [ ] 生产部署 + 24h 烟测：每个新源 ≥ 1 条 hot_news；Claude Code Changelog ≥ 2 条不同版本（验证 fragment 保留生效）

## Spec / Plan
- spec: `docs/superpowers/specs/2026-05-04-sp4-6-rss-sources-expansion-design.md`
- plan: `docs/superpowers/plans/2026-05-04-sp4-6-rss-sources-expansion-plan.md`
EOF
)"
```

Expected: PR 创建成功，CI 触发。

- [ ] **Step 4: 等 CI 全绿**

```bash
gh pr checks --watch
```

Expected: 所有 check pass。如果有 lint/test 失败：在本地复现、修、push 新 commit；不要在 PR 上 force-push 已有 commit。

- [ ] **Step 5: Merge PR**

```bash
gh pr merge --squash --auto || gh pr merge --squash
```

> 这里用 squash 与 SP-4.5 的合并风格保持一致。

---

## Task 6: 生产部署 + 烟测 + 部署凭据补全

**Files:**
- Modify: `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md` (后置补 SP-4.6 部署凭据小节)

- [ ] **Step 1: SSH 到生产、拉最新 main**

```bash
ssh <prod-host>
cd /path/to/ai-hot-news
git fetch origin && git checkout main && git pull --ff-only
```

Expected: HEAD 指向刚刚 merge 的 SP-4.6 squash commit。

- [ ] **Step 2: 部署前快照（SP-4.6 baseline）**

```bash
docker compose exec -T postgres psql -U postgres -d ai_hot_news -c \
  "SELECT name, url, enabled, \"crawlInterval\" FROM source_configs WHERE platform='RSS' ORDER BY name;" \
  > /tmp/sp4.6-prebaseline-source_configs.txt
docker compose exec -T postgres psql -U postgres -d ai_hot_news -c \
  "SELECT \"sourcePlatform\", count(*) FROM hot_news WHERE \"publishedAt\" >= now() - interval '7 days' GROUP BY 1;" \
  > /tmp/sp4.6-prebaseline-hot_news_7d.txt
cat /tmp/sp4.6-prebaseline-source_configs.txt /tmp/sp4.6-prebaseline-hot_news_7d.txt
```

Expected: 4 行 RSS（OpenAI / Google Research / Google DeepMind / Anthropic 旧 disabled），加上 hot_news 7d 计数（HN + Reddit + 部分 RSS）。把这两段输出存到本地剪贴板等下写进 decomposition design 部署凭据小节。

- [ ] **Step 3: 部署新镜像**

```bash
docker compose pull
docker compose up -d --build
docker compose ps
```

Expected: api / worker / web 都进入 running 状态。

- [ ] **Step 4: 在 worker 容器里跑 db:seed**

```bash
docker compose exec -T worker pnpm --filter @ai-hot-news/db db:seed
```

Expected: 输出 7 行 `seeded RSS: ...` 信息，全部 enabled=true，每个 url 与 spec 4.1 表一致。

如果该容器里没有 `pnpm`（取决于 Dockerfile），fallback 到 SQL 脚本：

```bash
scripts/run-prod-oneshot.sh psql -f /workspace/packages/db/scripts/sp4.6-add-rss-sources.sql
```

Expected: 末尾 SELECT 返回 7 行 RSS。

- [ ] **Step 5: DB invariants 验证**

```bash
docker compose exec -T postgres psql -U postgres -d ai_hot_news -c \
  "SELECT name, url, enabled, \"crawlInterval\" FROM source_configs WHERE platform='RSS' ORDER BY name;"
```

Expected:

```
         name           |                                                      url                                                       | enabled | crawlInterval
------------------------+---------------------------------------------------------------------------------------------------------------+---------+---------------
 Anthropic News         | https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml                       | t       |        86400
 Claude Blog            | https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_claude.xml                              | t       |        86400
 Claude Code Changelog  | https://code.claude.com/docs/en/changelog/rss.xml                                                            | t       |        86400
 Cursor Blog            | https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_cursor.xml                              | t       |        86400
 Google DeepMind Blog   | https://deepmind.google/blog/rss.xml                                                                         | t       |        86400
 Google Research Blog   | https://research.google/blog/rss/                                                                            | t       |        86400
 OpenAI News            | https://openai.com/news/rss.xml                                                                              | t       |        86400
(7 rows)
```

特别确认：**没有任何一行 url 是 `https://www.anthropic.com/news/rss`**（旧 url 已被 update 覆盖或 SQL 的 DELETE 子句清掉）。

- [ ] **Step 6: 触发一次抓取（不等 24h 调度）**

最快路径是重启 worker 触发首轮调度（CrawlScheduler 在启动时会扫描所有 enabled 源）：

```bash
docker compose restart worker
docker compose logs -f worker | head -n 200
```

Expected: 在日志里看到 4 个新源被拉取的 entry：

```
Crawler RSS Anthropic News fetched N items, X inserted, Y skipped (...)
Crawler RSS Cursor Blog fetched N items, X inserted, Y skipped (...)
Crawler RSS Claude Blog fetched N items, X inserted, Y skipped (...)
Crawler RSS Claude Code Changelog fetched N items, X inserted, Y skipped (...)
```

> **关键观察**：Claude Code Changelog 的 `inserted` 必须 ≥ 2（不是 1）。如果只看到 1，说明 fragment 保留没生效—— `normalizeUrl` 路径有问题，需要回 Task 1 复查。

`skipped` 数量预期较高（changelog 大多数版本 publishedAt 早于 7 天），这是 SP-4.5 ingest cutoff 在工作，不是 bug。

- [ ] **Step 7: 烟测 — DB 数据**

```bash
docker compose exec -T postgres psql -U postgres -d ai_hot_news -c \
  "SELECT \"sourceUrl\", title, \"publishedAt\" FROM hot_news WHERE \"sourceUrl\" LIKE 'https://code.claude.com/docs/en/changelog%' ORDER BY \"publishedAt\" DESC LIMIT 10;"
```

Expected: 至少 2 条不同 sourceUrl（如 `.../changelog#2-1-126` 和 `.../changelog#2-1-123`），title 是版本号。

```bash
docker compose exec -T postgres psql -U postgres -d ai_hot_news -c \
  "SELECT \"sourceUrl\", title FROM hot_news WHERE \"sourceUrl\" LIKE 'https://cursor.com/blog/%' ORDER BY \"publishedAt\" DESC LIMIT 5;"
docker compose exec -T postgres psql -U postgres -d ai_hot_news -c \
  "SELECT \"sourceUrl\", title FROM hot_news WHERE \"sourceUrl\" LIKE 'https://claude.com/blog/%' ORDER BY \"publishedAt\" DESC LIMIT 5;"
docker compose exec -T postgres psql -U postgres -d ai_hot_news -c \
  "SELECT \"sourceUrl\", title FROM hot_news WHERE \"sourceUrl\" LIKE 'https://www.anthropic.com/news/%' ORDER BY \"publishedAt\" DESC LIMIT 5;"
```

Expected: 每个查询至少 1 条结果，且 title 不为空。

- [ ] **Step 8: 烟测 — API + 前端**

```bash
curl -sS 'https://<prod-domain>/api/hot-news?platforms=RSS&pageSize=20' | jq '.items | map({sourceUrl, title}) | .[0:10]'
```

Expected: 前 10 条里至少出现一条 cursor.com / claude.com / anthropic.com / code.claude.com 的内容。

浏览器访问 `https://<prod-domain>/news?tab=authoritative`：应该能看到 Cursor / Claude / Anthropic / Claude Code Changelog 的卡片混在 OpenAI / Google 的内容里。

- [ ] **Step 9: 在 decomposition design 文档里补 SP-4.6 部署凭据小节**

回到本地工作目录，在 `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md` 里 SP-4.5 部署凭据小节之后，新增 `### SP-4.6 端到端 smoke 凭据` 小节。模板：

```markdown
### SP-4.6 端到端 smoke 凭据

部署时间：YYYY-MM-DD HH:MM 区时
部署 commit：<sha>

**部署前快照**

\`\`\`text
（粘贴 Step 2 的 source_configs.txt 输出）
（粘贴 Step 2 的 hot_news 7d 计数）
\`\`\`

**db:seed 输出**

\`\`\`text
（粘贴 Step 4 的 7 行 seeded RSS 输出）
\`\`\`

**部署后 source_configs**

\`\`\`text
（粘贴 Step 5 的 7 行表格）
\`\`\`

**首轮抓取调度日志**

\`\`\`text
（粘贴 Step 6 worker 日志中 4 个新源的 fetch/inserted/skipped 行）
\`\`\`

**Claude Code Changelog fragment 保留验证**

\`\`\`text
（粘贴 Step 7 第一个查询的输出，至少 2 条不同 sourceUrl）
\`\`\`

**API smoke**

\`\`\`text
curl '/api/hot-news?platforms=RSS&pageSize=20' 前 10 条 sourceUrl 列表
（粘贴 Step 8 的 jq 输出）
\`\`\`
```

把所有占位符替换成实际抓取到的输出。同时把第 2 步插入的 SP-4.6 状态行从 `⏳ 进行中` 改为 `✅` 并加 commit 链接。

- [ ] **Step 10: 提交 + push 部署凭据**

```bash
git add docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md
git commit -m "docs(sp4.6): record prod deploy smoke credentials"
git push origin main
```

> 这一次允许直接 push 到 main，因为是文档补充，没改代码（与 SP-4.5 同样节奏）。

---

## Self-Review

**1. Spec coverage:**

- spec §2.1 in scope:
  - "改 seed.ts seedRss + 4 行 RSS row" → Task 2 ✓
  - "normalizeUrl 加白名单 + url.spec.ts 加单测" → Task 1 ✓
  - "一次性 idempotent SQL 脚本" → Task 3 ✓
  - "decomposition design 加 SP-4.6 状态行 + 部署凭据" → Task 4（in-progress 标记）+ Task 6 Step 9（部署凭据） ✓
- spec §4.5 部署顺序：本地 → PR → 生产 deploy + db:seed → 24h 烟测 → 文档补凭据 → 全在 Task 5 + Task 6 中按序执行 ✓
- spec §6.2 生产烟测的 4 个 SQL/HTTP 验证 → Task 6 Step 5/7/8 全部覆盖 ✓
- spec §8 DoD 8 项：
  - seed.ts 后 7 行 → Task 2 Step 4 ✓
  - url.ts + url.spec.ts → Task 1 ✓
  - PR 合并 + CI 全绿 → Task 5 ✓
  - 生产 source_configs 一致 → Task 6 Step 5 ✓
  - 24h 内每个新源 ≥ 1 条；Claude Code Changelog ≥ 2 条 → Task 6 Step 6/7 ✓
  - decomposition design 加状态 + 凭据 → Task 4 + Task 6 Step 9 ✓

**2. Placeholder scan:**

- 所有 code block 都是完整的可粘贴代码，无 "TBD" / "TODO" / "实现略" / "类似 Task X" 等。
- 所有 SQL 都是完整 statement。
- 所有 git commit message 都是完整的 here-doc 或单行。

**3. Type consistency:**

- Task 1 的 `ANCHOR_INDEXED_PREFIXES` 类型 `ReadonlyArray<{ hostname: string; pathname: string }>` 跟 spec §4.3 一致。
- Task 2 的 `prisma.sourceConfig.findFirst({ where: { platform: 'RSS', name: c.name } })` 与 schema.prisma `SourceConfig` 字段一致（platform/name/url/identifier/enabled/crawlInterval 都存在）。
- Task 3 的 SQL 列名 `"crawlInterval"`/`"createdAt"`/`"updatedAt"` 加了引号符合 Prisma 的 PostgreSQL camelCase 列命名。

无发现，plan 直接可执行。
