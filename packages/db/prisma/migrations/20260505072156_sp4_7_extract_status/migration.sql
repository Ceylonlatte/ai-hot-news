-- AlterTable
ALTER TABLE "hot_news" ADD COLUMN     "extractAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "extractStatus" TEXT;

-- SP-4.7: partial index for worker boot backstop scan + ops backfill query.
-- VISIBLE/EXTRACTED rows (the vast majority) skip the index entirely.
CREATE INDEX "hot_news_extract_pending_idx"
  ON "hot_news" ("extractStatus")
  WHERE "extractStatus" IN ('PENDING', 'FAILED');
