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
