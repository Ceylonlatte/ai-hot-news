-- SP-14 (2026-05-23): KeywordMonitor 扩字段 + MonitorFrequency enum +
-- UNIQUE(userId, keyword) + updatedAt timestamp.
--
-- Hand-written to keep parity with the SP-12 + SP-10.5 migrations that
-- also bypass `prisma migrate dev` (workspace contains earlier migrations
-- that Prisma flagged as "modified after applied", which prevents dev
-- mode from running). `prisma migrate deploy` applies this idempotently
-- in prod via the standard deploy script.

-- 1. MonitorFrequency enum
CREATE TYPE "MonitorFrequency" AS ENUM ('M15', 'M30', 'H1', 'D1');

-- 2. Add columns (defaults set so existing rows — currently 0 in prod —
--    backfill cleanly).
ALTER TABLE "keyword_monitors"
  ADD COLUMN "synonyms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "excludeWords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "platforms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "monitorFrequency" "MonitorFrequency" NOT NULL DEFAULT 'H1',
  ADD COLUMN "triggerRules" JSONB,
  ADD COLUMN "notifyChannels" TEXT[] NOT NULL DEFAULT ARRAY['site']::TEXT[],
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 3. UNIQUE (userId, keyword) — same user cannot have two monitors on
--    the same keyword (PATCH the existing one instead). Schema previously
--    only had non-unique @@index([userId]) which we keep for fast list-by-user.
CREATE UNIQUE INDEX "keyword_monitors_userId_keyword_key"
  ON "keyword_monitors"("userId", "keyword");
