import type { ReactNode } from 'react';

export interface TagProps {
  children: ReactNode;
  color?: string;
}

export function Tag({ children, color = 'var(--c1)' }: TagProps) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium"
      style={{ background: 'var(--accent-soft)', color }}
    >
      {children}
    </span>
  );
}
