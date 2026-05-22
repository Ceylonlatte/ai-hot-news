-- SP-12 (2026-05-22): pg_trgm full-text search infrastructure.
--
-- Three pieces:
--   1. pg_trgm extension (Postgres 16 contrib — no extra install)
--   2. IMMUTABLE wrapper function for array_to_string (the stock function
--      is STABLE not IMMUTABLE, blocking it from index expressions)
--   3. Functional GIN index on the concatenation of searchable fields
--
-- Why the wrapper:
--   Postgres requires index-expression functions to be IMMUTABLE. The
--   built-in `array_to_string(text[], text)` is marked STABLE because
--   PostgreSQL has to be conservative across all input types and locales.
--   For our use (text[] with a fixed ' ' separator) it IS effectively
--   immutable — the output depends only on input array values. Wrapping it
--   in a user-defined IMMUTABLE SQL function tells Postgres we vouch for
--   that invariant. Postgres docs §38.7 explicitly allows this pattern.
--
-- Why functional index (not GENERATED COLUMN):
--   `GENERATED ALWAYS AS ... STORED` requires the same IMMUTABLE
--   property and is harder to evolve (changing the expression requires
--   ALTER COLUMN dance). Functional index over an inline expression keeps
--   the schema clean and is what gin_trgm_ops naturally supports.

-- 1. Enable pg_trgm extension (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. IMMUTABLE wrapper for array_to_string with fixed ' ' delimiter.
--    Safe because the output depends solely on the array elements; no
--    locale / collation / session-dependent behavior is involved.
CREATE OR REPLACE FUNCTION immutable_array_to_text(arr text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$ SELECT array_to_string(arr, ' ') $$;

-- 3. Functional GIN index over the concatenated search fields.
--    Order: titleZh first (CN users' primary visibility), then title (orig
--    EN/CN), summary, aiTags (joined), matchedKeywords (joined).
--    The exact same expression appears in service-layer raw SQL
--    `WHERE <expr> % $q`, so the planner picks this index.
CREATE INDEX "hot_news_search_text_trgm_idx"
  ON "hot_news"
  USING GIN (
    (
      COALESCE("titleZh", '')
        || ' '
        || COALESCE(title, '')
        || ' '
        || COALESCE(summary, '')
        || ' '
        || immutable_array_to_text("aiTags")
        || ' '
        || immutable_array_to_text("matchedKeywords")
    ) gin_trgm_ops
  );
