import { Glass, PageHeader, Tag } from '@ai-hot-news/ui';
import { MockupBanner } from '../_components/MockupBanner';

const MOCK_TRENDS = [
  { tag: 'model:Claude',     count: 47, delta: '+18', cls: 'w-[88%]' },
  { tag: 'model:GPT-5',      count: 39, delta: '+22', cls: 'w-[78%]' },
  { tag: 'company:OpenAI',   count: 35, delta: '+5',  cls: 'w-[70%]' },
  { tag: 'topic:Agent',      count: 28, delta: '+11', cls: 'w-[58%]' },
  { tag: 'lib:LangChain',    count: 19, delta: '-3',  cls: 'w-[42%]' },
  { tag: 'topic:Eval',       count: 14, delta: '+7',  cls: 'w-[32%]' },
];

export default function TrendsPage() {
  return (
    <>
      <MockupBanner targetSp="SP-12（aiTags 时间序列聚合）" />
      <PageHeader
        title="Trends"
        subtitle="7d aiTags 热度排行 · delta = 相比前 7d"
      />
      <Glass>
        <div className="p-6 fade-up">
          <ul className="space-y-4">
            {MOCK_TRENDS.map((row) => (
              <li key={row.tag}>
                <div className="flex items-center justify-between mb-1.5">
                  <Tag>{row.tag}</Tag>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span className="text-ink-2">{row.count}</span>
                    <span className={row.delta.startsWith('-') ? 'text-ink-3' : 'text-aurora'}>
                      {row.delta}
                    </span>
                  </div>
                </div>
                <div className="h-1.5 bg-ink/[0.04] rounded-full overflow-hidden">
                  <div className={`h-full bg-aurora rounded-full fill-bar ${row.cls}`} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Glass>
    </>
  );
}
