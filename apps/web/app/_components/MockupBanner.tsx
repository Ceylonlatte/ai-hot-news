export interface MockupBannerProps {
  targetSp: string;
}

export function MockupBanner({ targetSp }: MockupBannerProps) {
  return (
    <div className="mb-6 flex items-center gap-2 rounded-md border border-red-300 bg-red-50/80 px-3 py-2 text-xs text-red-700">
      <span className="font-mono font-bold">MOCKUP</span>
      <span>·</span>
      <span>本页数据是静态示例，真实数据待 {targetSp} 接入</span>
    </div>
  );
}
