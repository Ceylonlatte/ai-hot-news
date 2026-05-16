import { Glass } from '@ai-hot-news/ui';

export function ErrorState({ message }: { message: string }) {
  return (
    <Glass variant="soft">
      <div className="px-6 py-8">
        <div className="text-sm font-medium text-red-700 mb-1">加载失败</div>
        <p className="text-xs text-ink-2 break-all">{message}</p>
      </div>
    </Glass>
  );
}
