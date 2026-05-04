-- SP-4.6 RSS sources (idempotent fallback).
-- Primary deploy path: redeploy + `pnpm db:seed` inside the worker container.
-- Use this script when redeploying is not desirable (e.g. immediate prod fix).
-- Run via: scripts/run-prod-oneshot.sh psql -f /workspace/packages/db/scripts/sp4.6-add-rss-sources.sql
-- or:      docker compose exec -T postgres psql -U postgres -d ai_hot_news -f /...

-- Anthropic News: rebind url + enable (idempotent: only updates the row keyed by name).
UPDATE source_configs
   SET url = 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml',
       enabled = true,
       "crawlInterval" = 86400,
       "updatedAt" = now()
 WHERE platform = 'RSS' AND name = 'Anthropic News';

-- Drop legacy zombie row (the old disabled entry pointing at .../news/rss),
-- in case both the old and new urls coexist after a prior partial migration.
DELETE FROM source_configs
 WHERE platform = 'RSS'
   AND name = 'Anthropic News'
   AND url = 'https://www.anthropic.com/news/rss';

-- Cursor Blog
INSERT INTO source_configs (id, platform, name, url, identifier, enabled, "crawlInterval", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'RSS', 'Cursor Blog',
       'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_cursor.xml',
       NULL, true, 86400, now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM source_configs WHERE platform = 'RSS' AND name = 'Cursor Blog');

-- Claude Blog
INSERT INTO source_configs (id, platform, name, url, identifier, enabled, "crawlInterval", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'RSS', 'Claude Blog',
       'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_claude.xml',
       NULL, true, 86400, now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM source_configs WHERE platform = 'RSS' AND name = 'Claude Blog');

-- Claude Code Changelog (Mintlify-generated official RSS)
INSERT INTO source_configs (id, platform, name, url, identifier, enabled, "crawlInterval", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'RSS', 'Claude Code Changelog',
       'https://code.claude.com/docs/en/changelog/rss.xml',
       NULL, true, 86400, now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM source_configs WHERE platform = 'RSS' AND name = 'Claude Code Changelog');

-- Sanity check (read-only).
SELECT name, url, enabled, "crawlInterval"
  FROM source_configs
 WHERE platform = 'RSS'
 ORDER BY name;
