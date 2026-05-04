-- packages/db/scripts/sp4-5-update-rss-interval.sql
-- SP-4.5: drop RSS crawl frequency from 30min to 1d.
-- Idempotent: the WHERE clause prevents re-applying after first run.
UPDATE source_configs
SET "crawlInterval" = 86400
WHERE platform = 'RSS' AND "crawlInterval" <> 86400;
