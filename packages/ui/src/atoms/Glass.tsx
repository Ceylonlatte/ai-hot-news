import { type HTMLAttributes, type ReactNode, createElement } from 'react';

export interface GlassProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'card' | 'soft' | 'hover';
  as?: 'div' | 'article' | 'section' | 'aside';
  children: ReactNode;
}

const VARIANT_CLASSNAMES: Record<NonNullable<GlassProps['variant']>, string> = {
  card: 'glass',
  soft: 'glass-soft',
  hover: 'glass glass-hover',
};

export function Glass({
  variant = 'card',
  as: Tag = 'div',
  className = '',
  children,
  ...rest
}: GlassProps) {
  const cls = `${VARIANT_CLASSNAMES[variant]} ${className}`.trim();
  return createElement(Tag, { className: cls, ...rest }, children);
}
