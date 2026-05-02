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

  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = '';

  const kept: Array<[string, string]> = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!isTrackingParam(key)) kept.push([key, value]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  parsed.search = '';
  for (const [k, v] of kept) parsed.searchParams.append(k, v);

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }

  return parsed.toString();
}
