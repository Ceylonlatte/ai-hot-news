import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { HotNewsListResponseDto } from '@ai-hot-news/types';
import type { FeedPlatform } from '@/lib/api';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : ''} {...props}>
      {children}
    </a>
  ),
}));

import type * as ApiModule from '@/lib/api';

const fetchClientMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof ApiModule>('@/lib/api');
  return {
    ...real,
    fetchHotNewsListClient: fetchClientMock,
  };
});

import { NewsFeed } from './news-feed';

const baseItem = {
  id: 'item-1',
  title: 'T',
  titleZh: null,
  summary: null,
  aiTags: [],
  sourceUrl: 'https://example.com/x',
  sourcePlatform: 'HACKERNEWS' as const,
  author: null,
  publishedAt: new Date('2026-05-20T12:00:00Z').toISOString(),
  crawledAt: new Date('2026-05-20T12:05:00Z').toISOString(),
  heatScore: 50,
  heatLevel: 'NORMAL' as const,
  groupId: null,
  groupSize: 1,
  groupPlatforms: {},
  groupMembers: [],
  subreddit: null,
};

function makePage(
  page: number,
  pageSize: number,
  total: number,
  ids: string[],
): HotNewsListResponseDto {
  return {
    items: ids.map((id, i) => ({ ...baseItem, id, title: `T-${id}` , publishedAt: new Date(Date.now() - i * 60_000).toISOString() })),
    page,
    pageSize,
    total,
  };
}

// IntersectionObserver mock — captures the callback so we can manually
// fire entries to simulate the user scrolling to the sentinel. `disconnect`
// nulls out the callback so that any further trigger() on a disconnected
// observer becomes a no-op (matches real IntersectionObserver semantics —
// without this, vitest cleanup wouldn't actually unwire the listener and
// the "after done" assertions would still see fetches fire).
class MockIntersectionObserver {
  static lastInstance: MockIntersectionObserver | null = null;
  callback: IntersectionObserverCallback | null;
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
    MockIntersectionObserver.lastInstance = this;
  }
  observe = vi.fn();
  disconnect = vi.fn(() => {
    this.callback = null;
  });
  unobserve = vi.fn();
  takeRecords = vi.fn();
  trigger(isIntersecting: boolean) {
    if (!this.callback) return;
    this.callback(
      [{ isIntersecting } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

describe('NewsFeed (SP-10 PR-C)', () => {
  beforeEach(() => {
    fetchClientMock.mockReset();
    MockIntersectionObserver.lastInstance = null;
    // @ts-expect-error — assigning to global for jsdom
    global.IntersectionObserver = MockIntersectionObserver;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const initial = makePage(1, 20, 50, ['a', 'b', 'c']);
  const baseProps = {
    platforms: ['HACKERNEWS', 'REDDIT'] as FeedPlatform[],
    range: '1d' as const,
    sort: 'time' as const,
    tags: [] as string[],
  };

  it('renders initialData items immediately', () => {
    const { getByText } = render(<NewsFeed initialData={initial} {...baseProps} />);
    expect(getByText('T-a')).toBeInTheDocument();
    expect(getByText('T-b')).toBeInTheDocument();
    expect(getByText('T-c')).toBeInTheDocument();
  });

  it('triggers fetchHotNewsListClient when sentinel becomes visible', async () => {
    fetchClientMock.mockResolvedValueOnce(makePage(2, 20, 50, ['d', 'e']));
    const { getByText } = render(<NewsFeed initialData={initial} {...baseProps} />);

    await act(async () => {
      MockIntersectionObserver.lastInstance?.trigger(true);
    });
    await waitFor(() => {
      expect(getByText('T-d')).toBeInTheDocument();
    });
    expect(fetchClientMock).toHaveBeenCalledWith(
      2,
      20,
      baseProps.platforms,
      'time',
      { range: '1d', tags: [] },
    );
  });

  it('marks done after all pages loaded — no further fetches', async () => {
    // total=4, initial loaded 3 items, need 1 more page with 1 item to complete.
    const small = makePage(1, 20, 4, ['a', 'b', 'c']);
    fetchClientMock.mockResolvedValueOnce(makePage(2, 20, 4, ['d']));

    const { getByText } = render(<NewsFeed initialData={small} {...baseProps} />);
    await act(async () => {
      MockIntersectionObserver.lastInstance?.trigger(true);
    });
    await waitFor(() => {
      expect(getByText(/已加载全部 4 条/)).toBeInTheDocument();
    });

    // Fire again — should not fetch (sentinel removed, IO disconnected).
    fetchClientMock.mockClear();
    await act(async () => {
      MockIntersectionObserver.lastInstance?.trigger(true);
    });
    expect(fetchClientMock).not.toHaveBeenCalled();
  });

  it('immediately marks done when initial response is empty', () => {
    const empty = makePage(1, 20, 0, []);
    const { getByText, queryByRole } = render(
      <NewsFeed initialData={empty} {...baseProps} />,
    );
    expect(getByText(/已加载全部 0 条/)).toBeInTheDocument();
    // Sentinel must not be present (done state replaces it).
    expect(queryByRole('button')).toBeNull();
  });

  it('shows next-range link "看近 7 天" when range=1d on done state', () => {
    const small = makePage(1, 20, 0, []);
    const { container } = render(<NewsFeed initialData={small} {...baseProps} />);
    const link = container.querySelector('a[href="/news?range=7d"]')!;
    expect(link).not.toBeNull();
    expect(link.textContent).toContain('看近 7 天');
  });

  it('shows "看近 30 天" when range=7d', () => {
    const small = makePage(1, 20, 0, []);
    const { container } = render(
      <NewsFeed initialData={small} {...baseProps} range="7d" />,
    );
    const link = container.querySelector('a[href="/news?range=30d"]')!;
    expect(link.textContent).toContain('看近 30 天');
  });

  it('shows "去内容库搜索" → /vault when range=30d (SP-12 handoff)', () => {
    const small = makePage(1, 20, 0, []);
    const { container } = render(
      <NewsFeed initialData={small} {...baseProps} range="30d" />,
    );
    const link = container.querySelector('a[href="/vault"]')!;
    expect(link.textContent).toContain('去内容库搜索');
  });

  it('surfaces fetch errors with a retry button (no infinite re-fire)', async () => {
    fetchClientMock.mockRejectedValueOnce(new Error('500 internal'));
    const { getByText } = render(<NewsFeed initialData={initial} {...baseProps} />);
    await act(async () => {
      MockIntersectionObserver.lastInstance?.trigger(true);
    });
    await waitFor(() => {
      expect(getByText(/加载失败/)).toBeInTheDocument();
      expect(getByText('重试')).toBeInTheDocument();
    });
  });
});
