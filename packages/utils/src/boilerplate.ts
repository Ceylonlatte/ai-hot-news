const SITE_NAME_WHITELIST = new Set([
  // AI labs / vendors
  'OpenAI Blog',
  'OpenAI',
  'Anthropic',
  'Google AI Blog',
  'Google DeepMind',
  'Hugging Face',
  // Tech press
  'TechCrunch',
  'The Verge',
  'Wired',
  'Ars Technica',
  // Social / video
  'YouTube',
  'Twitter',
  'X',
]);

// Tail separator: " - X" / " | X" / " — X" (em-dash) / " – X" (en-dash)
// Hyphen placed last in each character class so it's unambiguously a literal,
// not interpreted as a range delimiter.
// Match only at the END of the string, capture the trailing site name candidate.
const TITLE_SUFFIX_PATTERN = /\s+[|—–-]\s+([^|—–-]+)\s*$/;

export function stripTitleBoilerplate(title: string): string {
  if (!title) return '';
  const trimmed = title.trim();
  const match = trimmed.match(TITLE_SUFFIX_PATTERN);
  if (!match || match.index === undefined) return trimmed;
  const captured = match[1];
  if (captured === undefined) return trimmed;
  const candidate = captured.trim();
  if (SITE_NAME_WHITELIST.has(candidate)) {
    return trimmed.slice(0, match.index).trim();
  }
  return trimmed;
}

const CONTENT_TAIL_PATTERNS: RegExp[] = [
  /\s*Read\s+more\s*[→\-»]?\s*$/i,
  /\s*Continue\s+reading\s*[→\-»]?\.?\s*$/i,
  /\s*This\s+article\s+was\s+first\s+published\s+(at|on)\s+[^\n]+$/i,
  // WordPress feeds: "The post <Title> appeared first on <Site>"
  /\s*The\s+post\s+.+?\s+appeared\s+first\s+on\s+[^\n]+$/i,
];

const HORIZONTAL_WHITESPACE_RUN = /[ \t]+/g;
const NEWLINE_RUN_3_OR_MORE = /\n{3,}/g;

export function stripContentBoilerplate(text: string): string {
  if (!text) return '';
  let result = text;
  for (const pattern of CONTENT_TAIL_PATTERNS) {
    result = result.replace(pattern, '');
  }
  result = result.replace(HORIZONTAL_WHITESPACE_RUN, ' ');
  result = result.replace(NEWLINE_RUN_3_OR_MORE, '\n\n');
  return result.trim();
}
