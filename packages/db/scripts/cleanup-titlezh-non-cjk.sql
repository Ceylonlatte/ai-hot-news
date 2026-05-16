-- packages/db/scripts/cleanup-titlezh-non-cjk.sql
-- SP-5 titleZh-cjk-guard cleanup (2026-05-16):
-- LLM 偷懒未真翻译就把英文标题原样/改写后写进 titleZh 列。识别为「不含任何 CJK
-- 统一表意文字（U+4E00 一 ～ U+9FA5 龥）」的行 → set NULL，让 UI 的
-- `titleZh ?? title` fallback 接管，把卡片上的"假翻译"改成显示原 title。
--
-- 不动 summary / aiTags（它们写得是对的，只是 titleZh 这一字段没翻好）。
-- 不重摘 —— 留给未来"prompt 升级 + boot backstop 重摘"运维操作触发。
--
-- Idempotent: 二次执行 0 行受影响（已被设 NULL 的行不再匹配 IS NOT NULL）。
-- Postgres ARE 直接嵌入 Unicode 字符做 range，PG 16 实测通过：
--   纯英文 'Cursor 0.50 Built-in AI Security Review' !~ '[一-龥]' = t
--   中英混杂 'Cursor 0.50 内置 AI 安全审查'           !~ '[一-龥]' = f
UPDATE hot_news
SET "titleZh" = NULL
WHERE "titleZh" IS NOT NULL
  AND "titleZh" !~ '[一-龥]';
