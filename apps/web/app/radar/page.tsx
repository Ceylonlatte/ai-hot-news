import { redirect } from 'next/navigation';
import type { Route } from 'next';

// SP-15 (2026-05-23): legacy /radar mock page is superseded by /keywords.
// 308 permanent redirect preserves any existing bookmarks / search-engine
// index entries. The 'Keyword Radar' SVG visualization is deferred to
// SP-15 PR-B; the new /keywords route covers the PRD §6.4 functional reqs.
export default function RadarLegacyRedirect(): never {
  redirect('/keywords' as Route);
}
