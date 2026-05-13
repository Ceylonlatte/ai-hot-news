# SP-4.6 — RSS 数据源扩展（Anthropic 换源 + Cursor / Claude / Claude Code Changelog）

- **状态**：spec 待用户审核
- **依赖**：SP-2（normalizeUrl）、SP-4（HotNews 唯一约束 + dedupeHash）、SP-4.5（RSS 7d 窗口、`crawlInterval=86400`）
- **本文件**：`docs/superpowers/specs/2026-05-04-sp4-6-rss-sources-expansion-design.md`

## 1. 背景与目标

SP-4.5 上线后，三件事被发现：

1. `Anthropic News` 在 seed 中是 `enabled: false`，因为 `https://www.anthropic.com/news/rss` 早已 404。
2. 用户关注的 AI 厂商博客（Cursor、Claude）目前完全没有覆盖。
3. `Claude Code Changelog` 是用户高优先级关注的发布信息，但官方页面 `https://code.claude.com/docs/en/changelog` 是 Mintlify 渲染的 markdown 文档而非 RSS。

本子项目的目标是：在不破坏 SP-4.5 已收紧的 RSS 时窗 / 去重不变量的前提下，把 Anthropic 切换到可工作的 RSS、把 Cursor/Claude/Claude Code Changelog 三个新源接入主页"权威媒体 · 7d" tab。

## 2. 范围

### 2.1 In scope

- 修改 `packages/db/prisma/seed.ts` 的 `seedRss()`：
  - `Anthropic News` 改 url 到 GitHub raw 上的第三方镜像并改 `enabled: true`。
  - 新增 `Cursor Blog`、`Claude Blog`、`Claude Code Changelog` 三条 enabled RSS row，`crawlInterval = 86400`。
  - 把 RSS 的 upsert 键从 `(platform, url)` 改成 "按 `name` 查 + update url/enabled/crawlInterval"，参考 HN/Reddit 模式，避免 url 变更后产生僵尸行。
- 修改 `packages/utils/src/url.ts`：在 `normalizeUrl` 里加一个**精确路径前缀**白名单，命中时**保留 fragment**；在 `url.spec.ts` 加单测。
- 写一个一次性、idempotent 的 SQL 脚本 `packages/db/scripts/sp4.6-add-rss-sources.sql`，用于生产侧把以上四个 source_configs 行带到目标状态（不依赖重 seed）。
- 在 `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md` 里加一行 SP-4.6 的状态条目和这次部署凭据。

### 2.2 Out of scope

- 不改 `RssCrawler`、不改 `IngestionService` 的字段映射、不改 `dedupeHash` 算法、不动 `HotNews.sourceUrl @unique` 约束。
- 不放宽 SP-4.5 的 7d 入库窗口，也不引入新的 Platform enum。
- 不为 Claude Code Changelog 写专用 release-style crawler（白名单 hack 是有意识的"最小破坏"折中）。
- 不动 OpenAI / Google Research / Google DeepMind 三个现有 enabled 源。
- Reddit / HN 不在本次范围。

## 3. 关键技术发现（决定方案的事实）


| 候选 RSS（Claude Code Changelog） | URL 形态                                                                                        | 问题                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 官方 Mintlify                   | `https://code.claude.com/docs/en/changelog/rss.xml`，每 item `<link>` = `.../changelog#2-1-126` | item.link 仅靠 `#fragment` 区分版本                                 |
| 官方 Mintlify "What's new"      | `.../whats-new/rss.xml`                                                                       | 周报形式，单条覆盖多版本，颗粒度不符；issue #49513 报告 content links 漏 `/docs` 前缀 |
| 第三方 stevenmenke worker        | item link = `.../CHANGELOG.md#21126`                                                          | 同样 anchor URL；非官方依赖                                           |


而我们的去重栈是：

