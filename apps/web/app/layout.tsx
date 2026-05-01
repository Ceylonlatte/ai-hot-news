import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Hot News',
  description: 'AI 热点信息聚合与监控平台',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
