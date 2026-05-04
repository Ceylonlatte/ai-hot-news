const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
]);

const TRACKING_PREFIXES = ['utm_'];

// SP-4: exact-host alias map (applied before prefix-strip below)
const HOST_ALIASES: Record<string, string> = {
  'old.reddit.com': 'www.reddit.com',
  'np.reddit.com': 'www.reddit.com',
  'new.reddit.com': 'www.reddit.com',
  'twitter.com': 'x.com',
  'mobile.twitter.com': 'x.com',
  'm.x.com': 'x.com',
};

// SP-4: mobile-prefix strip (after lower-case + after alias map miss)
const MOBILE_PREFIXES = ['m.', 'mobile.'];

function isTrackingParam(key: string): boolean {
  if (TRACKING_PARAMS.has(key)) return true;
  return TRACKING_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function normalizeUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return input;
  }

  // SP-4 Rule 1: http → https
  if (parsed.protocol === 'http:') {
    parsed.protocol = 'https:';
  }

  // SP-1 (existing): host lower-case
  parsed.hostname = parsed.hostname.toLowerCase();

  // SP-4 Rule 2: exact host alias map (Reddit / Twitter)
  const aliasedHost = HOST_ALIASES[parsed.hostname];
  if (aliasedHost) {
    parsed.hostname = aliasedHost;
  } else {
    // SP-4 Rule 3: mobile/m. prefix strip (only when no alias matched)
    for (const prefix of MOBILE_PREFIXES) {
      if (parsed.hostname.startsWith(prefix)) {
        parsed.hostname = parsed.hostname.slice(prefix.length);
        break;
      }
    }
  }

  // SP-1 (existing): drop fragment
  parsed.hash = '';

  // SP-4 Rule 4 + SP-1 (existing): strip tracking + dedup repeated keys + sort
  // Map auto-dedups (last value wins for repeated keys)
  const seen = new Map<string, string>();
  for (const [key, value] of parsed.searchParams.entries()) {
    if (isTrackingParam(key)) continue;
    seen.set(key, value);
  }
  parsed.search = '';
  const sortedKeys = Array.from(seen.keys()).sort();
  for (const k of sortedKeys) {
    parsed.searchParams.append(k, seen.get(k)!);
  }
  // SP-4 Rule 5: empty `?` is auto-dropped by URL.toString() when search is empty
  // (WHATWG URL standard) — covered by tests, no explicit code needed.

  // SP-1 (existing): strip trailing slash on non-root path
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }

  return parsed.toString();
}
