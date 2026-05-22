import Link from 'next/link';
import { PageHeader } from '@ai-hot-news/ui';

// SP-12 follow-up (2026-05-22): not-found.tsx 视觉升级到 Aurora 主题。
//
// 历史：SP-2 时代为了 workaround NEXTJS-83784 (Next 15.5.x + standalone
// 输出在 `next build` 时让 Pages-Router-era /_error 触发静态生成失败)
// 加了一个最小化 not-found.tsx。当时是简单的 main + 灰色卡片。
//
// 问题：Next.js 15 App Router 的 RSC streaming 行为把 root `not-found.tsx`
// 作为 segment 一起 stream 到客户端 — 在网络慢时浏览器可能短暂渲染 not-found
// chunk 然后被真实 page 内容覆盖。用户实测在 /vault /news 加载时偶尔看到
// "页面未找到" 闪现（虽然 HTTP 200 + 完整 page HTML 也在 stream 里）。
//
// Fix：
//   1. 去掉 `<main>` wrapper — layout.tsx 已经有 `<main data-testid="app-main">`，
//      not-found.tsx 嵌套会产生双 `<main>`，HTML 不合法
//   2. 用 PageHeader + Aurora 视觉，即使闪现也不显得"出错"
//   3. 维持作为真实 404 fallback 的功能（直接访问 /asdfasdf 仍能看到此页）
export default function NotFound() {
  return (
    <>
      <div className="px-9 pt-7 pb-3">
        <PageHeader
          kicker="404"
          title="页面未找到"
          sub="检查链接是否正确，或者回到首页继续浏览"
        />
      </div>
      <div className="flex-1 overflow-auto px-9 pb-9">
        <div className="rounded-2xl border border-line bg-white/55 backdrop-blur-sm p-8 max-w-xl">
          <p className="text-sm text-ink-2 leading-relaxed">
            你访问的内容暂时不存在。如果是从分享链接进来的，
            可能因为时间窗口外的内容已经被 SP-10.5 的 30 天 TTL 清理掉了。
          </p>
          <div className="mt-5 flex gap-3 text-[13px]">
            <Link
              href="/"
              className="px-3.5 py-1.5 rounded-full text-white font-semibold shadow-sm transition-all"
              style={{ background: 'var(--grad)' }}
            >
              ← 返回首页
            </Link>
            <Link
              href="/news"
              className="px-3.5 py-1.5 rounded-full text-ink-2 hover:text-ink bg-white/55 border border-line transition-all"
            >
              热点流
            </Link>
            <Link
              href="/vault"
              className="px-3.5 py-1.5 rounded-full text-ink-2 hover:text-ink bg-white/55 border border-line transition-all"
            >
              内容库
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
