-- SP-19 PR-A (2026-05-24): LLM usage audit log.
--
-- One row per LLM API call. Cost is pre-computed at write-time in the
-- worker (apps/worker/src/llm-usage/pricing.ts holds per-model prices).
-- hotNewsId is FK-less by design — SP-10.5 cleanup must NOT cascade-delete
-- cost records so monthly rollups stay accurate after article aging.

CREATE TABLE "llm_usage" (
  "id" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "hotNewsId" TEXT,
  "tokensIn" INTEGER NOT NULL,
  "tokensOut" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER NOT NULL,
  "costUsd" DECIMAL(10,6),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "llm_usage_pkey" PRIMARY KEY ("id")
);

-- Recent-first scan (admin /llm-cost endpoint default ORDER)
CREATE INDEX "llm_usage_createdAt_idx" ON "llm_usage" ("createdAt" DESC);

-- Per-model time-series rollup
CREATE INDEX "llm_usage_model_createdAt_idx" ON "llm_usage" ("model", "createdAt");

-- Per-operation time-series rollup
CREATE INDEX "llm_usage_operation_createdAt_idx" ON "llm_usage" ("operation", "createdAt");
