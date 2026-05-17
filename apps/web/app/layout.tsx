import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ComponentProps, ComponentType, ReactNode } from 'react';
import { Sidebar, type NavLinkProps } from '@ai-hot-news/ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Hot News',
  description: 'AI 圈实时热点 · 跨平台聚合',
};

type NextLinkHref = ComponentProps<typeof Link>['href'];

const NextLinkAdapter: ComponentType<NavLinkProps> = ({ href, children, className, style, ...rest }) => (
  <Link href={href as NextLinkHref} className={className} style={style} {...rest}>
    {children}
  </Link>
);

export default async function RootLayout({ children }: { children: ReactNode }) {
  const rawPath = (await headers()).get('x-pathname') ?? '/';
  const currentPath = rawPath !== '/' && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;

  return (
    <html lang="zh-CN">
      <body>
        <div className="aurora-blob ab-1" aria-hidden="true" />
        <div className="aurora-blob ab-2" aria-hidden="true" />
        <div className="aurora-blob ab-3" aria-hidden="true" />
        <div className="relative z-10 flex h-screen overflow-hidden">
          <Sidebar currentPath={currentPath} LinkComponent={NextLinkAdapter} />
          <main
            data-testid="app-main"
            className="flex-1 min-w-0 flex flex-col overflow-hidden relative z-[1]"
          >
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