- `normalizeUrl` (packages/utils/src/url.ts:62) **会** `parsed.hash = ''`，剥掉 fragment。
- `HotNews.sourceUrl` 在 `schema.prisma:65` 上是 `@unique`。
- `IngestionService` 在 `ingestion.service.ts:67-74` 写库前会 `sourceUrl = normalizeUrl(raw.sourceUrl)`，再算 `dedupeHash = sha256(sourceUrl + cleanTitle)`。

结果：所有 anchor-only 区分版本的源，**只能入第 1 条**，其余触发 P2002 → `result.skipped`。这是为什么"直接接入 changelog 这个 URL"在不改任何东西的前提下不工作。

前 3 个 Olshansk 镜像源不存在这个问题：每个 item 有独立的实际页面 URL（`anthropic.com/news/<slug>`、`cursor.com/blog/<slug>`、`claude.com/blog/<slug>`），不依赖 fragment。

## 4. 设计

### 4.1 数据源变更（声明式目标状态）


| name                  | platform | url                                                                                       | enabled | crawlInterval |
| --------------------- | -------- | ----------------------------------------------------------------------------------------- | ------- | ------------- |
| Anthropic News        | RSS      | `https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml` | `true`  | 86400         |
| Cursor Blog           | RSS      | `https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_cursor.xml`         | `true`  | 86400         |
| Claude Blog           | RSS      | `https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_claude.xml`         | `true`  | 86400         |
| Claude Code Changelog | RSS      | `https://code.claude.com/docs/en/changelog/rss.xml`                                       | `true`  | 86400         |


`crawlInterval = 86400` 沿用 SP-4.5 约定（RSS 1 天一抓）。

### 4.2 `seedRss()` 重构

当前 `seedRss()` 的 upsert key 是 `(platform, url)`，url 改了会**新建一行**留下旧 disabled 僵尸。改为：

```ts
async function seedRss() {
  for (const c of rssCandidates) {
    const existing = await prisma.sourceConfig.findFirst({
      where: { platform: 'RSS', name: c.name },
    });
    if (existing) {
      await prisma.sourceConfig.update({
        where: { id: existing.id },
        data: { url: c.url, enabled: c.enabled, crawlInterval: 86400 },
      });
    } else {
      await prisma.sourceConfig.create({
        data: { platform: 'RSS', name: c.name, url: c.url, enabled: c.enabled, crawlInterval: 86400 },
      });
    }
    console.log(`seeded RSS: ${c.name} (enabled=${c.enabled})`);
  }
}
```

跟 `seedHn()` / `seedReddit()` 形态对齐。`(platform, url)` 的 schema unique 仍然存在；这里只是改"按 name 找现存行"以便覆盖 url 变更。

### 4.3 `normalizeUrl` 精确白名单

在 `packages/utils/src/url.ts` 顶部声明一个常量：

```ts
const ANCHOR_INDEXED_PREFIXES: ReadonlyArray<{ hostname: string; pathname: string }> = [
  // SP-4.6: Mintlify Claude Code changelog uses #version anchors as the only
  // per-item identifier; preserving the fragment is the only way these items
  // get distinct sourceUrl values and clear HotNews.sourceUrl @unique + dedupeHash.
  { hostname: 'code.claude.com', pathname: '/docs/en/changelog' },
];
```

`normalizeUrl` 现行 `parsed.hash = ''` 那一行包成条件分支：

```ts
const preserveHash = ANCHOR_INDEXED_PREFIXES.some(
  (entry) => parsed.hostname === entry.hostname && parsed.pathname === entry.pathname,
);
if (!preserveHash) {
  parsed.hash = '';
}
```

**严格匹配 `pathname === entry.pathname`**（不用 `startsWith`），这样 `/docs/en/changelog/rss.xml` 这类子路径不会被意外覆盖；只有 changelog 那一页本身 + 它的 fragment 锚点会保留 hash。

#### 4.3.1 单测（在 `url.spec.ts` 末尾追加一个 describe block）

