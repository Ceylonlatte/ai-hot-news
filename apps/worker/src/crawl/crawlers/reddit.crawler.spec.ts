import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedditCrawler } from './reddit.crawler';
import linkPostFixture from '../fixtures/reddit-link-post.json';
import selfPostFixture from '../fixtures/reddit-self-post.json';
import hotListingFixture from '../fixtures/reddit-hot-listing.json';

const UA = 'ai-hot-news-bot/0.1 (by /u/test_owner)';

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function listingOf(post: unknown): Record<string, unknown> {
  return {
    kind: 'Listing',
    data: { after: null, before: null, children: [{ kind: 't3', data: post }] },
  };
}

describe('RedditCrawler.fetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('builds the standard subreddit URL when only identifier is given', async () => {
    fetchMock.mockResolvedValue(jsonResponse(hotListingFixture));
    const crawler = new RedditCrawler(
      { id: 'src-redd-1', url: null, identifier: 'OpenAI' },
      UA,
    );
    await crawler.fetch();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://www.reddit.com/r/OpenAI/hot.json?limit=25&raw_json=1',
    );
  });

  it('uses source.url verbatim when provided (extension form)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(hotListingFixture));
    const crawler = new RedditCrawler(
      {
        id: 'src-redd-search',
        url: 'https://www.reddit.com/search.json?q=AI+agent&sort=new&limit=25',
        identifier: null,
      },
      UA,
    );
    await crawler.fetch();
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://www.reddit.com/search.json?q=AI+agent&sort=new&limit=25',
    );
  });

  it('throws when both url and identifier are missing', async () => {
    const crawler = new RedditCrawler(
      { id: 'src-redd-bad', url: null, identifier: null },
      UA,
    );
    await expect(crawler.fetch()).rejects.toThrow(
      /Reddit SourceConfig src-redd-bad missing both url and identifier/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the configured User-Agent and Accept headers plus AbortSignal', async () => {
    fetchMock.mockResolvedValue(jsonResponse(hotListingFixture));
    const crawler = new RedditCrawler(
      { id: 'src-redd-2', url: null, identifier: 'OpenAI' },
      UA,
    );
    await crawler.fetch();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe(UA);
    expect(headers['Accept']).toBe('application/json');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws on 429 with Retry-After hint', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 429, { 'retry-after': '7' }));
    const crawler = new RedditCrawler(
      { id: 'src-redd-3', url: null, identifier: 'OpenAI' },
      UA,
    );
    await expect(crawler.fetch()).rejects.toThrow(
      /Reddit rate-limited \(429\) for .+, Retry-After=7/,
    );
  });

  it('throws on non-200 with status text', async () => {
    fetchMock.mockResolvedValue(new Response('forbidden', { status: 403, statusText: 'Forbidden' }));
    const crawler = new RedditCrawler(
      { id: 'src-redd-4', url: null, identifier: 'OpenAI' },
      UA,
    );
    await expect(crawler.fetch()).rejects.toThrow(/Reddit fetch 403/);
  });

  it('throws when payload is not a Listing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'whoops' }));
    const crawler = new RedditCrawler(
      { id: 'src-redd-5', url: null, identifier: 'OpenAI' },
      UA,
    );
    await expect(crawler.fetch()).rejects.toThrow(/response not a Listing/);
  });

  it('filters stickied and NSFW posts and produces 3 items from the 5-child fixture', async () => {
    fetchMock.mockResolvedValue(jsonResponse(hotListingFixture));
    const crawler = new RedditCrawler(
      { id: 'src-redd-6', url: null, identifier: 'OpenAI' },
      UA,
    );
    const items = await crawler.fetch();
    expect(items).toHaveLength(3);
    const ids = items.map((it) => it.interactionData?.redditId);
    expect(ids).toEqual(['1k4xz9p', '1k4xz9q', '1k4xz9t']);
  });

  it('maps a link-post correctly (externalUrl set, rawHtml null, contentText=title)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(listingOf(linkPostFixture)));
    const crawler = new RedditCrawler(
      { id: 'src-redd-7', url: null, identifier: 'OpenAI' },
      UA,
    );
    const [item] = await crawler.fetch();
    expect(item.title).toBe('GPT-5 announced');
    expect(item.contentText).toBe('GPT-5 announced');
    expect(item.rawHtml).toBeNull();
    expect(item.sourceUrl).toBe('https://www.reddit.com/r/OpenAI/comments/1k4xz9p/');
    expect(item.author).toBe('user_alice');
    expect(item.publishedAt).toEqual(new Date(1746230400 * 1000));
    expect(item.interactionData).toEqual({
      score: 1234,
      comments: 56,
      externalUrl: 'https://openai.com/news/gpt-5',
      redditId: '1k4xz9p',
      redditSubreddit: 'OpenAI',
      redditUpvoteRatio: 0.95,
    });
  });

  it('maps a self-post correctly (externalUrl null, rawHtml=selftext_html, contentText=stripHtml)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(listingOf(selfPostFixture)));
    const crawler = new RedditCrawler(
      { id: 'src-redd-8', url: null, identifier: 'LocalLLaMA' },
      UA,
    );
    const [item] = await crawler.fetch();
    expect(item.contentText).toContain('Hi everyone, I built a benchmark');
    expect(item.contentText).not.toContain('<');
    expect(item.rawHtml).toContain('<strong>benchmark</strong>');
    expect(item.interactionData?.externalUrl).toBeNull();
    expect(item.interactionData?.redditSubreddit).toBe('LocalLLaMA');
  });

  it('normalizes "[deleted]" author to null', async () => {
    fetchMock.mockResolvedValue(jsonResponse(hotListingFixture));
    const crawler = new RedditCrawler(
      { id: 'src-redd-9', url: null, identifier: 'OpenAI' },
      UA,
    );
    const items = await crawler.fetch();
    const deleted = items.find((it) => it.interactionData?.redditId === '1k4xz9t');
    expect(deleted).toBeDefined();
    expect(deleted!.author).toBeNull();
    expect(deleted!.interactionData?.redditUpvoteRatio).toBeNull();
  });

  it('falls back to post.subreddit when identifier is null and url is given (cluster-source mode)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(listingOf(selfPostFixture)));
    const crawler = new RedditCrawler(
      {
        id: 'src-redd-cluster',
        url: 'https://www.reddit.com/r/MachineLearning+LocalLLaMA+OpenAI/hot.json?limit=50',
        identifier: null,
      },
      UA,
    );
    const [item] = await crawler.fetch();
    expect(item.interactionData?.redditSubreddit).toBe('LocalLLaMA');
    expect(item.sourceUrl).toBe(
      'https://www.reddit.com/r/LocalLLaMA/comments/1k4xz9q/',
    );
  });

  it('handles a self-post with selftext_html=null gracefully (rawHtml=null, contentText=title)', async () => {
    const noHtml = { ...selfPostFixture, selftext_html: null };
    fetchMock.mockResolvedValue(jsonResponse(listingOf(noHtml)));
    const crawler = new RedditCrawler(
      { id: 'src-redd-10', url: null, identifier: 'LocalLLaMA' },
      UA,
    );
    const [item] = await crawler.fetch();
    expect(item.rawHtml).toBeNull();
    expect(item.contentText).toBe('Show: my local LLM benchmark');
  });
});
