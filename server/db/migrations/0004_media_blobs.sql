-- 草稿阶段的媒体临时落地。
-- P3 只做「写完能插图」，真正进仓库/对象存储要等 P4 的 GitHub Contents API 与 R2；
-- 所以草稿图片放这里，Worker 用 /api/media/<id> 直出，发布时再迁走并清理。
-- D1 单行上限 1MB，因此服务端只收 1MB 以内的入参，客户端会先缩放再传。
CREATE TABLE IF NOT EXISTS media_blobs (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	uid        INTEGER NOT NULL,
	mime       TEXT NOT NULL,
	bytes      INTEGER NOT NULL,
	sha256     TEXT NOT NULL,
	data       BLOB NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 同一个人重复上传同一张图时复用它，不重复存字节
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_blobs_owner_sha ON media_blobs (uid, sha256);
