import keywordsRaw from './keywords.md?raw';

export function parseKeywords(raw: string): string[] {
  const tokens: string[] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('<!--')) continue;

    const stripped = line.replace(/^[-*]\s+/, '');
    for (const piece of stripped.split(',')) {
      const word = piece.trim();
      if (word) tokens.push(word);
    }
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(token);
    }
  }
  return unique;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildMatcher(keywords: readonly string[]): RegExp {
  if (keywords.length === 0) return /^(?!)$/;
  const escaped = [...keywords]
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

export const KEYWORDS = parseKeywords(keywordsRaw);
const AI_TOPIC_REGEX = buildMatcher(KEYWORDS);

export function matchesAiTopic(text: string | null | undefined): boolean {
  if (!text) return false;
  return AI_TOPIC_REGEX.test(text);
}
