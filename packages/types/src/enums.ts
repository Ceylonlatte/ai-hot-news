export const Platform = {
  TWITTER: 'TWITTER',
  RSS: 'RSS',
  HACKERNEWS: 'HACKERNEWS',
  REDDIT: 'REDDIT',
} as const;
export type Platform = (typeof Platform)[keyof typeof Platform];

export const HeatLevel = {
  BURST: 'BURST',
  HOT: 'HOT',
  NORMAL: 'NORMAL',
  LOW: 'LOW',
} as const;
export type HeatLevel = (typeof HeatLevel)[keyof typeof HeatLevel];

export const ContentStatus = {
  VISIBLE: 'VISIBLE',
  HIDDEN: 'HIDDEN',
  PENDING: 'PENDING',
} as const;
export type ContentStatus = (typeof ContentStatus)[keyof typeof ContentStatus];

export const SourceStatus = {
  NORMAL: 'NORMAL',
  FAILED: 'FAILED',
  LIMITED: 'LIMITED',
} as const;
export type SourceStatus = (typeof SourceStatus)[keyof typeof SourceStatus];

export const UserRole = {
  ADMIN: 'ADMIN',
  USER: 'USER',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const NotificationType = {
  KEYWORD_HIT: 'KEYWORD_HIT',
  BURST_HOTNEWS: 'BURST_HOTNEWS',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
