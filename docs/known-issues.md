# Known Issues

> 本文档跟踪当前依赖的上游 / 平台 bug 与 workaround。每条按 **status** 排序，待上游修复后清理对应 workaround。

---

## NEXTJS-83784: `<Html>` import outside `pages/_document` during `next build`

- **Status**: Active workaround in place — waiting upstream fix
- **Affected**: `apps/web` (Next.js 15.5.x with App Router + `output: 'standalone'`)
- **Symptom**: `next build` fails on the `/500` (and sometimes `/404`) static generation step with `Error: <Html> should not be imported outside of pages/_document. Read more: https://nextjs.org/docs/messages/no-document-import-in-page`. The build artifact under `.next/standalone` is *not* produced.
- **Reproduces on**: Local macOS with Node 25 (and other newer Node majors that aren't on the official LTS test matrix). **Does NOT reproduce on**: GitHub Actions CI (Node 22), `apps/web/Dockerfile` build (`node:22-alpine`), or any environment using Node 22.x.
- **Root cause**: In Next.js 15.5.x, when an App-Router-only project ships with `output: 'standalone'`, the build step still synthesizes a Pages-Router-era `_error.js` for `/500` that transitively imports `<Html>` from `pages/_document`. This blew up after Next started running stricter static generation in 15.5. See:
  - <https://github.com/vercel/next.js/issues/83784>
  - <https://github.com/vercel/next.js/issues/77261>
- **Current workaround** (committed in SP-2 收尾, see decomposition spec §11):
  - `apps/web/app/not-found.tsx` — explicit App-Router 404 page so Next stops generating the Pages-Router `/404`.
  - `apps/web/app/global-error.tsx` — explicit App-Router root error boundary that renders its own `<html>` / `<body>` so Next stops generating the Pages-Router `_error`.
  - Together these prevent the prerender step from touching `pages/_document` at all.
- **Why we don't downgrade Next**: 15.5.x has security and Turbopack improvements over 15.4.x. The workaround pages are tiny and will be replaced by SP-8 (visual polish) anyway. Downgrading would also require regenerating the lockfile across the monorepo.
- **Cleanup criteria** (when upstream lands a fix):
  1. Confirm Next.js release notes mention #83784 / #77261 fixed
  2. Bump `next` in `apps/web/package.json` and update lockfile
  3. Run `pnpm --filter @ai-hot-news/web build` on Node 25 — should succeed without the workaround pages
  4. Decide whether to keep the custom not-found / global-error pages anyway (likely yes for UX reasons; they just stop being a workaround and become real product UI)

---

## OPS-2026-05-03: Prod outage — VPS root disk filled by stale GHCR images

- **Status**: Fixed (deploy.sh now prunes on every run)
- **Affected**: VPS `64.64.240.84` (`/dev/sda2` 20G), prod `https://hotnews.shinpeionline.top`
- **Symptom**:
  1. `https://hotnews.shinpeionline.top/news` rendered "暂时无法加载内容 ... API 500: Internal server error"
  2. `https://hotnews.shinpeionline.top/api/health` 200 (web container fine)
  3. `https://hotnews.shinpeionline.top/api/hot-news` 500
  4. GH Actions `Deploy aa57d3a` failed at the SSH step in 4 seconds (no useful Annotation)
  5. `aa57d3a` images were built & pushed to GHCR successfully, but **never deployed** — `git log` on the VPS still showed `b6788fc` as `HEAD`
- **Root cause** (stacked failures, all caused by ENOSPC):
  1. `/dev/sda2 20G 19G 0 100% /` — root disk full
  2. `docker images` had ~20 stale `sha-<commit>` tagged web/api/worker images (~600MB-1GB each, never pruned), totaling 15GB
  3. Postgres tried to `checkpoint` after WAL replay → `PANIC: could not write to file "pg_logical/replorigin_checkpoint.tmp": No space left on device` → Postmaster killed checkpointer → tried to recover → wrote WAL again → PANIC again. Loop ran for ~34 hours, leaving postgres `Up (unhealthy)`
  4. Worker `Restarting (1)` — couldn't connect to a postgres in recovery mode
  5. API kept rejecting queries with `FATAL: the database system is in recovery mode` → BFF route `/api/hot-news` got 500 from API → web returned 500 to clients
  6. `git fetch origin main` on the VPS itself failed: `error: unable to create temporary file: No space left on device` → SSH step in deploy.yml exited 1 in <4s, before any other deploy.sh step could run
- **Recovery procedure** (executed 2026-05-03):
  1. `ssh -i ~/.ssh/ai-hot-news-deploy deploy@64.64.240.84`
  2. `docker image prune -a -f` (no time filter; only protects in-use images) → reclaimed ~12.5GB, disk dropped 100% → 38%
  3. Postgres self-healed within seconds: WAL replay completed, checkpoint succeeded, `(unhealthy)` → `(healthy)`
  4. Docker auto-restarted worker (it was in `Restarting (1)` loop), API queries succeeded, web rendered HN data
  5. No data loss: `/api/hot-news?pageSize=1 → total: 1755` items intact
- **Long-term fix** (commit pending after this postmortem): `scripts/deploy.sh` now runs `docker image prune -a -f` as the **first** step (before `git fetch`, `compose pull`, `compose up`). Prune is safe because it only removes images not referenced by any container — the 5 currently-running containers' images stay. After every deploy, the just-replaced `sha-OLD` images become unreferenced and are reclaimed by the next deploy.
- **Why this wasn't caught earlier**: VPS provisioned 2026-04-26 with 20G; SP-0 through SP-2 only deployed ~7 times before this. Each deploy added ~2GB of new images, so the disk linearly filled to 100% over 7 days. No disk monitoring / alerting was set up.
- **Follow-ups not in this commit**:
  - Add a smoke check that probes `/api/hot-news` (not just `/api/health`) after deploy — the existing smoke step in `deploy.yml` does this already, but only when the SSH step succeeds. Consider a separate cron-style check from GitHub.
  - Consider monitoring + alerting (uptime check on `/api/hot-news`, disk usage alert at 80%). Tracked in SP-25 (observability).
  - The `docker compose up -d --no-deps caddy` is intentionally skipped (cloudflared tunnel handles ingress). Consider removing the `caddy` service from `docker-compose.prod.yml` so prune doesn't churn on its image.

---

## CI-2026-05-17: Flaky `migrate-sp4.spec.ts` / worker integration specs from cross-package real-DB contention

- **Status**: Fixed (PR #29 forces `turbo run test --concurrency=1`)
- **Affected**: `.github/workflows/ci.yml` job `Lint / Typecheck / Build / Test`
- **Symptom**: Random CI failures on docs-only or unrelated PRs with one of:
  - `scripts/migrate-sp4.spec.ts:110 > Layer 2 reddit_low_ratio` — `TypeError: actual value must be number or bigint, received "undefined"` OR `PrismaClientKnownRequestError P2025 No record was found for an update`
  - `apps/worker/src/heat/heat.cron.processor.integration.spec.ts:102` — same `P2025`
  - `prisma:error Unique constraint failed on the fields: ('sourceUrl')` stderr in unrelated specs
  Observed flake rate on `main` before fix: **3 / 8 recent runs failed** (PR #24 / #26 / #27), all rerun-recovered.
- **Reproduces on**: CI (Ubuntu runner, fresh postgres service container, dense timing). **Does NOT reproduce reliably on local** (looser timing, dev DB has historical rows that change `runMigrateSp4`'s whole-table scan path).
- **Root cause**: Two packages run real-DB integration specs against the same `DATABASE_URL`:
  - `@ai-hot-news/db` — 7 spec files (`migrate-sp4`, `cleanup-rss-pre-window`, `cleanup-antibot-extracted`, `consolidate-sp5-sources`, `sp5-5-source-migrations`, `wipe-hot-news-pre-sp5`, `wipe-hot-news-pre-ai`)
  - `@ai-hot-news/worker` — 2 spec files (`ingestion.service.integration.spec`, `heat.cron.processor.integration.spec`)
  `packages/db/vitest.config.ts` already sets `fileParallelism: false` so the 7 db specs run sequentially **within** the package. But `pnpm turbo run test` runs `@ai-hot-news/db` and `@ai-hot-news/worker` **in parallel** (turbo defaults to 10x concurrency). `runMigrateSp4()` does a whole-table scan + read-then-update, which races against the worker specs' `prisma.hotNews.create()` / `deleteMany()`, producing P2002 / P2025 / missing-row errors.
- **Current fix**: Add `--concurrency=1` to the CI test step and the root `pnpm test` script. Cost: ~10-20s extra wall-clock (db ~2s + worker ~5s, previously overlapped). Benefit: removes the entire class of cross-package DB contention flakes.
- **Cleanup criteria** (when we want speed back):
  1. Audit every spec file in `packages/db/scripts/`, `apps/worker/src/`, `apps/api/src/` and split into `test:unit` (mock-only, can parallelize) vs `test:integration` (real DB, must serialize)
  2. Split `turbo.json` task into `test:unit` + `test:integration` with appropriate dependencies
  3. Update `.github/workflows/ci.yml` to run both in sequence; only `test:integration` needs `--concurrency=1`
  4. Add lint rule or CI guard so new specs declare which bucket they belong to
- **Decision deferred to V2**: `heat.cron.processor.ts` `read-then-update` could be wrapped in a single transaction or `updateMany` to make the worker spec robust to deletions. Useful regardless of CI fix because prod worker also has this race (rare but possible).

---

## Template for new entries

```
## SHORT-CODE-####: One-line summary

- **Status**: Active workaround | Investigating | Blocked on upstream | Fixed
- **Affected**: which app/package
- **Symptom**: ...
- **Reproduces on / does NOT reproduce on**: ...
- **Root cause**: ... (link to issue)
- **Current workaround**: ...
- **Cleanup criteria**: ...
```
