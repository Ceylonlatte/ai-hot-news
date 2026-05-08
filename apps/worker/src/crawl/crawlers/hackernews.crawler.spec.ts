import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HackerNewsCrawler } from './hackernews.crawler';
import topIdsFixture from '../fixtures/hn-topstories-ids.json';
import linkPostFixture from '../fixtures/hn-story-link-post.json';
import selfPostFixture from '../fixtures/hn-story-self-post.json';
import commentFixture from '../fixtures/hn-story-comment.json';
import deletedFixture from '../fixtures/hn-story-deleted.json';

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('HackerNewsCrawler', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  describe('constructor / identifier validation', () => {
    it('throws when identifier is null', async () => {
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: null });
      await expect(crawler.fetch()).rejects.toThrow(/invalid identifier=null/);
    });

    it('throws when identifier is an unknown topic', async () => {
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'best' });
      await expect(crawler.fetch()).rejects.toThrow(/invalid identifier=best/);
    });
  });

  describe('fetchIds (topic → IDs list)', () => {
    it('hits the correct endpoint for top/ask/show', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === `${HN_BASE}/topstories.json`) return jsonResponse(topIdsFixture);
        return jsonResponse(null);
      });
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      await crawler.fetch();
      expect(fetchMock).toHaveBeenCalledWith(
        `${HN_BASE}/topstories.json`,
        expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': expect.any(String) }) }),
      );
    });

    it('throws when the IDs endpoint returns non-200', async () => {
      fetchMock.mockResolvedValue(new Response('Internal Error', { status: 500 }));
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      await expect(crawler.fetch()).rejects.toThrow(/HN ids fetch 500/);
    });

    it('throws when the IDs response body is not an array', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: 'oops' }));
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      await expect(crawler.fetch()).rejects.toThrow(/HN ids response not array/);
    });
  });

  describe('fetchStory + filtering + toRaw', () => {
    it('returns RawCrawledItem for a link-post, filling externalUrl in interactionData', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse([linkPostFixture.id]);
        if (url.endsWith(`/item/${linkPostFixture.id}.json`)) return jsonResponse(linkPostFixture);
        return jsonResponse(null);
      });
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        title: 'GPT-5 announced',
        contentText: 'GPT-5 announced',
        rawHtml: null,
        sourceUrl: `https://news.ycombinator.com/item?id=${linkPostFixture.id}`,
        author: 'alice',
        interactionData: {
          score: 234,
          comments: 45,
          externalUrl: 'https://openai.com/news/gpt-5',
          hnId: linkPostFixture.id,
        },
      });
      expect(items[0].publishedAt).toBeInstanceOf(Date);
      expect(items[0].publishedAt!.getTime()).toBe(linkPostFixture.time * 1000);
    });

    it('returns RawCrawledItem for a self-post, with stripped text and rawHtml', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse([selfPostFixture.id]);
        if (url.endsWith(`/item/${selfPostFixture.id}.json`)) return jsonResponse(selfPostFixture);
        return jsonResponse(null);
      });
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        title: 'Show HN: My side project',
        contentText: 'I built this in 2 weekends.',
        rawHtml: '<p>I built this in <b>2 weekends</b>.</p>',
        author: 'bob',
        interactionData: {
          score: 12,
          comments: 3,
          externalUrl: null,
          hnId: selfPostFixture.id,
        },
      });
    });

    it('filters out comment-type items', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse([commentFixture.id]);
        if (url.endsWith(`/item/${commentFixture.id}.json`)) return jsonResponse(commentFixture);
        return jsonResponse(null);
      });
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();
      expect(items).toHaveLength(0);
    });

    it('filters out deleted items', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse([deletedFixture.id]);
        if (url.endsWith(`/item/${deletedFixture.id}.json`)) return jsonResponse(deletedFixture);
        return jsonResponse(null);
      });
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();
      expect(items).toHaveLength(0);
    });

    it('filters out null story responses (single-item GET fail)', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse([linkPostFixture.id, 99999999]);
        if (url.endsWith(`/item/${linkPostFixture.id}.json`)) return jsonResponse(linkPostFixture);
        if (url.endsWith('/item/99999999.json')) return new Response('not found', { status: 404 });
        return jsonResponse(null);
      });
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();
      expect(items).toHaveLength(1);
      expect(items[0].interactionData).toMatchObject({ hnId: linkPostFixture.id });
    });

    it('survives a thrown fetch error for a single item without aborting the batch', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse([linkPostFixture.id, 88888888]);
        if (url.endsWith(`/item/${linkPostFixture.id}.json`)) return jsonResponse(linkPostFixture);
        if (url.endsWith('/item/88888888.json')) throw new Error('ECONNRESET');
        return jsonResponse(null);
      });
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();
      expect(items).toHaveLength(1);
    });
  });

  describe('SP-4 filterReason / SP-5 v3.5 top-N pass-through', () => {
    it('writes filterReason="hn_low_engagement" for low score + low comments at position>20', async () => {
      const ids = [...Array(25).keys()].map((i) => 90000 + i);
      const targetId = 99999;
      ids[24] = targetId; // position 25 (1-based) → past the top-20 pass-through
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse(ids);
        const id = url.match(/\/item\/(\d+)\.json$/)?.[1];
        if (id === String(targetId))
          return jsonResponse({
            id: targetId,
            type: 'story',
            title: 'Cold HN post outside top 20',
            by: 'alice',
            time: 1746230400,
            score: 2,
            descendants: 0,
            url: 'https://example.com/x',
          });
        return jsonResponse({
          id: Number(id),
          type: 'story',
          title: `placeholder ${id}`,
          by: 'pad',
          time: 1746230000,
          score: 100,
          descendants: 50,
          url: 'https://example.com/p',
        });
      });

      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();

      const target = items.find((i) => i.interactionData?.hnId === targetId);
      expect(target).toBeDefined();
      expect(target!.filterReason).toBe('hn_low_engagement');
    });

    it('writes filterReason=null for high-engagement HN post', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse([99998]);
        if (url.endsWith('/item/99998.json'))
          return jsonResponse({
            id: 99998,
            type: 'story',
            title: 'Hot HN post',
            by: 'bob',
            time: 1746230500,
            score: 234,
            descendants: 56,
            url: 'https://openai.com/news',
          });
        return jsonResponse(null);
      });

      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();

      expect(items).toHaveLength(1);
      expect(items[0]!.filterReason).toBeNull();
    });

    it('SP-5 v3.5: top-20 pass-through admits low-engagement post when position<=20', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse([99996]); // position=1
        if (url.endsWith('/item/99996.json'))
          return jsonResponse({
            id: 99996,
            type: 'story',
            title: 'Cold HN post but ranked #1',
            by: 'dave',
            time: 1746230700,
            score: 2,
            descendants: 0,
            url: 'https://example.com/y',
          });
        return jsonResponse(null);
      });

      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();

      expect(items).toHaveLength(1);
      expect(items[0]!.filterReason).toBeNull();
      expect(items[0]!.interactionData).toMatchObject({ hnPosition: 1 });
    });

    it('SP-5 v3.5: hnPosition reflects 1-based rank in /topstories.json', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse([90001, 90002, 90003]);
        const id = url.match(/\/item\/(\d+)\.json$/)?.[1];
        return jsonResponse({
          id: Number(id),
          type: 'story',
          title: `Post ${id}`,
          by: 'x',
          time: 1746230800,
          score: 100,
          descendants: 10,
          url: `https://example.com/${id}`,
        });
      });

      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();

      expect(items).toHaveLength(3);
      const byId = new Map(
        items.map((it) => [it.interactionData?.hnId as number, it.interactionData?.hnPosition]),
      );
      expect(byId.get(90001)).toBe(1);
      expect(byId.get(90002)).toBe(2);
      expect(byId.get(90003)).toBe(3);
    });

    it('treats missing score / descendants as low engagement when position>20', async () => {
      const ids = [...Array(25).keys()].map((i) => 80000 + i);
      const targetId = 99997;
      ids[24] = targetId;
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse(ids);
        const id = url.match(/\/item\/(\d+)\.json$/)?.[1];
        if (id === String(targetId))
          return jsonResponse({
            id: targetId,
            type: 'story',
            title: 'No engagement data',
            by: 'carol',
            time: 1746230600,
            // score / descendants intentionally omitted
          });
        return jsonResponse({
          id: Number(id),
          type: 'story',
          title: `pad ${id}`,
          by: 'pad',
          time: 1746230000,
          score: 100,
          descendants: 50,
          url: 'https://example.com/p',
        });
      });

      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();

      const target = items.find((i) => i.interactionData?.hnId === targetId);
      expect(target).toBeDefined();
      expect(target!.filterReason).toBe('hn_low_engagement');
    });
  });
});
