import { Glass, PageHeader, Pill, Tag } from '@ai-hot-news/ui';
import { MockupBanner } from '../_components/MockupBanner';

const MOCK_RADAR_ITEMS = [
  {
    id: 'r1',
    title: 'Anthropic releases Claude Sonnet 4.7 with extended thinking on by default',
    titleZh: 'Anthropic 发布 Claude Sonnet 4.7 默认启用扩展思考',
    platform: 'HACKERNEWS' as const,
    age: '47m',
    tags: ['model:Claude', 'company:Anthropic'],
  },
  {
    id: 'r2',
    title: 'Show HN: A local-first vector DB written in Rust',
    titleZh: 'Show HN：用 Rust 写的本地优先向量数据库',
    platform: 'HACKERNEWS' as const,
    age: '1h 12m',
    tags: ['lib:Rust', 'topic:VectorDB'],
  },
  {
    id: 'r3',
    title: 'r/MachineLearning: GPT-5 system card leaked screenshots',
    titleZh: 'r/MachineLearning：GPT-5 system card 截图疑似泄露',
    platform: 'REDDIT' as const,
    age: '2h 5m',
    tags: ['model:GPT-5', 'topic:Safety'],
  },
];

export default function RadarPage() {
  return (
    <>
      <div className="px-9 pt-7 pb-3">
        <PageHeader
          kicker="Keyword Radar"
          title="关键词"
          gradTitle="监控雷达"
          sub="抓取 < 3h 的新冒头议题 · 跨平台首发追踪"
        />
        <MockupBanner targetSp="SP-9（Radar 真实数据接入）" />
      </div>
      <div className="flex-1 overflow-auto px-9 pb-9">
        <div className="space-y-3 fade-up">
          {MOCK_RADAR_ITEMS.map((item) => (
            <Glass key={item.id} variant="hover" as="article">
              <div className="p-5">
                <div className="flex items-center gap-2 mb-2 text-xs text-ink-3">
                  <Pill platform={item.platform} />
                  <span className="text-aurora font-mono font-medium">{item.age}</span>
                  <span className="blink">·</span>
                  <span>new</span>
                </div>
                <h3 className="text-base font-medium text-ink mb-1">
                  {item.titleZh ?? item.title}
                </h3>
                {item.titleZh && (
                  <p className="text-xs text-ink-3 mb-3">{item.title}</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {item.tags.map((t, i) => (
                    <Tag key={t} index={i}>
                      {t}
                    </Tag>
                  ))}
                </div>
              </div>
            </Glass>
          ))}
        </div>
      </div>
    </>
  );
}
