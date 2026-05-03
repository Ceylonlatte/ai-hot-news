import type { HotNewsListItemDto } from '@ai-hot-news/types';

const TIME_FMT = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'short',
  timeStyle: 'short',
});

export function NewsItem({ item }: { item: HotNewsListItemDto }) {
  const meta = [
    item.author ?? '匿名',
    item.sourcePlatform,
    TIME_FMT.format(new Date(item.publishedAt)),
  ].join(' · ');
  return (
    <li className="py-3">
      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-base font-medium text-gray-900 hover:underline"
      >
        {item.title}
      </a>
      <div className="mt-1 text-xs text-gray-500">{meta}</div>
    </li>
  );
}
