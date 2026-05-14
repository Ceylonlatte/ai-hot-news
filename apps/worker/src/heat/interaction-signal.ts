import type { Platform } from '@ai-hot-news/db';
import type { HeatConfig } from './heat.config';

function normalizeLog(raw: number, max: number): number {
  return (Math.log10(raw + 1) / Math.log10(max + 1)) * 100;
}

export function interactionSignal(
  platform: Platform,
  data: Record<string, unknown> | null,
  cfg: HeatConfig,
): number {
  if (!data) return 0;

  switch (platform) {
    case 'HACKERNEWS': {
      const score = Number(data.score) || 0;
      const comments = Number(data.comments) || 0;
      const raw = score + comments * 2;
      return normalizeLog(raw, cfg.maxHn);
    }

    case 'REDDIT': {
      const score = Number(data.score) || 0;
      const comments = Number(data.comments) || 0;
      const ratioRaw = Number(data.redditUpvoteRatio);
      const ratioWeight = Math.max(Number.isFinite(ratioRaw) ? ratioRaw : 0.5, 0.5);
      const raw = (score + comments * 2) * ratioWeight;
      return normalizeLog(raw, cfg.maxReddit);
    }

    case 'TWITTER': {
      const likes = Number(data.likes) || 0;
      const retweets = Number(data.retweets) || 0;
      const replies = Number(data.replies) || 0;
      const raw = likes + retweets * 3 + replies * 2;
      return normalizeLog(raw, cfg.maxTwitter);
    }

    case 'RSS':
      throw new Error('RSS rows must be filtered before interactionSignal()');
  }
}
