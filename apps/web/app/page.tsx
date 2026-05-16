import Link from 'next/link';
import type { ComponentProps } from 'react';
import { Glass, PageHeader } from '@ai-hot-news/ui';
import { MockupBanner } from './_components/MockupBanner';

type NextLinkHref = ComponentProps<typeof Link>['href'];

export default function HomePage() {
  return (
    <>
      <MockupBanner targetSp="SP-8 V1（HomePage 真数据接入留给 V2）" />
      <PageHeader
        title="Aurora"
        subtitle="AI 圈热点聚合 · 实时雷达 · 趋势观察"
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 fade-up">
        <Glass variant="hover" as="article">
          <Link href="/news" className="block p-6">
            <div className="text-aurora text-sm font-medium mb-2">News</div>
            <div className="text-2xl font-light tracking-tight text-ink mb-2">
              热点列表
            </div>
            <p className="text-sm text-ink-2">
              HN / Reddit / RSS 跨平台合并 · 24h 滚动 · heatScore 排序
            </p>
          </Link>
        </Glass>
        <Glass variant="hover" as="article">
          <Link href={'/radar' as NextLinkHref} className="block p-6">
            <div className="text-aurora text-sm font-medium mb-2">Radar</div>
            <div className="text-2xl font-light tracking-tight text-ink mb-2">
              新冒头雷达
            </div>
            <p className="text-sm text-ink-2">
              抓取&lt;3h 的新议题 · 跨平台首发追踪 · Mockup
            </p>
          </Link>
        </Glass>
        <Glass variant="hover" as="article">
          <Link href={'/trends' as NextLinkHref} className="block p-6">
            <div className="text-aurora text-sm font-medium mb-2">Trends</div>
            <div className="text-2xl font-light tracking-tight text-ink mb-2">
              趋势观察
            </div>
            <p className="text-sm text-ink-2">
              7d / 30d 关键词热度曲线 · aiTags 维度切片 · Mockup
            </p>
          </Link>
        </Glass>
      </div>
    </>
  );
}
