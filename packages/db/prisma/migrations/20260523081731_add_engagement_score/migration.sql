-- SP-6 follow-up (2026-05-23): engagementScore column.
--
-- Motivation: heatScore (SP-6 V1) combines time decay τ=48h × 0.25 +
-- interaction × 0.35 + source × 0.25 + cross × 0.15. The time decay
-- term dominates for 30d+ ranges — switching ?range=1d / 7d / 30d
-- with ?sort=heat returns identical top-N (the 48h-internal rows
-- always win). User-visible symptom: sort=heat is effectively
-- "recent + hot", not "absolute hot within window".
--
-- Fix: persist a separate column that excludes time decay (kept as
-- the new sort key for ?sort=heat). heatScore + heatLevel keep their
-- original SP-6 semantics for the dashboard BURST/HOT badges etc.

ALTER TABLE "hot_news"
  ADD COLUMN "engagementScore" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX "hot_news_engagementScore_idx"
  ON "hot_news"("engagementScore" DESC);
