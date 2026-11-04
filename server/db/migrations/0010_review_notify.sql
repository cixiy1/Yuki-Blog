-- 新稿提交审核时给管理员发提醒。
-- 同一篇稿子 10 分钟内只提醒一次：作者撤回再提交不该反复刷信。
ALTER TABLE posts ADD COLUMN review_notified_at TEXT;
