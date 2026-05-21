import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CategoryChips } from './category-chips';

// Next.js `<Link>` requires the App Router runtime; we stub it to a plain
// <a> for unit tests so we can assert href content directly.
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : ''} {...props}>
      {children}
    </a>
  ),
}));

const baseState = {
  tab: 'community' as const,
  range: '1d' as const,
  sort: 'time' as const,
};

describe('CategoryChips (SP-10)', () => {
  it('renders 11 chips (10 categories + 全部)', () => {
    const { container } = render(
      <CategoryChips selectedTags={[]} state={baseState} />,
    );
    expect(container.querySelectorAll('a').length).toBe(11);
  });

  it('marks 全部 active when no category tags selected', () => {
    const { container } = render(
      <CategoryChips selectedTags={[]} state={baseState} />,
    );
    const allChip = container.querySelector('a[aria-current="page"]');
    expect(allChip?.textContent).toBe('全部');
  });

  it('marks 全部 active even when non-category tags selected (e.g. company:OpenAI)', () => {
    const { container } = render(
      <CategoryChips
        selectedTags={['company:OpenAI']}
        state={baseState}
      />,
    );
    const allChip = container.querySelector('a[aria-current="page"]');
    expect(allChip?.textContent).toBe('全部');
  });

  it('marks 开源 chip active when category:OpenSource is in tags', () => {
    const { container } = render(
      <CategoryChips
        selectedTags={['category:OpenSource']}
        state={baseState}
      />,
    );
    const actives = Array.from(
      container.querySelectorAll('a[aria-current="page"]'),
    );
    expect(actives).toHaveLength(1);
    expect(actives[0]!.textContent).toBe('开源');
  });

  it('clicking 开源 from empty appends category:OpenSource to URL', () => {
    const { container } = render(
      <CategoryChips selectedTags={[]} state={baseState} />,
    );
    const openSource = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === '开源',
    )!;
    expect(openSource.getAttribute('href')).toBe(
      '/news?tags=category%3AOpenSource',
    );
  });

  it('clicking already-active chip toggles it off (URL omits the tag)', () => {
    const { container } = render(
      <CategoryChips
        selectedTags={['category:OpenSource']}
        state={baseState}
      />,
    );
    const openSource = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === '开源',
    )!;
    // After toggle off, tags become [] → URL = /news (DEFAULT_RANGE/sort不显式)
    expect(openSource.getAttribute('href')).toBe('/news');
  });

  it('clicking second chip ANDs them together in URL', () => {
    const { container } = render(
      <CategoryChips
        selectedTags={['category:OpenSource']}
        state={baseState}
      />,
    );
    const release = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === '模型发布',
    )!;
    expect(release.getAttribute('href')).toBe(
      '/news?tags=category%3AOpenSource%2Ccategory%3ARelease',
    );
  });

  it('全部 chip resets category tags but preserves company/model/tech tags', () => {
    const { container } = render(
      <CategoryChips
        selectedTags={[
          'category:OpenSource',
          'company:OpenAI',
          'tech:RAG',
        ]}
        state={baseState}
      />,
    );
    const allChip = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === '全部',
    )!;
    expect(allChip.getAttribute('href')).toBe(
      '/news?tags=company%3AOpenAI%2Ctech%3ARAG',
    );
  });

  it('preserves tab + range + sort in chip hrefs', () => {
    const { container } = render(
      <CategoryChips
        selectedTags={[]}
        state={{ tab: 'media', range: '7d', sort: 'heat' }}
      />,
    );
    const openSource = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === '开源',
    )!;
    const href = openSource.getAttribute('href')!;
    expect(href).toContain('tab=media');
    expect(href).toContain('range=7d');
    expect(href).toContain('sort=heat');
    expect(href).toContain('tags=category%3AOpenSource');
  });
});
