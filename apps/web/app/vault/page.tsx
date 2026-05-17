import { Glass, PageHeader, Tag } from '@ai-hot-news/ui';
import { MockupBanner } from '../_components/MockupBanner';

const MOCK_VAULT = [
  {
    id: 'v1',
    title: '为什么大模型 RAG 在生产环境表现总不如预期',
    summary: '从 chunk 策略 / embedding 选型 / rerank 三个维度盘点常见坑，附 6 个开源 baseline 对比。',
    savedAt: '2026-05-12',
    tags: ['topic:RAG', 'topic:Eval'],
  },
  {
    id: 'v2',
    title: 'Cursor 0.50 内置 AI 安全审查的工程拆解',
    summary: '从 prompt injection 防御到 tool call 沙箱化，3 层架构的工程取舍记录。',
    savedAt: '2026-05-08',
    tags: ['product:Cursor', 'topic:Safety'],
  },
];

export default function VaultPage() {
  return (
    <>
      <div className="px-9 pt-7 pb-3">
        <PageHeader
          kicker="Vault"
          title="内容库"
          sub="收藏 · 笔记 · 私人知识库"
        />
        <MockupBanner targetSp="SP-15（用户收藏 & 笔记）" />
      </div>
      <div className="flex-1 overflow-auto px-9 pb-9">
        <div className="space-y-3 fade-up">
          {MOCK_VAULT.map((item) => (
            <Glass key={item.id} variant="hover" as="article">
              <div className="p-6">
                <div className="text-xs text-ink-3 font-mono mb-2">{item.savedAt}</div>
                <h3 className="text-lg font-medium text-ink mb-2">{item.title}</h3>
                <p className="text-sm text-ink-2 mb-3 leading-relaxed">{item.summary}</p>
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
