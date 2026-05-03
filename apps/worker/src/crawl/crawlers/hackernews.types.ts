// HN Firebase API item schema (subset used by SP-2).
// Reference: https://github.com/HackerNews/API#items
export interface HnStory {
  id: number;
  type?: 'story' | 'comment' | 'job' | 'poll' | 'pollopt';
  by?: string;
  time?: number; // Unix seconds
  title?: string;
  url?: string; // present for link-posts
  text?: string; // present for self-posts (HTML)
  score?: number;
  descendants?: number; // top-level comment count
  deleted?: boolean;
  dead?: boolean;
}
