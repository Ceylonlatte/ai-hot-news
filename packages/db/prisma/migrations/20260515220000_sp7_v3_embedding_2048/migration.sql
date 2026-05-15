-- SP-7-A v3 (2026-05-15): switch embedding column from vector(1536) to vector(2048).
--
-- Why: SP-7-A v2 routed embeddings through OpenRouter -> openai/text-embedding-3-small
-- (1536-d). OpenRouter's Terms-of-Service blocks the openai/* (and google/*) embedding
-- models with HTTP 403, so PR-α v2 was effectively dead on arrival in prod. Pivoted to
-- nvidia/llama-nemotron-embed-vl-1b-v2:free which returns 2048-d vectors. See ADR v3 in
-- docs/superpowers/specs/2026-05-08-sp7-pgvector-cross-platform-merge-design.md.
--
-- Safety: at the moment this migration runs prod has 0 rows with embedding IS NOT NULL
-- (the v2 client never succeeded — it 403'd on every call). So DROP + ADD is lossless.
-- If anyone is reading this in the future and a prod row already carries 1536-d data,
-- run a wipe-non-rss script BEFORE applying or rewrite this as an ALTER (cosine across
-- mismatched dims is undefined anyway).

ALTER TABLE "hot_news" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "hot_news" ADD COLUMN "embedding" vector(2048);
