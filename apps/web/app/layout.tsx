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

const NextLinkAdapter: ComponentType<NavLinkProps> = ({ href, children, className, ...rest }) => (
  <Link href={href as NextLinkHref} className={className} {...rest}>
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
        <div className="relative z-10 flex min-h-screen">
          <Sidebar currentPath={currentPath} LinkComponent={NextLinkAdapter} />
          <main className="flex-1 px-6 py-8 md:px-10 md:py-12">
            <div className="max-w-6xl mx-auto">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
