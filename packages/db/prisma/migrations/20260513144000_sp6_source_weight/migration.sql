-- SP-6: Source weight (0..1) used in the heat-score formula's "source weight"
-- dimension. V1 ships with 0.5 for every existing row (matches spec §0 Q6
-- decision: no data to rank sources yet, observe BURST distribution for two
-- weeks before tuning). PR-B (API) and PR-C (worker) consume this column;
-- this migration is metadata-only on PG 11+ (ADD COLUMN with constant DEFAULT
-- writes no row).

ALTER TABLE "source_configs" ADD COLUMN "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5;
