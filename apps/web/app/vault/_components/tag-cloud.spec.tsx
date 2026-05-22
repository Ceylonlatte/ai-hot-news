import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TagCloud } from './tag-cloud';

const tags = [
  { tag: 'company:OpenAI', count: 186 },
  { tag: 'category:Opinion', count: 556 },
  { tag: 'model:Claude-3.5-Sonnet', count: 76 },
];

describe('TagCloud (SP-12)', () => {
  it('renders nothing when tags array is empty', () => {
    const { container } = render(<TagCloud tags={[]} selectedTags={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one chip per tag with count appended', () => {
    const { container } = render(<TagCloud tags={tags} selectedTags={[]} />);
    const anchors = container.querySelectorAll('a');
    expect(anchors.length).toBe(3);
    expect(anchors[0]!.textContent).toContain('company:OpenAI');
    expect(anchors[0]!.textContent).toContain('186');
  });

  it('non-selected tag href points to /vault?tags=<encoded>', () => {
    const { container } = render(<TagCloud tags={tags} selectedTags={[]} />);
    const link = container.querySelector('a[href*="OpenAI"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/vault?tags=company%3AOpenAI');
  });

  it('selected tag href points to /vault (toggle off)', () => {
    const { container } = render(
      <TagCloud tags={tags} selectedTags={['company:OpenAI']} />,
    );
    // The OpenAI chip should now href="/vault"
    const links = Array.from(container.querySelectorAll('a'));
    const openAiLink = links.find((a) => a.textContent?.includes('OpenAI'))!;
    expect(openAiLink.getAttribute('href')).toBe('/vault');
  });

  it('title attribute reflects selected vs unselected state', () => {
    const { container } = render(
      <TagCloud tags={tags} selectedTags={['company:OpenAI']} />,
    );
    const links = Array.from(container.querySelectorAll('a'));
    const openAi = links.find((a) => a.textContent?.includes('OpenAI'))!;
    const opinion = links.find((a) => a.textContent?.includes('Opinion'))!;
    expect(openAi.getAttribute('title')).toContain('取消筛选');
    expect(opinion.getAttribute('title')).toContain('556');
    expect(opinion.getAttribute('title')).toContain('点击筛选');
  });

  it('section title says "推荐标签"', () => {
    const { getByText } = render(<TagCloud tags={tags} selectedTags={[]} />);
    expect(getByText(/推荐标签/)).toBeInTheDocument();
  });
});
