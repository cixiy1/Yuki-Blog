-- 审核员改过的正文：挑毛病之外，直接动手改一版给作者参考。
-- 只存在 D1 里，不碰仓库、不触发构建；作者点「采用」才由他自己落回稿子。
ALTER TABLE posts ADD COLUMN review_body TEXT;
ALTER TABLE posts ADD COLUMN review_body_at TEXT;
ALTER TABLE posts ADD COLUMN review_body_by INTEGER;
