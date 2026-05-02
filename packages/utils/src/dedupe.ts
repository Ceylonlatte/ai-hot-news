import { createHash } from 'node:crypto';

export function computeDedupeHash(sourceUrl: string, title: string): string {
  const normalizedTitle = title.trim().toLowerCase();
  const payload = `${sourceUrl}\n${normalizedTitle}`;
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}
