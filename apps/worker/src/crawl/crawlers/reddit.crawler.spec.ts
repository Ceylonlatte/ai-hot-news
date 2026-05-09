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
    expect(item.sourceUrl).toBe('https://www.reddit.com/r/OpenAI/comments/1k4xz9p');
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
      'https://www.reddit.com/r/LocalLLaMA/comments/1k4xz9q',
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

  // === SP-4: filterReason on toRaw ===

  it('SP-4: writes filterReason="reddit_low_ratio" when upvote_ratio < 0.5', async () => {
    const lowRatioPost = {
      id: 'abc',
      title: 'Some title',
      author: 'alice',
      subreddit: 'OpenAI',
      url: 'https://example.com/a',
      permalink: '/r/OpenAI/comments/abc',
      is_self: false,
      selftext: '',
      selftext_html: null,
      created_utc: 1746230400,
      score: 100,
      ups: 100,
      downs: 0,
      num_comments: 50,
      upvote_ratio: 0.4,
      stickied: false,
      over_18: false,
    };
    fetchMock.mockResolvedValue(jsonResponse(listingOf(lowRatioPost)));

    const crawler = new RedditCrawler(
      { id: 's1', url: null, identifier: 'OpenAI' },
      'ai-hot-news-bot/0.1 (by /u/test)',
    );
    const items = await crawler.fetch();

    expect(items).toHaveLength(1);
    expect(items[0]!.filterReason).toBe('reddit_low_ratio');
  });

  it('SP-4: writes filterReason=null for high-quality post (ratio>=0.5, score>=5)', async () => {
    const goodPost = {
      id: 'def',
      title: 'High quality',
      author: 'bob',
      subreddit: 'OpenAI',
      url: 'https://example.com/b',
      permalink: '/r/OpenAI/comments/def',
      is_self: false,
      selftext: '',
      selftext_html: null,
      created_utc: 1746230500,
      score: 200,
      ups: 200,
      downs: 0,
      num_comments: 30,
      upvote_ratio: 0.95,
      stickied: false,
      over_18: false,
    };
    fetchMock.mockResolvedValue(jsonResponse(listingOf(goodPost)));

    const crawler = new RedditCrawler(
      { id: 's2', url: null, identifier: 'OpenAI' },
      'ai-hot-news-bot/0.1 (by /u/test)',
    );
    const items = await crawler.fetch();

    expect(items).toHaveLength(1);
    expect(items[0]!.filterReason).toBeNull();
  });

  it('SP-4: writes filterReason="reddit_low_engagement" for cold post (score<5, comments<2)', async () => {
    const coldPost = {
      id: 'ghi',
      title: 'Cold post',
      author: 'carol',
      subreddit: 'OpenAI',
      url: 'https://example.com/c',
      permalink: '/r/OpenAI/comments/ghi',
      is_self: false,
      selftext: '',
      selftext_html: null,
      created_utc: 1746230600,
      score: 2,
      ups: 2,
      downs: 0,
      num_comments: 0,
      upvote_ratio: null,
      stickied: false,
      over_18: false,
    };
    fetchMock.mockResolvedValue(jsonResponse(listingOf(coldPost)));

    const crawler = new RedditCrawler(
      { id: 's3', url: null, identifier: 'OpenAI' },
      'ai-hot-news-bot/0.1 (by /u/test)',
    );
    const items = await crawler.fetch();

    expect(items).toHaveLength(1);
    expect(items[0]!.filterReason).toBe('reddit_low_engagement');
  });

  // === SP-5.5: domain-signal pipeline ===
  // Order: HIGH bypass > LOW reject > tiny-selfpost > engagement check.

  it('SP-5.5: HIGH-signal link → trustedSource=true, filterReason=null (even with cold engagement)', async () => {
    // Paper link with tiny score should still be admitted.
    const coldHighLink = {
      id: 'sp5-5-hi',
      title: '[R] DeepSeek V4 paper full version is out',
      author: 'researcher',
      subreddit: 'MachineLearning',
      url: 'https://arxiv.org/abs/2604.12345',
      permalink: '/r/MachineLearning/comments/sp5-5-hi',
      is_self: false,
      selftext: '',
      selftext_html: null,
      created_utc: 1746230700,
      score: 1,
      ups: 1,
      downs: 0,
      num_comments: 0,
      upvote_ratio: null,
      stickied: false,
      over_18: false,
    };
    fetchMock.mockResolvedValue(jsonResponse(listingOf(coldHighLink)));

    const crawler = new RedditCrawler(
      { id: 'sp5-5-hi', url: null, identifier: 'MachineLearning' },
      'ai-hot-news-bot/0.1 (by /u/test)',
    );
    const [item] = await crawler.fetch();

    expect(item!.filterReason).toBeNull();
    expect(item!.trustedSource).toBe(true);
  });

  it('SP-5.5: HIGH-signal subdomain (alignment.anthropic.com) is recognized', async () => {
    const subdomainHighLink = {
      id: 'sp5-5-sub',
      title: 'Anthropic researchers detail "model spec midtraining"',
      author: 'researcher',
      subreddit: 'artificial',
      url: 'https://alignment.anthropic.com/2026/midtraining',
      permalink: '/r/artificial/comments/sp5-5-sub',
      is_self: false,
      selftext: '',
      selftext_html: null,
      created_utc: 1746230710,
      score: 16,
      ups: 16,
      downs: 0,
      num_comments: 2,
      upvote_ratio: 0.95,
      stickied: false,
      over_18: false,
    };
    fetchMock.mockResolvedValue(jsonResponse(listingOf(subdomainHighLink)));

    const crawler = new RedditCrawler(
      { id: 'sp5-5-sub', url: null, identifier: 'artificial' },
      'ai-hot-news-bot/0.1 (by /u/test)',
    );
    const [item] = await crawler.fetch();

    expect(item!.filterReason).toBeNull();
    expect(item!.trustedSource).toBe(true);
  });

  it('SP-5.5: LOW-signal link (i.redd.it) → filterReason="reddit_low_signal_link" regardless of viral engagement', async () => {
    // Top-scoring meme on r/ChatGPT (s=13103) is still rejected.
    const memePost = {
      id: 'sp5-5-lo',
      title: 'Like dis if you cry everytim',
      author: 'meme_lord',
      subreddit: 'ChatGPT',
      url: 'https://i.redd.it/abcdef.png',
      permalink: '/r/ChatGPT/comments/sp5-5-lo',
      is_self: false,
      selftext: '',
      selftext_html: null,
      created_utc: 1746230800,
      score: 13103,
      ups: 13103,
      downs: 0,
      num_comments: 823,
      upvote_ratio: 0.98,
      stickied: false,
      over_18: false,
    };
    fetchMock.mockResolvedValue(jsonResponse(listingOf(memePost)));

    const crawler = new RedditCrawler(
      { id: 'sp5-5-lo', url: null, identifier: 'ChatGPT' },
      'ai-hot-news-bot/0.1 (by /u/test)',
    );
    const [item] = await crawler.fetch();

    expect(item!.filterReason).toBe('reddit_low_signal_link');
    expect(item!.trustedSource).toBeFalsy();
  });

  it('SP-5.5: v.redd.it video is also LOW (Boston Dynamics meme variant)', async () => {
    const videoMeme = {
      id: 'sp5-5-vid',
      title: 'New Boston Dynamics Atlas trick',
      author: 'someone',
      subreddit: 'singularity',
      url: 'https://v.redd.it/xyz',
      permalink: '/r/singularity/comments/sp5-5-vid',
      is_self: false,
      selftext: '',
      selftext_html: null,
      created_utc: 1746230810,
      score: 4805,
      ups: 4805,
      downs: 0,
      num_comments: 469,
      upvote_ratio: 0.97,
      stickied: false,
      over_18: false,
    };
    fetchMock.mockResolvedValue(jsonResponse(listingOf(videoMeme)));

    const crawler = new RedditCrawler(
      { id: 'sp5-5-vid', url: null, identifier: 'singularity' },
      'ai-hot-news-bot/0.1 (by /u/test)',
    );
    const [item] = await crawler.fetch();

    expect(item!.filterReason).toBe('reddit_low_signal_link');
  });

  it('SP-5.5: tiny selfpost (selftext < 50 chars) → filterReason="reddit_tiny_selfpost"', async () => {
    const tinySelf = {
      id: 'sp5-5-tiny',
      title: 'Why does ChatGPT keep doing this?',
      author: 'venter',
      subreddit: 'ChatGPT',
      url: 'https://www.reddit.com/r/ChatGPT/comments/sp5-5-tiny/',
      permalink: '/r/ChatGPT/comments/sp5-5-tiny',
      is_self: true,
      selftext: 'idk help',
      selftext_html: '<p>idk help</p>',
      created_utc: 1746230900,
      score: 8,
      ups: 8,
      downs: 0,
      num_comments: 3,
      upvote_ratio: 0.95,
      stickied: false,
      over_18: false,
    };
    fetchMock.mockResolvedValue(jsonResponse(listingOf(tinySelf)));

    const crawler = new RedditCrawler(
      { id: 'sp5-5-tiny', url: null, identifier: 'ChatGPT' },
      'ai-hot-news-bot/0.1 (by /u/test)',
    );
    const [item] = await crawler.fetch();

    expect(item!.filterReason).toBe('reddit_tiny_selfpost');
  });

  it('SP-5.5: substantive selfpost (selftext >= 50 chars) goes through engagement check', async () => {
    const substantiveSelf = {
      id: 'sp5-5-self-ok',
      title: 'Hi everyone, I built a benchmark',
      author: 'researcher',
      subreddit: 'LocalLLaMA',
      url: 'https://www.reddit.com/r/LocalLLaMA/comments/sp5-5-self-ok/',
      permalink: '/r/LocalLLaMA/comments/sp5-5-self-ok',
      is_self: true,
      selftext:
        'I spent the last two weeks running 12 open-weight models head-to-head on math tasks; here are the takeaways I think actually matter for picking a daily-driver below 70B.',
      selftext_html:
        '<p>I spent the last two weeks running 12 open-weight models head-to-head on math tasks; here are the takeaways I think actually matter for picking a daily-driver below 70B.</p>',
      created_utc: 1746230910,
      score: 50,
      ups: 50,
      downs: 0,
      num_comments: 12,
      upvote_ratio: 0.95,
      stickied: false,
      over_18: false,
    };
    fetchMock.mockResolvedValue(jsonResponse(listingOf(substantiveSelf)));

    const crawler = new RedditCrawler(
      { id: 'sp5-5-self-ok', url: null, identifier: 'LocalLLaMA' },
      'ai-hot-news-bot/0.1 (by /u/test)',
    );
    const [item] = await crawler.fetch();

    expect(item!.filterReason).toBeNull();
    expect(item!.trustedSource).toBeFalsy();
  });

  it('SP-5.5: ambiguous outbound (fortune.com) falls through to engagement check', async () => {
    const ambiguous = {
      id: 'sp5-5-amb',
      title: 'Dario Amodei spent last year warning of AI white-collar bloodbath',
      author: 'reader',
      subreddit: 'singularity',
      url: 'https://fortune.com/2026/05/09/dario-amodei',
      permalink: '/r/singularity/comments/sp5-5-amb',
      is_self: false,
      selftext: '',
      selftext_html: null,
      created_utc: 1746230920,
      score: 500,
      ups: 500,
      downs: 0,
      num_comments: 240,
      upvote_ratio: 0.94,
      stickied: false,
      over_18: false,
    };
    fetchMock.mockResolvedValue(jsonResponse(listingOf(ambiguous)));

    const crawler = new RedditCrawler(
      { id: 'sp5-5-amb', url: null, identifier: 'singularity' },
      'ai-hot-news-bot/0.1 (by /u/test)',
    );
    const [item] = await crawler.fetch();

    expect(item!.filterReason).toBeNull();
    expect(item!.trustedSource).toBeFalsy();
  });

  it('SP-5.5: cross-post link to www.reddit.com is LOW (Sam Altman texts screenshot variant)', async () => {
    const crossPost = {
      id: 'sp5-5-x',
      title: 'Sam Altman texts Mira Murati [screenshot]',
      author: 'sharer',
      subreddit: 'OpenAI',
      url: 'https://www.reddit.com/r/OpenAI/comments/abc/another_thread/',
      permalink: '/r/OpenAI/comments/sp5-5-x',
      is_self: false,
      selftext: '',
      selftext_html: null,
      created_utc: 1746230930,
      score: 4041,
      ups: 4041,
      downs: 0,
      num_comments: 982,
      upvote_ratio: 0.96,
      stickied: false,
      over_18: false,
    };
    fetchMock.mockResolvedValue(jsonResponse(listingOf(crossPost)));

    const crawler = new RedditCrawler(
      { id: 'sp5-5-x', url: null, identifier: 'OpenAI' },
      'ai-hot-news-bot/0.1 (by /u/test)',
    );
    const [item] = await crawler.fetch();

    expect(item!.filterReason).toBe('reddit_low_signal_link');
  });
});
