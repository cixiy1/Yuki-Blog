-- 草稿正文：
-- 设计里「正文在 git」指的是已发布文章；未提交审核的草稿每 1.5 秒自动保存一次，
-- 走 GitHub API 会产生大量无意义提交，所以草稿正文先落 D1，提交审核时才写入仓库。
ALTER TABLE posts ADD COLUMN body TEXT;

-- frontmatter 里除 title/summary/tags/cover 之外的字段（category、series、password 等），
-- 存 JSON 原文，主站构建时按 schema 校验，这里不做结构约束。
ALTER TABLE posts ADD COLUMN meta_json TEXT;