```ts
describe('SP-4.6 anchor-indexed prefix whitelist', () => {
  it('preserves fragment for code.claude.com/docs/en/changelog', () => {
    expect(normalizeUrl('https://code.claude.com/docs/en/changelog#2-1-126'))
      .toBe('https://code.claude.com/docs/en/changelog#2-1-126');
  });
  it('still strips fragment for sibling paths under code.claude.com/docs', () => {
    expect(normalizeUrl('https://code.claude.com/docs/en/whats-new#abc'))
      .toBe('https://code.claude.com/docs/en/whats-new');
  });
  it('still strips fragment for unrelated hosts', () => {
    expect(normalizeUrl('https://example.com/post#section-1'))
      .toBe('https://example.com/post');
  });
  it('still strips fragment for cursor.com / claude.com / anthropic.com (regression)', () => {
    expect(normalizeUrl('https://cursor.com/blog/x#a')).toBe('https://cursor.com/blog/x');
    expect(normalizeUrl('https://claude.com/blog/y#b')).toBe('https://claude.com/blog/y');
    expect(normalizeUrl('https://www.anthropic.com/news/z#c')).toBe('https://www.anthropic.com/news/z');
  });
});
```

### 4.4 一次性生产 SQL 脚本

`packages/db/scripts/sp4.6-add-rss-sources.sql`，对应 4.1 的目标状态，幂等：

```sql
-- SP-4.6 RSS sources (idempotent).
-- Run once on production via psql or scripts/run-prod-oneshot.sh path.

UPDATE source_configs
   SET url = 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml',
       enabled = true,
       "crawlInterval" = 86400
 WHERE platform = 'RSS' AND name = 'Anthropic News';

INSERT INTO source_configs (id, platform, name, url, identifier, enabled, "crawlInterval", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'RSS', 'Cursor Blog',
       'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_cursor.xml',
       NULL, true, 86400, now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM source_configs WHERE platform = 'RSS' AND name = 'Cursor Blog');

INSERT INTO source_configs (id, platform, name, url, identifier, enabled, "crawlInterval", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'RSS', 'Claude Blog',
       'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_claude.xml',
       NULL, true, 86400, now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM source_configs WHERE platform = 'RSS' AND name = 'Claude Blog');

INSERT INTO source_configs (id, platform, name, url, identifier, enabled, "crawlInterval", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'RSS', 'Claude Code Changelog',
       'https://code.claude.com/docs/en/changelog/rss.xml',
       NULL, true, 86400, now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM source_configs WHERE platform = 'RSS' AND name = 'Claude Code Changelog');
```

> 注：`SourceConfig.id` 在 Prisma schema 里默认是 `cuid()`，由 Prisma 客户端生成。裸 SQL 路径下用 `gen_random_uuid()::text` 是兼容兜底（schema 里 id 只是 String PK，DB 不区分这两种字符串的语义）。如果生产 PG 没装 `pgcrypto`，需要先 `CREATE EXTENSION IF NOT EXISTS pgcrypto;`，或者直接走 4.5 的主路径用 `pnpm db:seed`。

### 4.5 部署顺序

1. 本地：改完代码 → `pnpm turbo run lint typecheck test` → `pnpm db:seed` 验证 4 行 source_configs 落地。
2. 推 PR、merge 到 main，CI 全绿。
3. 生产：**主路径是重 deploy → 在 worker 里跑 `pnpm db:seed`**（依赖 Prisma 客户端生成 cuid 主键，跟现有 SP-4.5 部署形态一致）。SQL 脚本（`packages/db/scripts/sp4.6-add-rss-sources.sql`）作为**应急回放**保留——例如 deploy 失败需要立即恢复 RSS 源时手动 `psql -f`。
4. 等 1 个 24h 周期或手动触发抓取，烟测：
  - 每个新源在 `hot_news` 里至少 1 条 `sourcePlatform='RSS'` 行；Claude Code Changelog 必须有**多条**（验证 fragment 保留生效）。
  - `/api/hot-news?platforms=RSS` 看到这 4 个源新文章。

