-- SP-5 v3.3: AI-translated Chinese title (separate column, never overwrites
-- the original `title` per spec §0.1 "do not modify HotNews.title"). NULL
-- when the worker hasn't processed the row yet or LLM produced no titleZh.

ALTER TABLE "hot_news" ADD COLUMN "titleZh" TEXT;
