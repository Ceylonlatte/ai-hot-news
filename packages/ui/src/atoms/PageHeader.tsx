import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}

export function PageHeader({ title, subtitle, right }: PageHeaderProps) {
  return (
    <header className="flex items-end justify-between mb-8">
      <div>
        <h1 className="text-3xl font-light tracking-tight text-ink">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-ink-2">{subtitle}</p>
        )}
      </div>
      {right && <div>{right}</div>}
    </header>
  );
}
