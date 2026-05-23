import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { PageHeader } from '@ai-hot-news/ui';
import { getCurrentUser } from '@/lib/auth';
import { LoginForm } from './_components/login-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ next?: string }>;
}

// SP-13 (2026-05-23): /login page.
//
// 行为:
//   - 已登录 → redirect to ?next= (or /)
//   - 未登录 → 显示 LoginForm (client component)
//
// 视觉沿用 Aurora layout (sidebar 仍然显示)。"管理员登录" PageHeader
// 简洁说明这是个人单用户 admin 入口，不是公开注册。
export default async function LoginPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const next = sp.next && sp.next.startsWith('/') ? sp.next : '/';
  if (user) {
    // typedRoutes: dynamic next value cast — same pattern as SP-10 search-params.
    redirect(next as Route);
  }

  return (
    <>
      <div className="px-9 pt-7 pb-3">
        <PageHeader
          kicker="Login"
          title="管理员登录"
          sub="个人单用户站点 · 登录后可管理关键词监控与推送（M6 阶段）"
        />
      </div>
      <div className="flex-1 overflow-auto px-9 pb-9">
        <div className="rounded-2xl border border-line bg-white/55 backdrop-blur-sm p-8 max-w-md">
          <LoginForm next={next} />
        </div>
      </div>
    </>
  );
}
