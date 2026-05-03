export const REDDIT_USER_AGENT = Symbol('REDDIT_USER_AGENT');

export interface RedditListingResponse {
  kind: 'Listing';
  data: {
    after: string | null;
    before: string | null;
    children: Array<{ kind: 't3'; data: RedditPost }>;
  };
}

export interface RedditPost {
  id: string;
  title: string;
  author: string | null;
  subreddit: string;
  url: string | null;
  permalink: string;
  is_self: boolean;
  selftext: string | null;
  selftext_html: string | null;
  created_utc: number;
  score: number;
  ups: number;
  downs: number;
  num_comments: number;
  upvote_ratio: number | null;
  stickied: boolean;
  over_18: boolean;
}
