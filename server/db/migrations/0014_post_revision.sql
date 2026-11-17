-- 草稿版本号：给多人同时改同一篇做乐观锁。
--
-- 不能拿 updated_at 比对：datetime('now') 只到秒，自动保存 1.5 秒一次，
-- 两个人的改动经常落在同一秒里，冲突根本比不出来。rev 单调递增，才分得清先后。
ALTER TABLE posts ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
