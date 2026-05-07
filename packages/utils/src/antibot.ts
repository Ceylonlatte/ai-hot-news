/**
 * SP-4.7 v1.1: Detect anti-bot / access-blocked pages that ArticleExtractor
 * mistakenly captures as "extracted content".
 *
 * Why this exists: Firecrawl / Jina happily return the HTML of a
 * Cloudflare / Reddit / etc. block page, and ExtractService treats it as
 * `EXTRACTED`. The downstream SummarizeService then writes a summary
 * faithfully describing the block notice ("Reddit 平台因网络安全策略阻止访问..."),
 * which is worse than just falling back to the title.
 *
 * Strategy: pure function on the cleaned text (post strip-html + trim).
 * If it matches a known signature AND the text is short (real articles
 * almost never reduce to ≤ ~600 chars after strip), treat as blocked.
 *
 * The caller (ExtractService) maps a positive verdict to
 * `extractStatus='FAILED'` and KEEPS the original `content` (which is
 * `content==title` per the link-post sentinel), so SP-5 falls back to
 * title-only summary instead of summarizing the block page.
 */

const ANTIBOT_SIGNATURES: RegExp[] = [
  // Reddit
  /you'?ve been blocked by network security/i,
  /log in to (?:your )?reddit account.*to (?:continue|get verified)/i,
  /developer token/i,
  // Cloudflare
  /cloudflare ray id/i,
  /just a moment\.{3}/i,
  /checking your browser/i,
  /checking if the site connection is secure/i,
  /verify you(?:'re| are) human/i,
  /enable javascript and cookies to continue/i,
  // Generic CDN / WAF
  /access (?:to this page has been )?denied/i,
  /\b403 forbidden\b/i,
  /are you a robot\??/i,
  /please complete the security check/i,
  /captcha/i,
  // Login walls
  /log in to continue reading/i,
  /sign in to continue/i,
  /create a free account to (?:read|continue)/i,
  // Rate limit
  /rate limit (?:exceeded|reached)/i,
  /too many requests/i,
];

const SHORT_TEXT_THRESHOLD = 600;

export interface AntiBotVerdict {
  isAntiBot: boolean;
  /** Human-readable reason, e.g. "reddit_block" / "cloudflare_challenge". null when not blocked. */
  reason: string | null;
}

export function detectAntiBotPage(text: string): AntiBotVerdict {
  if (!text || typeof text !== 'string') {
    return { isAntiBot: false, reason: null };
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { isAntiBot: false, reason: null };
  }

  // Real articles can occasionally contain phrases like "captcha" or
  // "rate limit" in their body. Only flag SHORT pages — block pages are
  // almost always under ~600 chars after strip-html.
  if (trimmed.length > SHORT_TEXT_THRESHOLD) {
    return { isAntiBot: false, reason: null };
  }

  for (const re of ANTIBOT_SIGNATURES) {
    if (re.test(trimmed)) {
      return { isAntiBot: true, reason: re.source };
    }
  }
  return { isAntiBot: false, reason: null };
}

/** Convenience: returns just the boolean. */
export function isAntiBotPage(text: string): boolean {
  return detectAntiBotPage(text).isAntiBot;
}
