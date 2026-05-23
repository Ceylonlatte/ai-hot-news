-- SP-16.5 (2026-05-23): add lastSearchedAt + composite index for cron scan.
--
-- New keywords start with NULL → cron must treat NULL as "due immediately"
-- (eligible regardless of frequency). Existing rows backfill to NULL — they
-- will be searched on the next cron tick which is fine (no historical
-- data to lose; SP-16 only just landed).

ALTER TABLE "keyword_monitors" ADD COLUMN "lastSearchedAt" TIMESTAMP(3);

-- Cron query shape:
--   SELECT id, monitorFrequency, lastSearchedAt
--   FROM keyword_monitors
--   WHERE enabled = true
--   ORDER BY lastSearchedAt ASC NULLS FIRST
--   LIMIT N
-- Index supports both predicates + ORDER BY (NULL sorts first in ASC).
CREATE INDEX "keyword_monitors_enabled_lastSearchedAt_idx"
  ON "keyword_monitors" ("enabled", "lastSearchedAt");