## 5. 风险与缓解


| 风险                                        | 缓解                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Olshansk 镜像 feed 哪天不维护                    | 监控调度器 `failureCount` 字段；本次不引入 fallback，单源失败时已有 SP-3 容错；后续如需 SLA 提升再独立 SP                                     |
| Mintlify changelog item 顺序内含 v1.x 几十条历史版本 | SP-4.5 的 `RSS_INGEST_WINDOW_MS = 7d` 守卫已经把 publishedAt 早于 7d 的全部 skip；不需要新增逻辑                                |
| `normalizeUrl` 白名单未来误覆盖                   | `pathname === entry.pathname` 严格相等而非 `startsWith`；测试里有"sibling paths 仍被剥"的 negative 断言；将来如需扩展，必须新增白名单条目并附带测试 |
| Anthropic 旧 disabled row 残留               | seedRss() 改为按 name 查找 → update url（不会新建第二行）；生产用 SQL 同样按 name update                                          |
| 第三方镜像 feed 内容跟官网延迟 1-2 天                  | 用户已知 trade-off；权威媒体 7d 窗口对 1-2 天延迟不敏感                                                                        |


## 6. 测试与验证

### 6.1 单元 / 集成测试（本地）

- `packages/utils/src/url.spec.ts` 4 个新 case（4.3.1）。
- `packages/db` 现有 spec 跑通即可（seed.ts 改了 RSS 路径，没有 spec 直接覆盖；通过手测 `pnpm db:seed` 验证）。
- 现有 `IngestionService` / `RssCrawler` 测试不需要新增。

### 6.2 生产烟测（部署后 ≤24h）

- `SELECT name, url, enabled, "crawlInterval" FROM source_configs WHERE platform='RSS' ORDER BY name;` → 7 行（OpenAI / Anthropic / Google Research / Google DeepMind / Cursor / Claude / Claude Code Changelog），全部 enabled。
- `SELECT "sourcePlatform", count(*) FROM hot_news WHERE "publishedAt" >= now() - interval '7 days' GROUP BY 1;` → RSS 数量较 SP-4.5 基线增加。
- 手动 `curl https://<api>/api/hot-news?platforms=RSS&pageSize=20` → 返回结果里出现至少 1 条 Cursor、Claude、Claude Code Changelog 的内容。
- 特别针对 changelog：`SELECT title, "sourceUrl" FROM hot_news WHERE "sourceUrl" LIKE 'https://code.claude.com/docs/en/changelog%' ORDER BY "publishedAt" DESC LIMIT 10;` → 至少 2 条不同版本（确认 fragment 保留生效，如果只 1 条说明 normalizeUrl hack 失败）。

## 7. 不变量回顾

实施完成后必须仍然成立：

- `HotNews.sourceUrl @unique` 仍是 unique，schema 不变。
- `dedupeHash` 算法不变。
- SP-4.5 的 7d ingest cutoff、48h HN/Reddit 显示窗口、`/api/hot-news?platforms=` 行为全部不变。
- 现有 6 个 RSS 源以外的源、HN、Reddit 行为零变化；`normalizeUrl` 在 `code.claude.com/docs/en/changelog` 之外的所有 URL 上行为零变化。

## 8. 完成定义（DoD）

- `seed.ts` 改完，本地 `pnpm db:seed` 后 `source_configs` 里 RSS 7 行匹配 4.1 表（含 OpenAI / Google 两个 + 本次 4 个 + 一个 DeepMind），全部 enabled。
- `url.ts` + `url.spec.ts` 改完，`pnpm turbo run test` 全绿。
- PR 合并到 main，CI 全绿。
- 生产应用 SQL（或 `pnpm db:seed`）后，`source_configs` 状态等价于 4.1 表。
- 24h 内生产侧每个新源至少 1 条 hot_news；Claude Code Changelog ≥ 2 条不同版本。
- decomposition design doc 加 SP-4.6 状态行 + 部署凭据。

