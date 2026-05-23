import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { PageHeader } from '@ai-hot-news/ui';
import { getCurrentUser } from '@/lib/auth';
import { fetchKeywordsList } from '@/lib/keywords-server';
import { KeywordsClient } from './_components/keywords-client';

// SP-15 (2026-05-23): 关键词监控页 RSC 入口。
//
// - 未登录 → 服务端 302 到 /login?next=/keywords（SP-13 login 支持回跳）
// - 已登录 → 服务端拉一次 /keywords (含 hitCount aggregate) 灌入 client
//   component，后续的 create/update/delete/toggle 由 client 走 BFF。
//
// 该页面禁用静态优化 —— 列表内容随用户操作变化，必须 force-dynamic。

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '关键词监控 · AI Hot News',
};

export default async function KeywordsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login?next=/keywords' as Route);
  }

  const initialData = await fetchKeywordsList();

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <PageHeader
        kicker="Keyword Radar"
        title="关键词监控"
        sub={`${initialData.total} 个关键词监控中 · 命中即写入 KeywordHit，反写 HotNews.matchedKeywords`}
      />
      <KeywordsClient initialData={initialData} />
    </div>
  );
}
